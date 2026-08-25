import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Room, type RoomAvailable } from '@colyseus/sdk';
import { useLobbyRoom } from '../room/useLobbyRoom';

type Handler = (...args: any[]) => void;

function fakeLobby() {
    const handlers = new Map<string | number | "*", Set<Handler>>();
    const emit = (type: string | number, ...args: any[]) => {
        handlers.get(type)?.forEach((h) => h(...args));
    };
    const room = {
        roomId: "lobby",
        sessionId: "s",
        state: {},
        connection: { isOpen: true },
        leave: vi.fn().mockResolvedValue(1),
        removeAllListeners: vi.fn(),
        onMessage: vi.fn((type: string | number | "*", handler: Handler) => {
            let set = handlers.get(type);
            if (!set) { set = new Set(); handlers.set(type, set); }
            set.add(handler);
            return () => set!.delete(handler);
        }),
    } as unknown as Room;
    return { room, emit };
}

describe('useLobbyRoom', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('rooms list is empty before connection resolves', () => {
        const { result } = renderHook(() =>
            useLobbyRoom(() => new Promise<Room>(() => { /* never */ }))
        );
        expect(result.current.rooms).toEqual([]);
        expect(result.current.isConnecting).toBe(true);
    });

    test('populates rooms from "rooms" snapshot', async () => {
        const { room, emit } = fakeLobby();
        const { result } = renderHook(() => useLobbyRoom(() => Promise.resolve(room)));

        await act(async () => { });

        const initial: RoomAvailable[] = [
            { roomId: "r1", clients: 1, maxClients: 4, metadata: null, name: "game" },
            { roomId: "r2", clients: 2, maxClients: 4, metadata: null, name: "game" },
        ];
        await act(async () => { emit("rooms", initial); });

        expect(result.current.rooms.map((r) => r.roomId)).toEqual(["r1", "r2"]);
    });

    test('"+" adds a new room and updates existing', async () => {
        const { room, emit } = fakeLobby();
        const { result } = renderHook(() => useLobbyRoom(() => Promise.resolve(room)));
        await act(async () => { });

        await act(async () => {
            emit("rooms", [{ roomId: "r1", clients: 1 } as RoomAvailable]);
        });

        // Update existing
        await act(async () => {
            emit("+", ["r1", { roomId: "r1", clients: 5 } as RoomAvailable]);
        });
        expect(result.current.rooms[0].clients).toBe(5);

        // Add new
        await act(async () => {
            emit("+", ["r2", { roomId: "r2", clients: 1 } as RoomAvailable]);
        });
        expect(result.current.rooms.map((r) => r.roomId)).toEqual(["r1", "r2"]);
    });

    test('"-" removes a room', async () => {
        const { room, emit } = fakeLobby();
        const { result } = renderHook(() => useLobbyRoom(() => Promise.resolve(room)));
        await act(async () => { });

        await act(async () => {
            emit("rooms", [
                { roomId: "r1" } as RoomAvailable,
                { roomId: "r2" } as RoomAvailable,
            ]);
        });

        await act(async () => { emit("-", "r1"); });

        expect(result.current.rooms.map((r) => r.roomId)).toEqual(["r2"]);
    });

    test('rooms reset to [] when callback becomes falsy', async () => {
        const { room, emit } = fakeLobby();
        let cb: (() => Promise<Room>) | null = () => Promise.resolve(room);

        const { result, rerender } = renderHook(() => useLobbyRoom(cb));
        await act(async () => { });
        await act(async () => {
            emit("rooms", [{ roomId: "r1" } as RoomAvailable]);
        });
        expect(result.current.rooms).toHaveLength(1);

        cb = null;
        rerender();

        // useRoom deferred cleanup runs via setTimeout(0).
        await act(async () => { vi.runAllTimers(); });

        expect(result.current.rooms).toEqual([]);
        expect(result.current.room).toBeUndefined();
    });
});
