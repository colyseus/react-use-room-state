import 'reflect-metadata';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { schema, t, Encoder, Decoder } from '@colyseus/schema';

import { useColyseusState } from '../schema/useColyseusState';
import { getSchemaInstance } from '../schema/createSnapshot';
import { useInputBuffer } from '../predict/useInputBuffer';
import { usePredict } from '../predict/usePredict';
import { useEntityInstance } from '../predict/useEntityInstance';
import { useSessionEntity } from '../predict/useSessionEntity';
import { useReconciler } from '../predict/useReconciler';
import { usePredictLoop } from '../predict/usePredictLoop';
import { useEventChannel } from '../predict/useEventChannel';
import { createRoomContext } from '../context/createRoomContext';
import { renderToString } from 'react-dom/server';

// ---------------------------------------------------------------------------
// Harness: encoder/decoder pair + a room-like object. `Callbacks.get` (and
// therefore `Predict.get`) accepts `{ serializer: { decoder } }`, which is
// all the predict hooks need from a Room.
// ---------------------------------------------------------------------------

const PlayerSchema = schema({
    name: t.string(),
    x: t.number(),
    y: t.number(),
}, 'PredictHooksPlayer');

const StateSchema = schema({
    players: t.map(PlayerSchema),
}, 'PredictHooksState');

function makeHarness(sessionId = 'p1') {
    const serverState = new StateSchema();
    const encoder = new Encoder(serverState);
    const clientState = new StateSchema();
    const decoder = new Decoder(clientState);

    const patch = (mutate: (state: typeof serverState) => void) => {
        mutate(serverState);
        decoder.decode(encoder.encode());
        encoder.discardChanges(); // encode lifecycle contract
    };
    patch(() => { });

    const room = {
        state: clientState,
        serializer: { decoder },
        sessionId,
    } as any;

    return { serverState, clientState, room, patch };
}

/** Minimal InputHandle stand-in — the surface RollbackController reads. */
function fakeInputHandle(): any {
    const listeners = new Set<() => void>();
    return {
        data: {},
        mode: 'reliable',
        lastProcessed: 0,
        epoch: 0,
        sentCount: 0,
        stepMs: 1000 / 30,
        stepSeconds: 1 / 30,
        patchRate: 50,
        subSteps: 1,
        replayBufferSize: 64,
        at: () => undefined,
        reckonTimeAt: () => 0,
        onSend(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); },
        send() { this.sentCount++; listeners.forEach((l) => l()); return this.sentCount; },
        reset() { this.epoch++; },
    };
}

const flushTimers = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

// ---------------------------------------------------------------------------

describe('useInputBuffer', () => {
    test('consume returns true at most once per press', () => {
        const { result, rerender } = renderHook(() => useInputBuffer());
        const buffer = result.current;

        expect(buffer.consume()).toBe(false);
        buffer.press();
        expect(buffer.peek()).toBe(true);
        expect(buffer.consume()).toBe(true);
        expect(buffer.consume()).toBe(false);

        // stable identity across renders
        rerender();
        expect(result.current).toBe(buffer);
    });
});

describe('getSchemaInstance', () => {
    test('maps snapshots back to decoded instances', () => {
        const { clientState, room, patch } = makeHarness();
        const decoder = room.serializer.decoder;

        act(() => {
            patch((s) => { s.players.set('p1', new PlayerSchema().assign({ name: 'One', x: 5, y: 0 })); });
        });

        const { result } = renderHook(() => useColyseusState(clientState, decoder));

        expect(getSchemaInstance(result.current)).toBe(clientState);
        expect(getSchemaInstance(result.current.players)).toBe(clientState.players);
        expect(getSchemaInstance((result.current.players as any)['p1'])).toBe(clientState.players.get('p1'));
        expect(getSchemaInstance((result.current.players as any)['p1'].name)).toBeUndefined();
        expect(getSchemaInstance(undefined)).toBeUndefined();
    });
});

describe('useEntityInstance', () => {
    test('returns undefined until the entity exists, then its identity', () => {
        const { clientState, room, patch } = makeHarness();

        const { result } = renderHook(() =>
            useEntityInstance(room, (s: any, r: any) => s.players.get(r.sessionId)));

        expect(result.current).toBeUndefined();

        act(() => {
            patch((s) => { s.players.set('p1', new PlayerSchema().assign({ name: 'Me', x: 1, y: 2 })); });
        });
        expect(result.current).toBe(clientState.players.get('p1'));
    });

    test('field changes keep identity; replacement changes it', () => {
        const { clientState, room, patch } = makeHarness();
        let renders = 0;

        const { result } = renderHook(() => {
            renders++;
            return useEntityInstance(room, (s: any, r: any) => s.players.get(r.sessionId));
        });

        act(() => {
            patch((s) => { s.players.set('p1', new PlayerSchema().assign({ name: 'Me', x: 1, y: 2 })); });
        });
        const first = result.current;
        const rendersAfterSpawn = renders;

        // Field mutation: same identity, no re-render from this hook.
        act(() => {
            patch((s) => { s.players.get('p1')!.x = 42; });
        });
        expect(result.current).toBe(first);
        expect(renders).toBe(rendersAfterSpawn);

        // Replacement: new identity.
        act(() => {
            patch((s) => {
                s.players.delete('p1');
                s.players.set('p1', new PlayerSchema().assign({ name: 'Me2', x: 0, y: 0 }));
            });
        });
        expect(result.current).not.toBe(first);
        expect(result.current).toBe(clientState.players.get('p1'));
    });
});

