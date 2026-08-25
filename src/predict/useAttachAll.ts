import type { InferState } from "@colyseus/shared-types";
import type { Room, AttachConfig, PredictGetOptions } from "@colyseus/sdk";
import { useEffect, useRef, type DependencyList } from "react";
import { usePredict } from "./usePredict";

/**
 * React hook that attaches passive smoothing to every entity of a root-state
 * collection — the hook form of `predict.attachAll(key, config)`, with the
 * detach handled on unmount / key change.
 *
 * `config` is captured when the attach runs; pass `deps` to force a
 * re-attach when configuration values change (like `useEffect` deps).
 * Remember to attach angular fields (`angle: true`) in a separate call from
 * linear ones.
 *
 * @param room - The connected room (or undefined/null while connecting)
 * @param key - Root-state key of the collection (e.g. `"players"`)
 * @param config - Attach config (`{ mode: "lerp", fields: ["x", "y"] }`)
 * @param deps - Optional dependency list that re-attaches on change
 *
 * @example
 * ```tsx
 * useAttachAll(room, "players", { mode: "lerp", fields: ["x", "y", "z"] });
 * useAttachAll(room, "players", { mode: "lerp", fields: ["heading"], angle: true });
 * ```
 */
export function useAttachAll<T = any, State = InferState<T, never>>(
    room: Room<T, State> | null | undefined,
    key: keyof State & string,
    config: AttachConfig<any>,
    deps: DependencyList = [],
    predictOptions?: PredictGetOptions,
): void {
    const predict = usePredict(room, predictOptions);

    // Captured at attach time; `deps` forces a re-attach.
    const configRef = useRef(config);
    configRef.current = config;

    useEffect(() => {
        if (!predict) return;
        return predict.attachAll(key as never, configRef.current as never);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [predict, key, ...deps]);
}
