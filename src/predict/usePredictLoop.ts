import type { InferState } from "@colyseus/shared-types";
import type { Room, PredictGetOptions } from "@colyseus/sdk";
import { useCallback, useEffect, useRef } from "react";
import { usePredict } from "./usePredict";

/** Options for {@link usePredictLoop}. */
export interface PredictLoopOptions {
    /**
     * Drive the loop from an external frame source instead of the hook's own
     * `requestAnimationFrame`. Set this when a renderer already owns the
     * frame loop (e.g. React Three Fiber) and call the returned `drive(now)`
     * from it — at an early `useFrame` priority (e.g. `-1`), so the
     * tick → send → read order holds within the frame.
     */
    external?: boolean;
}

/** Predicts with an active auto-driven loop (double-driver guard). */
const drivenPredicts = new WeakSet<object>();

/**
 * React hook that owns the per-frame prediction driver: calls
 * `predict.tick(now)` once per frame and hands you the number of fixed input
 * steps due — inside the callback, stage `input.data` and `input.send()`
 * exactly that many times ("send before you read").
 *
 * One loop per room. Mounting two auto-driven loops for the same room logs a
 * warning — `predict.tick()` must run once per frame.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param onSteps - Called every frame after `tick()`: `(steps, now) => void`
 * @param options - `{ external: true }` to drive from your own frame loop
 * @returns `drive(now?)` — invoke per frame when `external` is set
 *
 * @example
 * ```tsx
 * // DOM / own rAF:
 * usePredictLoop(room, (steps) => {
 *   for (let i = 0; i < steps; i++) {
 *     input.data.moveX = axis();
 *     input.send();
 *   }
 * });
 *
 * // React Three Fiber:
 * const drive = usePredictLoop(room, onSteps, { external: true });
 * useFrame(() => drive(), -1);
 * ```
 */
export function usePredictLoop<T = any, State = InferState<T, never>>(
    room: Room<T, State> | null | undefined,
    onSteps: (steps: number, now: number) => void,
    options: PredictLoopOptions = {},
    predictOptions?: PredictGetOptions,
): (now?: number) => void {
    const predict = usePredict(room, predictOptions);

    const onStepsRef = useRef(onSteps);
    onStepsRef.current = onSteps;

    const predictRef = useRef(predict);
    predictRef.current = predict;

    const drive = useCallback((now: number = performance.now()) => {
        const p = predictRef.current;
        if (!p) return;
        const steps = p.tick(now);
        onStepsRef.current(steps, now);
    }, []);

    const external = options.external === true;

    useEffect(() => {
        if (external || !predict) return;

        if (drivenPredicts.has(predict)) {
            console.warn(
                "@colyseus/react: multiple usePredictLoop drivers active for the same room — " +
                "predict.tick() must run once per frame. Mount a single loop.",
            );
        }
        drivenPredicts.add(predict);

        let raf = requestAnimationFrame(function frame(now: number) {
            raf = requestAnimationFrame(frame);
            drive(now);
        });
        return () => {
            cancelAnimationFrame(raf);
            drivenPredicts.delete(predict);
        };
    }, [predict, external, drive]);

    return drive;
}
