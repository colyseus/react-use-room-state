import type { InferState } from "@colyseus/shared-types";
import { type Room, SchemaSerializer } from "@colyseus/sdk";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { getOrCreateSubscription } from "../schema/getOrCreateSubscription";

// Decoded instances only exist client-side; SSR renders as if unavailable.
const getServerSnapshot = () => undefined;

/**
 * React hook that selects a **decoded schema instance** from room state and
 * re-renders only when the selected identity changes (appears, is replaced,
 * or is removed).
 *
 * Unlike `useRoomState` — which returns immutable snapshots — this returns
 * the live decoded instance, which is what the Predict APIs key off
 * (`predict.value(instance, field)`, `predict.reconciler(instance, ...)`).
 *
 * The selector must return a stable reference (a schema instance, collection,
 * or primitive), never a freshly-allocated object — results are compared with
 * `Object.is` on every state change.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param select - Selects the instance: `(state, room) => instance`
 * @returns The selected instance, or undefined while unavailable
 *
 * @example
 * ```tsx
 * const me = useEntityInstance(room, (s, r) => s.players.get(r.sessionId));
 * ```
 */
export function useEntityInstance<T = any, State = InferState<T, never>, S = unknown>(
    room: Room<T, State> | null | undefined,
    select: (state: State, room: Room<T, State>) => S | undefined,
): S | undefined {
    const serializer = room?.serializer as SchemaSerializer<any> | undefined;
    const decoder = serializer?.decoder;
    const state = room?.state;

    const selectRef = useRef(select);
    selectRef.current = select;

    const subscribe = useCallback((callback: () => void) => {
        if (!state || !decoder) return () => { };
        const subscription = getOrCreateSubscription(state as never, decoder);
        subscription.listeners.add(callback);
        return () => subscription.listeners.delete(callback);
    }, [state, decoder]);

    const getSnapshot = useCallback(() => {
        return (room && state) ? selectRef.current(state, room) : undefined;
    }, [room, state]);

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) as S | undefined;
}
