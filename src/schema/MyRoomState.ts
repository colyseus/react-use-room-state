import { MapSchema, Schema, defineTypes } from "@colyseus/schema"

/**
 * I couldn't find a way to enable "experimentalDecorators" using Vite + TypeScript...
 * That's why I'm using the `defineTypes` instead of the `@type` decorator.
 */

export class Position extends Schema {
  x: number = 0;
  y: number = 0;
}
defineTypes(Position, {
  x: "number",
  y: "number",
})

export class Player extends Schema {
  name: string = "Player";
  position: Position = new Position();
}
defineTypes(Player, {
  name: "string",
  position: Position,
});

export class MyRoomState extends Schema {
  myString: string = "Hello world!";
  players: MapSchema<Player> = new MapSchema<Player>();
}
defineTypes(MyRoomState, {
  myString: "string",
  players: { map: Player },
});
