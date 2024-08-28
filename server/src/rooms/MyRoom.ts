import { Room, Client } from "@colyseus/core";
import { MyRoomState, Player } from "./schema/MyRoomState";
import uniqueId from "../../../src/utils/unique-id";

export class MyRoom extends Room<MyRoomState> {
  maxPlayers = 5;

  onCreate(options: any) {
    this.setState(new MyRoomState());

    this.onMessage("*", (client, type, message) => {
      console.log(type, message)
      switch (type) {
        // mock adding a new player
        case "add_player":
          const mockPlayerId = uniqueId();
          this.state.players.set(
            mockPlayerId,
            new Player().assign({
              id: mockPlayerId,
              name: uniqueId({ prefix: "name" }),
            }),
          );
          break;
        case "remove_player":
          const player = this.state.players.get(message);
          if (!player) return;
          this.state.players.delete(message);
          break;
        case "update_player":
          this.state.updatePlayer(client.sessionId, message);
          break;

        case 'select_character':
          const character = this.state.characters.find(char => char.id === message);
          console.log(character, 'THE CHARACTER')
          if (!character) return;
          character.assignedToPlayer = client.sessionId;
          break;
        case 'unselect_character':
          const characterToUnselect = this.state.characters.find(char => char.id === message);
          if (!characterToUnselect) return;
          characterToUnselect.assignedToPlayer = "";
          break;
      }
    });
  }

  onJoin(client: Client, options: any) {
    const newPlayer = new Player().assign({
      id: client.sessionId,
      name: uniqueId({ prefix: "name" }),
    });
    this.state.players.set(client.sessionId, newPlayer);
  }

  onLeave(client: Client, consented: boolean) {
    this.state.players.delete(client.sessionId);
  }
}
