import { useCharacterActions, useCharacters } from "./colyseus/hooks/use-characters";

export default function Characters() {
  const characters = useCharacters();
  return (
    <>
      <h2>Characters</h2>
      <div
        style={{ display: "flex", justifyContent: "space-evenly", gap: "1rem" }}
      >
        {characters.map((char) => (
          <div
            style={{ display: "flex", flexDirection: "column" }}
            key={char.id}
          >
            {char.name}{" "}
            <ManageCharacter
              charId={char.id}
              taken={Boolean(char.assignedToPlayer.length > 0)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

const ManageCharacter = (props: { charId: string; taken: boolean }) => {
const { selectCharacter, unselectCharacter } = useCharacterActions();
  return <button>{props.taken ? "Unselect" : "Select"} Character</button>;
};
