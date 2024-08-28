import { ToJSON } from "@colyseus/schema";
import { create } from "zustand";
import { useEffect } from "react";
import { useColyseusContext } from "../ColyseusProvider";
import { Player, Character } from "@server/src/rooms/schema/MyRoomState";

export const useCharacters = () => {
  const { $, room } = useColyseusContext();
  const listeners = characterStore((state) => state.actions);

  useEffect(() => {
    if (!$ || !room) return;

    const state = $(room.state);

    state.characters.onAdd((char: Character) => {
      listeners.addCharacter(char.toJSON());

      $(char).listen("assignedToPlayer", (value) => {
        console.log("assignedToPlayer", value);
        listeners.updateAssignedPlayer(value);
      });
    });
  }, [room]);

  const characters = characterStore((state) => state.characters);
  return characters;
};

export const useCharacterActions = () => {
  const { room } = useColyseusContext();
  return {
    selectCharacter: (characterId: string) => {
      room?.send("select_character", characterId);
    },
    unselectCharacter: (characterId: string) => {
      room?.send("unselect_character", characterId);
    },
  };
};

interface CharacterStore {
  characters: ToJSON<Character>[];
  actions: Record<string, any>;
}

const characterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  actions: {
    addCharacter(character: ToJSON<Character>) {
      // make sure we're not adding the player twice
      const charExists = get().characters.find(
        (p: ToJSON<Player>) => p.id === character.id,
      );
      if (charExists) return;
      set((state) => ({ characters: [...state.characters, character] }));
    },
    updateAssignedPlayer: (charId: string) => {
      set((state) => {
        const characters = state.characters.map((char) => {
          if (char.id === charId) {
            return {
              ...char,
              assignedToPlayer: charId,
            };
          }
          return char;
        });
        return { characters };
      });
    },
  },
}));
