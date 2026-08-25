import type { InferState } from "@colyseus/shared-types";
import type { Room, Predict, PredictGetOptions } from "@colyseus/sdk";
import { useEffect, useRef, useState } from "react";
import { acquirePredict, releasePredict } from "./predictRegistry";

/**
 * React hook that returns the room's shared `Predict` instance — the entry
 * point for client-side smoothing and prediction (`@colyseus/sdk` 0.18+).
 *
 * `Predict.get()` constructs a fresh instance per call, so this hook manages
 * a single shared instance per room: created on first mount, reference-counted
 * across all consuming hooks, and disposed when the last consumer unmounts.
 *
 * `options` are applied when the instance is first created (first caller
 * wins). To centralize them, pass `{ predict }` to `createRoomContext`.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param options - `Predict.get` options (e.g. `{ mode: "lerp", delay: 100 }`)
 * @returns The shared Predict instance, or undefined while there is no room
 *
 * @example
 * ```tsx
 * const { room } = useRoom(() => client.joinOrCreate("game"));
 * const predict = usePredict(room, { mode: "lerp", delay: 100 });
 * ```
 */
export function usePredict<T = any, State = InferState<T, never>>(
    room: Room<T, State> | null | undefined,
    options?: PredictGetOptions,
): Predict<State> | undefined {
    const [predict, setPredict] = useState<Predict<State>>();

    // Options only matter at instance creation; keep them out of effect deps.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        if (!room) {
            setPredict(undefined);
            return;
        }
        const instance = acquirePredict<State>(room as Room, optionsRef.current);
        setPredict(instance);
        return () => {
            releasePredict(room as Room);
            setPredict((current) => (current === instance ? undefined : current));
        };
    }, [room]);

    return predict;
}
