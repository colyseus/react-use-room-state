import type { InferState, InferInput } from "@colyseus/shared-types";
import type { Room, InputHandle, InputOptions } from "@colyseus/sdk";
import { useMemo, useRef } from "react";

/**
 * React hook that returns the room's `InputHandle` — the single surface that
 * stages and sends input (`@colyseus/sdk` 0.18+).
 *
 * `room.input()` is idempotent (later calls return the same handle), so the
 * handle is stable for the lifetime of the room. Stage fields on
 * `input.data`, then call `input.send()` once per fixed step — typically from
 * the `usePredictLoop` callback.
 *
 * `options` are applied when the handle is first resolved for a room.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param options - `room.input()` options (`type`, `mode`, `historySize`, ...)
 * @returns The room's input handle, or undefined while there is no room
 *
 * @example
 * ```tsx
 * const input = useInput(room);
 * // per fixed step:
 * input.data.moveX = axis();
 * input.send();
 * ```
 */
export function useInput<
    T = any,
    State = InferState<T, never>,
    I = [InferInput<T>] extends [never] ? any : InferInput<T>,
>(
    room: Room<T, State> | null | undefined,
    options?: InputOptions<I>,
): InputHandle<I> | undefined {
    // Options only matter when the handle is first created; keep them out of deps.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    return useMemo(
        // the typeof guard tolerates pre-0.18 rooms and room-like test doubles
        () => (room && typeof room.input === "function"
            ? (room.input(optionsRef.current as never) as InputHandle<I>)
            : undefined),
        [room],
    );
}
