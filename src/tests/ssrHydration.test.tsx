/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import React from 'react';
import { describe, expect, test, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from '@testing-library/react';
import { schema, t, Encoder, Decoder } from '@colyseus/schema';

import { createRoomContext, createLobbyContext, useRoomState } from '../index';

/**
 * Server markup has to survive hydration.
 *
 * React calls `getServerSnapshot` again during the client's hydration pass, so
 * it must return the same value it did on the server even when a room has since
 * connected — otherwise the trees diverge and React discards the server HTML.
 * The live room is picked up on the re-render right after hydration.
 */

const PlayerSchema = schema({ name: t.string() }, 'HydPlayer');
const StateSchema = schema({ players: t.map(PlayerSchema), label: t.string() }, 'HydState');

function makeRoom() {
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
    patch((s) => { s.label = 'from-server'; s.players.set('p1', new PlayerSchema({ name: 'me' })); });
    return {
        state: clientState,
        serializer: { decoder },
        sessionId: 'p1',
        onMessage: () => () => { },
        leave: () => Promise.resolve(1),
    } as any;
}

/** Render `element` to HTML, hydrate over it, and report what React logged. */
async function hydrate(element: React.ReactElement) {
    const html = renderToString(element);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const logged: string[] = [];
    const collect = (...args: unknown[]) => { logged.push(args.join(' ')); };
    const spyError = vi.spyOn(console, 'error').mockImplementation(collect);
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(collect);

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, element); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    spyError.mockRestore();
    spyWarn.mockRestore();
    const finalHtml = container.innerHTML;
    await act(async () => { root!.unmount(); });
    container.remove();

    // React separates adjacent text nodes with <!-- -->; strip so assertions
    // read against the visible text.
    const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, '');
    return {
        serverHtml: strip(html),
        finalHtml: strip(finalHtml),
        mismatches: logged.filter((e) => /hydrat|did not match|Text content|server HTML|server rendered/i.test(e)),
    };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('hydration', () => {
    // Guards the assertions below: an empty `mismatches` only means something if
    // a genuine mismatch would populate it.
    test('control — a deliberate mismatch is detected', async () => {
        let onServer = true;
        function Bad() {
            const label = onServer ? 'server-text' : 'client-text';
            onServer = false;
            return <div>{label}</div>;
        }
        expect((await hydrate(<Bad />)).mismatches.length).toBeGreaterThan(0);
    });

    test('useRoomState: empty on the server, live after hydration', async () => {
        const room = makeRoom();
        function App() {
            const state = useRoomState(room);
            return <div>label={String(state?.label ?? 'none')}</div>;
        }

        const r = await hydrate(<App />);
        expect(r.serverHtml).toContain('label=none');
        expect(r.mismatches).toEqual([]);
        expect(r.finalHtml).toContain('label=from-server');
    });

    test('context hooks: store already connected before hydration runs', async () => {
        const room = makeRoom();
        const ctx = createRoomContext<any, any>();

        function Consumer() {
            const { isConnecting } = ctx.useRoom();
            const label = ctx.useRoomState((s: any) => s.label);
            return <div>{isConnecting ? 'connecting' : `label=${String(label)}`}</div>;
        }
        const App = () => (
            <ctx.RoomProvider connect={() => Promise.resolve(room)}>
                <Consumer />
            </ctx.RoomProvider>
        );

        const r = await hydrate(<App />);
        expect(r.serverHtml).toContain('connecting');
        expect(r.mismatches).toEqual([]);
        expect(r.finalHtml).toContain('label=from-server');
    });

    test('lobby context hydrates without mismatch', async () => {
        const room = makeRoom();
        const lobby = createLobbyContext();

        function Consumer() {
            const { rooms, isConnecting } = lobby.useLobby();
            return <div>{isConnecting ? 'connecting' : `n=${rooms.length}`}</div>;
        }
        const App = () => (
            <lobby.LobbyProvider connect={() => Promise.resolve(room)}>
                <Consumer />
            </lobby.LobbyProvider>
        );

        const r = await hydrate(<App />);
        expect(r.serverHtml).toContain('connecting');
        expect(r.mismatches).toEqual([]);
    });

    test('two hooks on one room agree across the boundary', async () => {
        const room = makeRoom();
        function App() {
            const label = useRoomState(room, (s: any) => s.label);
            const players = useRoomState(room, (s: any) => s.players);
            const n = players ? Object.keys(players).length : 0;
            return <div>{`${String(label ?? 'none')}/${n}`}</div>;
        }

        const r = await hydrate(<App />);
        expect(r.serverHtml).toContain('none/0');
        expect(r.mismatches).toEqual([]);
        expect(r.finalHtml).toContain('from-server/1');
    });
});
