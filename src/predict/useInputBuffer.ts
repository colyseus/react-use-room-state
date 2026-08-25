import { useMemo, useRef } from "react";

/**
 * A one-slot input buffer bridging React events to fixed-step input sampling.
 * See {@link useInputBuffer}.
 */
export interface InputBuffer {
    /** Record that the tap/press happened (call from the React event handler). */
    press(): void;
    /** Read-and-clear: returns true at most once per press (call inside the step loop). */
    consume(): boolean;
    /** Read without clearing. */
    peek(): boolean;
}

/**
 * React hook for the "buffer, then consume" input recipe.
 *
 * Input is sampled once per **fixed step**, not per render frame — a tap on a
 * 0-step frame must not be lost, and a tap spanning a multi-step frame must
 * not fire twice. Buffer the press in the event handler; consume it inside
 * the send loop so it lands on exactly one step:
 *
 * ```tsx
 * const jump = useInputBuffer();
 * <button onPointerDown={jump.press} />
 *
 * usePredictLoop(room, (steps) => {
 *   for (let i = 0; i < steps; i++) {
 *     input.data.jump = jump.consume();   // true on at most one step
 *     input.send();
 *   }
 * });
 * ```
 *
 * The returned object is referentially stable for the component's lifetime.
 */
export function useInputBuffer(): InputBuffer {
    const pressed = useRef(false);
    return useMemo<InputBuffer>(() => ({
        press: () => { pressed.current = true; },
        consume: () => {
            const value = pressed.current;
            pressed.current = false;
            return value;
        },
        peek: () => pressed.current,
    }), []);
}