describe('useSessionEntity', () => {
    test('returns own entity by sessionId', () => {
        const { clientState, room, patch } = makeHarness('me');

        const { result } = renderHook(() => useSessionEntity(room, 'players' as never));
        expect(result.current).toBeUndefined();

        act(() => {
            patch((s) => {
                s.players.set('other', new PlayerSchema().assign({ name: 'Other', x: 0, y: 0 }));
                s.players.set('me', new PlayerSchema().assign({ name: 'Mine', x: 0, y: 0 }));
            });
        });
        expect(result.current).toBe(clientState.players.get('me'));
    });
});

describe('usePredict', () => {
    test('shares one instance per room and disposes after last unmount', async () => {
        const { room } = makeHarness();

        const a = renderHook(() => usePredict(room));
        const b = renderHook(() => usePredict(room));

        const predict = a.result.current!;
        expect(predict).toBeDefined();
        expect(b.result.current).toBe(predict);

        const dispose = vi.spyOn(predict, 'dispose');

        a.unmount();
        await flushTimers();
        expect(dispose).not.toHaveBeenCalled(); // still one consumer

        b.unmount();
        await flushTimers();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    test('unmount/remount within the same tick keeps the instance (StrictMode)', async () => {
        const { room } = makeHarness();

        const a = renderHook(() => usePredict(room));
        const predict = a.result.current!;
        const dispose = vi.spyOn(predict, 'dispose');

        a.unmount();
        const b = renderHook(() => usePredict(room)); // remounts before the deferred dispose
        await flushTimers();

        expect(dispose).not.toHaveBeenCalled();
        expect(b.result.current).toBe(predict);
        b.unmount();
        await flushTimers();
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

describe('useReconciler', () => {
    test('waits for the entity, creates the controller, recreates on replacement, disposes on unmount', async () => {
        const { clientState, room, patch } = makeHarness();
        const input = fakeInputHandle();
        const step = () => { };

        const { result, unmount } = renderHook(() =>
            useReconciler(room, (s: any, r: any) => s.players.get(r.sessionId), { input, step }));

        // no entity yet
        expect(result.current).toBeUndefined();

        act(() => {
            patch((s) => { s.players.set('p1', new PlayerSchema().assign({ name: 'Me', x: 1, y: 2 })); });
        });
        const first = result.current!;
        expect(first).toBeDefined();
        expect(first.state).toBeDefined();

        // instance replaced on the server → controller recreated
        let firstDisposed = false;
        first.onDisposed(() => { firstDisposed = true; });
        act(() => {
            patch((s) => {
                s.players.delete('p1');
                s.players.set('p1', new PlayerSchema().assign({ name: 'Me2', x: 9, y: 9 }));
            });
        });
        const second = result.current!;
        expect(second).toBeDefined();
        expect(second).not.toBe(first);
        expect(firstDisposed).toBe(true);

        let secondDisposed = false;
        second.onDisposed(() => { secondDisposed = true; });
        unmount();
        await flushTimers();
        expect(secondDisposed).toBe(true);
    });
});

describe('usePredictLoop', () => {
    test('external mode: drive() ticks and reports steps', () => {
        const { room } = makeHarness();
        const calls: number[] = [];

        const { result } = renderHook(() =>
            usePredictLoop(room, (steps) => { calls.push(steps); }, { external: true }));

        act(() => { result.current(16.6); });
        expect(calls.length).toBe(1);
        expect(typeof calls[0]).toBe('number');
    });
});

describe('useEventChannel', () => {
    test('has() is reactive through predict/confirm', () => {
        const { room } = makeHarness();
        const predicted: string[] = [];

        const { result } = renderHook(() => {
            const channel = useEventChannel<string>(room, {
                uniqueBy: (key) => key,
                onPredict: (key) => { predicted.push(key); },
            });
            return { channel, has: channel?.has('crate-1') ?? false };
        });

        expect(result.current.has).toBe(false);

        act(() => { result.current.channel!.predict('crate-1'); });
        expect(predicted).toEqual(['crate-1']);
        expect(result.current.has).toBe(true); // re-rendered via injected callback

        act(() => { result.current.channel!.confirm('crate-1'); });
        expect(result.current.has).toBe(false);
    });

    test('disposes the channel on unmount', async () => {
        const { room } = makeHarness();
        const { result, unmount } = renderHook(() => useEventChannel<string>(room, {}));
        const channel = result.current!;
        expect(channel).toBeDefined();

        unmount();
        await flushTimers();
        // disposed channels report no pending entries and ignore predicts
        expect(channel.pendingCount).toBe(0);
    });
});

describe('server rendering', () => {
    // Every predict hook from a context reads the room through useStoreRoom(),
    // so one probe per store covers the whole family.
    test('context predict hooks render on the server', () => {
        const ctx = createRoomContext<any, any>();

        function Probe() {
            const predict = ctx.usePredict();
            return <span>{predict === undefined ? 'no-predict' : 'has-predict'}</span>;
        }

        expect(renderToString(<Probe />)).toContain('no-predict');
    });

    test('useEntityInstance renders on the server even with a live room', () => {
        const { room } = makeHarness();

        function Probe() {
            const me = useEntityInstance(room, (s, r) => s.players.get(r.sessionId));
            return <span>{me === undefined ? 'no-entity' : 'has-entity'}</span>;
        }

        expect(renderToString(<Probe />)).toContain('no-entity');
    });

    test('useEventChannel renders on the server', () => {
        function Probe() {
            const channel = useEventChannel<string>(undefined, {});
            return <span>{channel === undefined ? 'no-channel' : 'has-channel'}</span>;
        }

        expect(renderToString(<Probe />)).toContain('no-channel');
    });
});
