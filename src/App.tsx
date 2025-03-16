import './App.css'

import { Player } from './schema/MyRoomState'
import { simulatePatchState, useRoomState } from './schema/simulate';

/**
 * Update the string in the state.
 */
function simulateUpdateString() {
  simulatePatchState((state) => {
    state.myString = "Updated! " + Math.random();
  });
}

/**
 * Add a new player to the state.
 */
function simulateAddPlayer() {
  simulatePatchState((state) => {
    const num = (state.players.size + 1);
    state.players.set(`p-${num}`, new Player().assign({ name: "Player " + num }));
  });
}

/**
 * Remove a random player from the state.
 */
function simulateRemovePlayer() {
  simulatePatchState((state) => {
    const randomKey = Array.from(state.players.keys())[Math.floor(Math.random() * state.players.size)];
    state.players.delete(randomKey);
  });
}

function App() {
  const state = useRoomState((state) => state);
  const players = useRoomState((state) => state.players);

  return (
    <>
      <h2>State</h2>
      <p><strong><code>.myString</code>:</strong> {state.myString}</p>
      <button onClick={simulateUpdateString}>Update <code>.myString</code></button>
      <hr />

      <h2><strong><code>.players</code></strong></h2>

      {Array.from(players.keys()).map((key) => (
        <p key={key}><code>{key}</code> → <code>{JSON.stringify(players.get(key)?.toJSON())}</code></p>
      ))}

      <hr />
      <button onClick={simulateAddPlayer}>Add player</button>
      <button onClick={simulateRemovePlayer}>Remove player</button>
    </>
  )
}

export default App
