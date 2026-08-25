/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import React from 'react';
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { schema, t, Encoder, Decoder } from '@colyseus/schema';

import * as api from '../index';

/**
 * Server-render every public export, with no room and with a live one.
 *
 * Any hook reading an external store needs a `getServerSnapshot`, or React
 * throws "Missing getServerSnapshot, which is required for server-rendered
 * content" and the whole tree falls back to client rendering. The failure is
 * per-call-site, so a new store read anywhere reintroduces it — hence the
 * exhaustive sweep rather than a few spot checks.
 */

const PlayerSchema = schema({ name: t.string(), x: t.number() }, 'SsrAuditPlayer');
const StateSchema = schema({ players: t.map(PlayerSchema) }, 'SsrAuditState');

function makeRoom(sessionId = 'p1') {
    const serverState = new StateSchema();
    const encoder = new Encoder(serverState);
    const clientState = new StateSchema();
    const decoder = new Decoder(clientState);
    const patch = (mutate: (s: typeof serverState) => void) => {
        mutate(serverState);
        decoder.decode(encoder.encode());
        encoder.discardChanges(); // encode lifecycle contract
    };
    patch(() => { });
    patch((s) => { s.players.set(sessionId, new PlayerSchema({ name: 'me', x: 1 })); });
    return { state: clientState, serializer: { decoder }, sessionId } as any;
}

/** Minimal InputHandle stand-in — the surface useReconciler reads. */
function fakeInputHandle(): any {
    const listeners = new Set<() => void>();
    return {
        data: {}, mode: 'reliable', lastProcessed: 0, epoch: 0, sentCount: 0,
        stepMs: 1000 / 30, stepSeconds: 1 / 30, patchRate: 50, subSteps: 1, replayBufferSize: 64,
        at: () => undefined, reckonTimeAt: () => 0,
        onSend(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); },
        send() { this.sentCount++; listeners.forEach((l) => l()); return this.sentCount; },
        reset() { this.epoch++; },
    };
}

const room = makeRoom();
const input = fakeInputHandle();
const noop = () => { };
const selectMe = (s: any, r: any) => s.players.get(r.sessionId);

// Contexts live at module scope in real apps, so during SSR their store may
// already hold a live room from an earlier request — the case the server
// snapshot has to ignore.
const roomCtx = api.createRoomContext<any, any>();
const lobbyCtx = api.createLobbyContext();

