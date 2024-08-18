import { Decoder, Encoder } from "@colyseus/schema"
import { MyRoomState } from "./MyRoomState";

const serverState = new MyRoomState();
const encoder = new Encoder(serverState);

const clientState = new MyRoomState();
const decoder = new Decoder(clientState);

// decoder.triggerChanges = function (allChanges) {
// }

export function simulatePatchState(callback: (state: MyRoomState) => void) {
  // simulate server-side mutations
  callback(serverState);

  // encode operations
  const encoded = encoder.encode();

  // decode operations
  decoder.decode(encoded);

  console.log("Decoded state:", clientState.toJSON());
}

/**
 * TODO: hook to subscribe to state changes
 */
export function useRoomState<T>(callback: (state: MyRoomState) => T) {
  return callback(clientState);
}