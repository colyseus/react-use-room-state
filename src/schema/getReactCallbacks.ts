/**
 * Implement Your Own Callback System
 * https://docs.colyseus.io/state/callbacks/custom
 *
 * TODO: make the useRoomState hook subscribe to state changes
 */

import { Decoder, DataChange } from "@colyseus/schema";

export function getReactCallbacks(decoder: Decoder, callback: (changes: DataChange[]) => void) {
    decoder.triggerChanges = callback;

    // .refs => contains a map of all Schema instances
    decoder.root.refs

    // .refIds => contains a map of all refIds by Schema instances
    decoder.root.refIds

    // .refCounts => contains a map of all reference counts by refId
    decoder.root.refCounts
}
