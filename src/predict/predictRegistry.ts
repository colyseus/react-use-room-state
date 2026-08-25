import { Predict, type Room, type PredictGetOptions } from "@colyseus/sdk";

interface PredictEntry {
    predict: Predict<any>;
    refCount: number;
    disposeTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Shared Predict instances, one per room. `Predict.get()` constructs a fresh,
 * independent instance on every call, so sharing across hooks/components has
 * to happen here.
 */
const entriesByRoom = new WeakMap<object, PredictEntry>();

/**
 * Returns the room's shared `Predict`, creating it on first acquire.
 * `options` only apply at creation (first caller wins) — pass them
 * consistently, or centralize them via `createRoomContext({ predict })`.
 */
export function acquirePredict<State = any>(room: Room, options?: PredictGetOptions): Predict<State> {
    let entry = entriesByRoom.get(room);
    if (!entry) {
        entry = {
            predict: Predict.get(room as never, options) as unknown as Predict<any>,
            refCount: 0,
            disposeTimeout: null,
        };
        entriesByRoom.set(room, entry);
    }
    if (entry.disposeTimeout !== null) {
        clearTimeout(entry.disposeTimeout);
        entry.disposeTimeout = null;
    }
    entry.refCount++;
    return entry.predict as Predict<State>;
}

/**
 * Releases one acquire. Disposal is deferred a tick so a StrictMode
 * unmount/remount pair reuses the instance instead of recreating it.
 */
export function releasePredict(room: Room): void {
    const entry = entriesByRoom.get(room);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0 && entry.disposeTimeout === null) {
        entry.disposeTimeout = setTimeout(() => {
            entry.disposeTimeout = null;
            if (entry.refCount <= 0) {
                entry.predict.dispose();
                entriesByRoom.delete(room);
            }
        }, 0);
    }
}
