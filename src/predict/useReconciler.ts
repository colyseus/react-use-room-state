import type { InferState } from "@colyseus/shared-types";
import type { Room, Reconciler, ReconcilerOptions, InputHandle, PredictGetOptions } from "@colyseus/sdk";
import { useEffect, useRef, useState } from "react";
import { usePredict } from "./usePredict";
import { useInput } from "./useInput";
import { useEntityInstance } from "./useEntityInstance";

/**
 * Options for {@link useReconciler}: the SDK's `ReconcilerOptions` with
 * `input` optional — when omitted, the room's default input handle
 * (`room.input()`) is observed.
 */
export type UseReconcilerOptions<S extends object, I> =
    Omit<ReconcilerOptions<S, I>, "input"> & { input?: InputHandle<I> };

/**
 * React hook that runs active prediction for the entity you control — the
 * hook form of `predict.reconciler(instance, options)`.
 *
 * Beyond creating the controller, the hook manages the lifecycle React makes
 * easy to get wrong by hand:
 *
 * - **Late spawn** — your entity usually appears in state *after* the room
 *   connects; the controller is created as soon as the selector yields it.
 * - **Instance replacement** — controllers are pinned to the instance at
 *   construction; when the server replaces it, the controller is disposed
 *   and recreated automatically.
 * - **Disposal** — on unmount, `dispose()` restores the passive smoothing
 *   slot (or raw fallback) for the entity.
 *
 * Render through `predict.value(instance, field)` (one read idiom, local and
 * remote); read `me.state` for game logic.
 *
 * `options` are captured when the controller is created (identity changes on
 * re-render don't recreate it).
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param select - Selects your entity: `(state, room) => instance`
 * @param options - Reconciler options; `input` defaults to `room.input()`
 * @returns The controller, or undefined until the entity exists
 *
 * @example
 * ```tsx
 * const me = useReconciler(
 *   room,
 *   (s, r) => s.players.get(r.sessionId),
 *   { step: (ctx, p, cmd) => applyInput(p, cmd, ctx.dt), smoothMs: 65 },
 * );
 * ```
 */
export function useReconciler<
    T = any,
    State = InferState<T, never>,
    S extends object = any,
    I = any,
>(
    room: Room<T, State> | null | undefined,
    select: (state: State, room: Room<T, State>) => S | undefined,
    options: UseReconcilerOptions<S, I>,
    predictOptions?: PredictGetOptions,
): Reconciler<S, I> | undefined {
    const predict = usePredict(room, predictOptions);
    const defaultInput = useInput(room);
    const instance = useEntityInstance(room, select);

    // Captured when the controller is created.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [controller, setController] = useState<Reconciler<S, I>>();

    useEffect(() => {
        if (!predict || !instance) return;
        const opts = optionsRef.current;
        const input = opts.input ?? defaultInput;
        if (!input) return;

        const ctrl = predict.reconciler(instance as never, { ...opts, input } as never) as unknown as Reconciler<S, I>;
        setController(ctrl);
        return () => {
            ctrl.dispose();
            setController((current) => (current === ctrl ? undefined : current));
        };
    }, [predict, instance, defaultInput]);

    return controller;
}
