import { Decoder, Encoder, Schema } from "@colyseus/schema"

/**
 * Create a server and client state instances, set up encoders and decoders to link them,
 * and provide access to the client state, an action to update the server state, and the proxy for adding change callbacks.
 */
export function simulateState<TState extends Schema>(createState: () => TState) {
  const serverState = createState();
  const encoder = new Encoder(serverState);

  const clientState = createState();
  const decoder = new Decoder(clientState);

  const updateState = (action: (state: TState) => void) => {
    // simulate server-side mutations
    action(serverState);

    // encode operations
    const encoded = encoder.encode();

    // decode operations
    decoder.decode(encoded);

    // clear the encoder's dirty state — part of the encode lifecycle contract
    // (colyseus core does this after each patch); without it, the next
    // encode() re-emits stale ops against a frozen index space and corrupts
    // sequential array splices on the client.
    encoder.discardChanges();
  }

  // Run an initial encode/decode step, so the client state is initialized ... otherwise, the first call to onAdd on a MapSchema in the state will fail.
  updateState(() => {});

  return {
    clientState,
    updateState,
    decoder,
  };
}