const hooks: Array<[string, () => unknown]> = [
    ['useRoomState(undefined)', () => api.useRoomState(undefined)],
    ['useRoomState(room)', () => api.useRoomState(room)],
    ['useRoomState(room, selector)', () => api.useRoomState(room, (s: any) => s.players)],
    ['useRoom(null)', () => api.useRoom(null)],
    ['useRoom(connect)', () => api.useRoom(() => Promise.resolve(room))],
    ['useRoomMessage(undefined)', () => api.useRoomMessage(undefined, 'x', noop)],
    ['useRoomMessage(room)', () => api.useRoomMessage(room, 'x', noop)],
    ['useLobbyRoom(null)', () => api.useLobbyRoom(null)],
    ['useLobbyRoom(connect)', () => api.useLobbyRoom(() => Promise.resolve(room))],
    ['useQueueRoom(null)', () => api.useQueueRoom(null, () => Promise.resolve(room))],
    ['useQueueRoom(connect)', () => api.useQueueRoom(() => Promise.resolve(room), () => Promise.resolve(room))],

    ['usePredict(undefined)', () => api.usePredict(undefined)],
    ['usePredict(room)', () => api.usePredict(room)],
    ['useInput(undefined)', () => api.useInput(undefined)],
    ['useInput(room)', () => api.useInput(room)],
    ['useEntityInstance(undefined)', () => api.useEntityInstance(undefined, selectMe)],
    ['useEntityInstance(room)', () => api.useEntityInstance(room, selectMe)],
    ['useSessionEntity(undefined)', () => api.useSessionEntity(undefined, 'players' as any)],
    ['useSessionEntity(room)', () => api.useSessionEntity(room, 'players' as any)],
    ['useAttachAll(undefined)', () => api.useAttachAll(undefined, 'players' as any, {} as any)],
    ['useAttachAll(room)', () => api.useAttachAll(room, 'players' as any, {} as any)],
    ['useReconciler(undefined)', () => api.useReconciler(undefined, selectMe, { input, step: noop } as any)],
    ['useReconciler(room)', () => api.useReconciler(room, selectMe, { input, step: noop } as any)],
    ['usePredictLoop(undefined)', () => api.usePredictLoop(undefined, noop)],
    ['usePredictLoop(room)', () => api.usePredictLoop(room, noop)],
    ['usePredictLoop(room, external)', () => api.usePredictLoop(room, noop, { external: true })],
    ['useEventChannel(undefined)', () => api.useEventChannel(undefined, {} as any)],
    ['useEventChannel(room)', () => api.useEventChannel(room, {} as any)],
    ['useInputBuffer()', () => api.useInputBuffer()],

    ['ctx.useRoom()', () => roomCtx.useRoom()],
    ['ctx.useRoomState()', () => roomCtx.useRoomState()],
    ['ctx.useRoomMessage()', () => roomCtx.useRoomMessage('x', noop)],
    ['ctx.usePredict()', () => roomCtx.usePredict()],
    ['ctx.useInput()', () => roomCtx.useInput()],
    ['ctx.useEntityInstance()', () => roomCtx.useEntityInstance(selectMe)],
    ['ctx.useSessionEntity()', () => roomCtx.useSessionEntity('players' as any)],
    ['ctx.useAttachAll()', () => roomCtx.useAttachAll('players' as any, {} as any)],
    ['ctx.useReconciler()', () => roomCtx.useReconciler(selectMe, { input, step: noop } as any)],
    ['ctx.usePredictLoop()', () => roomCtx.usePredictLoop(noop)],
    ['ctx.useEventChannel()', () => roomCtx.useEventChannel({} as any)],
    ['lobbyCtx.useLobby()', () => lobbyCtx.useLobby()],
];

describe('SSR: every hook renders on the server', () => {
    for (const [name, hook] of hooks) {
        test(name, () => {
            function Probe() {
                hook();
                return <span>ok</span>;
            }
            expect(renderToString(<Probe />)).toContain('ok');
        });
    }

    test('RoomProvider renders its children', () => {
        expect(renderToString(
            <roomCtx.RoomProvider connect={() => Promise.resolve(room)}><span>kids</span></roomCtx.RoomProvider>
        )).toContain('kids');
    });

    test('LobbyProvider renders its children', () => {
        expect(renderToString(
            <lobbyCtx.LobbyProvider connect={() => Promise.resolve(room)}><span>kids</span></lobbyCtx.LobbyProvider>
        )).toContain('kids');
    });
});

describe('SSR: the package declares its own client boundary', () => {
    // Without the directive, a Next.js App Router Server Component importing any
    // hook here fails the build: "You're importing a component that needs
    // useState. It only works in a Client Component…".
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

    test('src/index.ts opens with "use client"', () => {
        const withoutComments = read('../index.ts').replace(/^(\s*\/\/.*\n|\s*\n)+/, '');
        expect(withoutComments.startsWith('"use client";')).toBe(true);
    });

    test('the bundler hoists it to the top of every dist entry', () => {
        const entries = ['../../dist/index.mjs', '../../dist/index.cjs']
            .filter((f) => existsSync(fileURLToPath(new URL(f, import.meta.url))));

        // Only meaningful after `npm run build`; skipped on a clean checkout.
        if (!entries.length) return;

        for (const entry of entries) {
            expect(read(entry).split('\n')[0].trim()).toBe('"use client";');
        }
    });
});
