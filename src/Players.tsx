import { usePlayerActions, usePlayers } from "./colyseus/hooks/use-player";

export default function Players() {
  const players = usePlayers();
  const { addPlayer, removePlayer } = usePlayerActions();

  return (
    <>
      <h2>
        <strong>
          <code>.players</code>
        </strong>
      </h2>
      <ul>
        {players.map((player) => (
          <li style={{ marginBottom: 5 }} key={player.name}>
            {player.name}{" "}
            <button
              style={{ marginLeft: 8 }}
              onClick={() => removePlayer(player.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <hr />
      <button onClick={addPlayer}>Add player</button>
    </>
  );
}
