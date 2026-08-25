import type { InferState } from "@colyseus/shared-types";
import type { Room } from "@colyseus/sdk";
import { useEntityInstance } from "./useEntityInstance";

/** Keys of `State` holding a map-like collection (anything with `.get(key)`). */
type MapLikeKeys<State> = {
    [K in keyof State]: State[K] extends { get(key: string): unknown } ? K : never;
}[keyof State] & string;

/** Element type of a map-like collection. */
type MapLikeValue<C> = C extends { get(key: string): infer V } ? Exclude<V, undefined> : never;

/**
 * React hook that returns **your own entity** — the decoded schema instance
 * keyed by `room.sessionId` inside a map collection of the room state.
 *
 * This is the most common instance lookup in a predicted game: the entity you
 * hand to `useReconciler` / `predict.reconciler`. Re-renders only when the
 * instance appears, is replaced, or is removed (compare-by-identity), never
 * on field changes.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param collectionKey - Root-state key of the map collection (e.g. `"players"`)
 * @returns Your decoded entity instance, or undefined until it spawns
 *
 * @example
 * ```tsx
 * const me = useSessionEntity(room, "players");
 * ```
 */
export function useSessionEntity<
    T = any,
    State = InferState<T, never>,
    K extends MapLikeKeys<State> = MapLikeKeys<State>,
>(
    room: Room<T, State> | null | undefined,
    collectionKey: K,
): MapLikeValue<State[K]> | undefined {
    return useEntityInstance(room, (state, r) => {
        const collection = state[collectionKey] as { get(key: string): unknown } | undefined;
        return collection?.get?.(r.sessionId) as MapLikeValue<State[K]> | undefined;
    });
}
