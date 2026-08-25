import 'reflect-metadata';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Room } from '@colyseus/sdk';
import { getSchemaInstance } from '../schema/createSnapshot';
import { useColyseusState } from '../schema/useColyseusState';
import { useRoomState } from '../schema/useRoomState';
import { MyRoomState, Player } from './schema/MyRoomState';
import { simulateState } from './schema/simulateState';

/**
 * A selector may build its own root container (`Array.from(...)`, an object
 * literal). Those carry no refId, so `createSnapshot` cannot cache them and the
 * hook has to keep them stable itself — otherwise `useSyncExternalStore` sees a
 * new snapshot on every call and re-renders until React gives up.
 */

function withPlayers(...names: string[]) {
    const sim = simulateState(() => new MyRoomState());
    sim.updateState((state) => {
        names.forEach((name, i) => state.players.set(`p${i}`, new Player().assign({ name })));
    });
    return sim;
}

describe('selector-built root containers', () => {
    test('a derived array is stable while the state is untouched', () => {
        const { clientState, decoder } = withPlayers('P1', 'P2');

        const { result, rerender } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => Array.from(s.players.values()))
        );

        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
        expect(result.current.map((p) => p.name)).toEqual(['P1', 'P2']);
    });

    test('a derived object literal is stable while the state is untouched', () => {
        const { clientState, decoder } = withPlayers('P1');

        const { result, rerender } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ message: s.myString }))
        );

        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });

    test('a derived array picks up a change to a nested field', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => Array.from(s.players.values()))
        );
        const before = result.current;

        act(() => { updateState((s) => { s.players.get('p0')!.position.x = 42; }); });

        expect(result.current).not.toBe(before);
        expect(result.current[0].position.x).toBe(42);
    });

    test('a derived object literal picks up a change behind it', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ name: s.players.get('p0')!.name }))
        );
        const before = result.current;

        act(() => { updateState((s) => { s.players.get('p0')!.name = 'renamed'; }); });

        expect(result.current).not.toBe(before);
        expect(result.current).toEqual({ name: 'renamed' });
    });

    test('a change elsewhere does not churn the derived root', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => Array.from(s.players.values()))
        );
        const before = result.current;

        act(() => { updateState((s) => { s.myString = 'unrelated'; }); });

        expect(result.current).toBe(before);
    });

    test('reuse survives a value returning to its previous contents', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ name: s.players.get('p0')!.name }))
        );

        act(() => { updateState((s) => { s.players.get('p0')!.name = 'renamed'; }); });
        const renamed = result.current;

        act(() => { updateState((s) => { s.players.get('p0')!.name = 'P1'; }); });
        expect(result.current).not.toBe(renamed);
        expect(result.current).toEqual({ name: 'P1' });
    });

    test('a function in the literal neither leaks nor blocks reuse', () => {
        const { clientState, decoder } = withPlayers('P1');

        const { result, rerender } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ n: s.players.size, onPick: () => {} }))
        );

        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
        expect(result.current).not.toHaveProperty('onPick');
    });

    test('a selector that drops a key rebuilds the root', () => {
        const { clientState, decoder } = withPlayers('P1');

        let wide = true;
        const { result, rerender } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) =>
                wide ? { a: s.myString, b: s.myString } : { a: s.myString })
        );

        const before = result.current;
        expect(Object.keys(before)).toEqual(['a', 'b']);

        wide = false;
        rerender();
        expect(result.current).not.toBe(before);
        expect(Object.keys(result.current)).toEqual(['a']);
    });

    test('a nested derived container is stabilised too', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result, rerender } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ list: Array.from(s.players.values()) }))
        );

        const first = result.current;
        rerender();
        expect(result.current).toBe(first);

        act(() => { updateState((s) => { s.players.set('p1', new Player().assign({ name: 'P2' })); }); });
        expect(result.current).not.toBe(first);
        expect(result.current.list).toHaveLength(2);
    });
});

describe('derived roots keep snapshot identity intact', () => {
    test('a derived array shares element references with a plain selector', () => {
        const { clientState, decoder, updateState } = withPlayers('P1', 'P2');

        const derived = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => Array.from(s.players.values()))
        );
        const plain = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => s.players)
        );

        expect(derived.result.current[0]).toBe(plain.result.current.p0);

        act(() => { updateState((s) => { s.players.get('p0')!.name = 'renamed'; }); });

        // the rebuilt player must be one object, not a per-hook copy
        expect(derived.result.current[0]).toBe(plain.result.current.p0);
        // the untouched player keeps its reference on both sides
        expect(derived.result.current[1]).toBe(plain.result.current.p1);
    });

    test('an object literal selector yields plain data, not live schema nodes', () => {
        const { clientState, decoder } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ player: s.players.get('p0')! }))
        );

        expect(result.current.player).not.toBe(clientState.players.get('p0'));
        expect(Object.keys(result.current.player)).toEqual(['name', 'position', 'inventory']);
        expect(result.current.player).not.toHaveProperty('~refId');
    });
});

describe('derived roots bridge back to decoded instances', () => {
    test('getSchemaInstance resolves through a derived array', () => {
        const { clientState, decoder, updateState } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => Array.from(s.players.values()))
        );

        expect(getSchemaInstance(result.current[0])).toBe(clientState.players.get('p0'));

        act(() => { updateState((s) => { s.players.get('p0')!.name = 'renamed'; }); });

        // the rebuilt snapshot has to stay resolvable, or predict.value() loses its source
        expect(getSchemaInstance(result.current[0])).toBe(clientState.players.get('p0'));
    });

    test('getSchemaInstance resolves through a derived object literal', () => {
        const { clientState, decoder } = withPlayers('P1');

        const { result } = renderHook(() =>
            useColyseusState(clientState, decoder, (s) => ({ player: s.players.get('p0')! }))
        );

        expect(getSchemaInstance(result.current.player)).toBe(clientState.players.get('p0'));
    });
});

describe('through the public useRoomState entry point', () => {
    test('a derived array selector mounts and tracks updates', () => {
        const sim = withPlayers('P1');
        const room = {
            state: sim.clientState,
            serializer: { decoder: sim.decoder },
        } as unknown as Room<unknown, MyRoomState>;

        const { result, rerender } = renderHook(() =>
            useRoomState(room, (s) => Array.from(s.players.values()))
        );

        const first = result.current;
        rerender();
        expect(result.current).toBe(first);

        act(() => { sim.updateState((s) => { s.players.set('p1', new Player().assign({ name: 'P2' })); }); });
        expect(result.current).toHaveLength(2);
    });
});
