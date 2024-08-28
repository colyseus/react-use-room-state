import { ArraySchema, Schema, ToJSON, type } from "@colyseus/schema";
import uniqueId from "../../../../src/utils/unique-id";

export class Character extends Schema {
  @type("string") id: string;
  @type("string") name: string;
  @type("string") assignedToPlayer: string;
}

export class Player extends Schema {
  @type("string") id: string;
  @type("string") name: string;
}

export class MyRoomState extends Schema {
  @type("string") status = "lobby";
  @type({ map: Player }) players = new Map<string, Player>();
  @type([Character]) characters = new ArraySchema<Character>();

  constructor() {
    super();

    const availableCharacters = ["Goku", "Vegeta", "Piccolo"].map((name) =>
      new Character().assign({
        id: uniqueId({ prefix: "char" }),
        name,
        assignedToPlayer: "",
      }),
    );
    this.characters.push(...availableCharacters);
  }

  updatePlayer(playerId: string, updatedKeys: Partial<ToJSON<Player>>) {
    const player = this.players.get(playerId);
    if (player) {
      Object.entries(updatedKeys).forEach(([key, value]) => {
        // Check if the key is a valid key of Player
        if (key in player) {
          const safeKey = key as keyof Player;
          // @ts-expect-error
          player[safeKey] = value;
        }
      });
    }
  }
}
