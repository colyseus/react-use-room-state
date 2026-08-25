import type { InferState } from "@colyseus/shared-types";
import type { Room, PredictGetOptions } from "@colyseus/sdk";
// not re-exported from the sdk root — only from the /predict subpath
import type { PredictedEventChannel, PredictedEventChannelOptions, ConfirmOn } from "@colyseus/sdk/predict";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePredict } from "./usePredict";

/** Options for {@link useEventChannel}: the SDK channel options plus `confirmOn`. */
export type UseEventChannelOptions<T, State> =
    PredictedEventChannelOptions<T> & { confirmOn?: ConfirmOn<State> };

/**
 * React hook that owns an optimistic event channel — the hook form of
 * `predict.defineEvent(options)`, with the channel's schema listeners torn
 * down on unmount, **plus reactivity**: the component calling this hook
 * re-renders whenever the channel settles (predict / confirm / reject /
 * unpredicted), so flag-shaped derives read naturally during render:
 *
 * ```tsx
 * const pickups = useEventChannel(room, {
 *   confirmOn: { collection: "items", field: "alive", equals: false },
 * });
 * const hidden = !item.alive || pickups?.has(id);   // reactive
 * ```
 *
 * The returned object is the real SDK channel — hand it to `ctx.predict`
 * inside a reconciler step, or call `channel.predict(payload)` from UI.
 *
 * Only the component calling the hook re-renders on channel activity; create
 * the channel where you render from it (or lift it and pass state down).
 * `options` are captured at channel creation.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param options - `defineEvent` options (callbacks, `confirmOn`, `uniqueBy`, ...)
 * @returns The channel, or undefined while there is no room
 */
export function useEventChannel<T = any, RoomT = any, State = InferState<RoomT, never>>(
    room: Room<RoomT, State> | null | undefined,
    options: UseEventChannelOptions<T, State>,
    predictOptions?: PredictGetOptions,
): PredictedEventChannel<T> | undefined {
    const predict = usePredict(room, predictOptions);

    // Captured when the channel is created.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [channel, setChannel] = useState<PredictedEventChannel<T>>();

    // Local mini-store: injected callback wrappers bump the version so the
    // calling component re-renders on channel activity.
    const versionRef = useRef(0);
    const listenersRef = useRef(new Set<() => void>());

    useEffect(() => {
        if (!predict) return;

        const opts = optionsRef.current;
        const notify = () => {
            versionRef.current++;
            listenersRef.current.forEach((listener) => listener());
        };
        const wrap = <A extends unknown[]>(fn?: (...args: A) => void) =>
            (...args: A) => { notify(); fn?.(...args); };

        const ch = predict.defineEvent<T>({
            ...opts,
            onPredict: wrap(opts.onPredict),
            onConfirm: wrap(opts.onConfirm),
            onReject: wrap(opts.onReject),
            onUnpredicted: wrap(opts.onUnpredicted),
        } as never);
        setChannel(ch);
        return () => {
            ch.dispose();
            setChannel((current) => (current === ch ? undefined : current));
        };
    }, [predict]);

    const subscribe = useCallback((callback: () => void) => {
        listenersRef.current.add(callback);
        return () => listenersRef.current.delete(callback);
    }, []);
    useSyncExternalStore(subscribe, () => versionRef.current, () => 0);

    return channel;
}
