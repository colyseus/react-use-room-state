import { ToJSON } from "@colyseus/schema";
import { create } from "zustand";
import { useEffect } from "react";
import { useColyseusContext } from "../ColyseusProvider";
import { Player } from "@server/src/rooms/schema/MyRoomState";

export const usePlayers = () => {
  const { $, room } = useColyseusContext();
  const listeners = playerStore((state) => state.actions);

  useEffect(() => {
    if (!$ || !room) return;

    const state = $(room.state);

    state.players.onAdd((player: Player) => {
      listeners.addPlayer(player.toJSON());
    });

    state.players.onRemove((player: Player) => {
      listeners.removePlayer(player.id);
    });
  }, [room]);

  const players = playerStore((state) => state.players);
  return players;
};

export const usePlayerActions = () => {
  const { room } = useColyseusContext();
  return {
    addPlayer: () => {
      room?.send("add_player");
    },
    removePlayer: (playerId: string) => {
      console.log(playerId, "THE PLAYER ID");
      room?.send("remove_player", playerId);
    },
    updatePlayer: (player: ToJSON<Player>) => {
      room?.send("update_player", player);
    },
  };
};

interface PlayerStore {
  players: ToJSON<Player>[];
  actions: Record<string, any>;
}

const playerStore = create<PlayerStore>((set, get) => ({
  players: [],
  actions: {
    addPlayer(player: ToJSON<Player>) {
      // make sure we're not adding the player twice
      const playerExists = get().players.find(
        (p: ToJSON<Player>) => p.id === player.id,
      );
      if (playerExists) return;
      set((state) => ({ players: [...state.players, player] }));
    },
    removePlayer(playerId: string) {
      set((state) => ({
        players: state.players.filter((player) => player.id !== playerId),
      }));
    },
    updatePlayer(player: ToJSON<Player>) {
      set((state) => ({
        players: state.players.map((p) => (p.id === player.id ? player : p)),
      }));
    },

    getPlayersLocation: () => {
      return get().players.map((player: ToJSON<Player>) => player.position);
    },
  },
}));
