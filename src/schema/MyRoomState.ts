import { MapSchema, Schema, type } from "@colyseus/schema"

export class Position extends Schema {
   @type('number') x = 0;
   @type('number') y = 0;
}

export class Player extends Schema {
  @type('string') name: string = "Player";
  @type(Position) position = new Position();
}

export class MyRoomState extends Schema {
  @type('string') myString = "Hello world!";
  @type({ map: Player }) players = new MapSchema<Player>();
}