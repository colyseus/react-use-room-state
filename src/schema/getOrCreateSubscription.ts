/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, Decoder, type DataChange, type IRef, type Iterator } from "@colyseus/schema";

/**
 * Subscription state for a single room, shared across all hook instances
 * consuming the same room state.
 */
export interface StateSubscription {
    /** Set of callbacks to invoke when state changes */
    listeners: Set<() => void>;
    /** Cached snapshot results keyed by refId (persistent across passes) */
    resultsByRefId: Map<number, any>;
    /** Reusable "visited this pass" set for cycle detection */
    visitedThisPass: Set<number>;
    /**
     * Cached refIds whose result is stale: the ref (or a descendant) changed
     * since it was last rebuilt. Only refs that have a cached result are tracked
     * — an uncached ref rebuilds on its own next pass, so `dirtyRefIds` stays a
     * subset of `resultsByRefId` and is bounded/pruned by it. Decode adds; a
     * snapshot removes a refId only when it actually rebuilds that ref (see
     * `createSnapshot`). Because it is never bulk-cleared on a schedule, a mark
     * survives across any number of decodes and unrelated re-renders until the
     * ref is genuinely re-snapshotted — which is what keeps nested values fresh
     * across decode/render interleavings, where clearing-per-decode used to wipe
     * a not-yet-consumed mark and leave it stale. (#10)
     */
    dirtyRefIds: Set<number>;
    /** Map of childRefId → parentRefId for ancestor tracking */
    parentRefIdMap: Map<number, number>;
    /** Counter for periodic pruning of stale cache entries (snapshot side) */
    cleanupCounter: number;
    /** Original decode function from the decoder */
    originalDecode: (bytes: Uint8Array<ArrayBufferLike>, it?: Iterator, ref?: IRef) => DataChange<any, string>[];
}

/** WeakMap to store subscriptions per room state instance */
const subscriptionsByState = new WeakMap<Schema, StateSubscription>();

/**
 * Gets or creates a subscription for the given room state.
 * 
 * This function sets up change notification by wrapping the decoder's
 * `decode` method to intercept all state changes and notify subscribed
 * React components.
 * 
 * We wrap `decode()` rather than assigning `decoder.triggerChanges` because
 * `triggerChanges` is a single-slot callback that gets unconditionally
 * overwritten by `Callbacks.get()` / `getDecoderStateCallbacks()` on every
 * call. Wrapping `decode()` sidesteps this conflict entirely since it is the
 * sole entry point for both full-state syncs and incremental patches.
 * 
 * @param roomState - The Colyseus room state Schema instance
 * @param decoder - The Colyseus decoder associated with the room
 * @returns The subscription object for this room state
 */
export function getOrCreateSubscription(roomState: Schema, decoder: Decoder): StateSubscription {
    let subscription = subscriptionsByState.get(roomState);

    if (subscription) {
        return subscription;
    }

    subscription = {
        listeners: new Set(),
        resultsByRefId: new Map(),
        visitedThisPass: new Set(),
        dirtyRefIds: new Set(),
        parentRefIdMap: new Map(),
        cleanupCounter: 0,
        originalDecode: decoder.decode,
    };

    // Schema v5 only collects (and returns) DataChange[] when a
    // `triggerChanges` subscriber exists. Seed a no-op so `decode()` reports
    // changes; `Callbacks.get()` may later replace it — that's fine, the slot
    // just needs to be defined.
    if (decoder.triggerChanges === undefined) {
        decoder.triggerChanges = () => { };
    }

    // Wrap the decoder's decode method to intercept all state changes.
    // decode() is the single entry point for both full state syncs and
    // incremental patches, and it calls triggerChanges internally before
    // returning. By wrapping decode, we run our notification logic after
    // the entire decode + triggerChanges + GC cycle completes.
    decoder.decode = function (this: Decoder, ...args: [Uint8Array, Iterator, IRef]) {
        const changes: DataChange[] = subscription.originalDecode.apply(decoder, args);

        if (changes && changes.length > 0) {
            const dirty = subscription.dirtyRefIds;
            const cached = subscription.resultsByRefId;
            const parents = subscription.parentRefIdMap;

            // Walk each changed ref up its parent chain, marking the cached ones
            // dirty so any selector at or above the change rebuilds. We only mark
            // refs that have a cached result (an uncached ref rebuilds anyway), so
            // `dirtyRefIds ⊆ resultsByRefId` and the snapshot-side prune bounds it.
            // The `dirty.has` guard stops early — a cached ref already dirty has its
            // cached ancestors dirty too. We add but never bulk-clear: a snapshot
            // removes a ref only once it rebuilds it, so a mark can't be wiped
            // before a late re-render consumes it. (#10)
            for (let i = 0; i < changes.length; i++) {
                let currentRefId: number | undefined = changes[i].refId;
                while (currentRefId !== undefined && !dirty.has(currentRefId)) {
                    if (cached.has(currentRefId)) dirty.add(currentRefId);
                    currentRefId = parents.get(currentRefId);
                }
            }

            // Notify all React subscribers that state has changed.
            subscription.listeners.forEach((callback) => callback());
        }

        return changes;
    };

    subscriptionsByState.set(roomState, subscription);
    return subscription;
}
