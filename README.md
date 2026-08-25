# @colyseus/react

React hooks for [Colyseus](https://colyseus.io/) multiplayer applications.

![](image.webp)

## Installation

```bash
npm install @colyseus/react
```

**Peer dependencies:** `@colyseus/sdk`, `@colyseus/schema`, and `react` (>=18.3.1).

## Server-side rendering

Every hook is safe to render on the server. A room is a live client-side
connection and is never serialized for hydration, so on the server the hooks
render as though nothing is connected — `useRoomState()` returns `undefined`,
`useRoom()` reports `isConnecting: true`, and the predict hooks return
`undefined`. Connection happens in an effect, so the live room arrives on the
re-render right after hydration.

Render the connecting state rather than assuming state exists:

```tsx
const players = useRoomState((state) => state.players);
if (!players) return <Spinner />;   // server render + first client paint
```

The package ships a `"use client"` directive, so you can import it from a
Next.js App Router Server Component without the build failing. The hooks
themselves still run on the client, as any React hook does.

## Hooks

### `useRoom(callback, deps?)`

Manages the lifecycle of a Colyseus room connection. Handles connecting, disconnecting on unmount, and reconnecting when dependencies change. Works correctly with React StrictMode.

```tsx
import { Client } from "@colyseus/sdk";
import { useRoom } from "@colyseus/react";

const client = new Client("ws://localhost:2567");

function Game() {
  const { room, error, isConnecting } = useRoom(
    () => client.joinOrCreate("game_room"),
  );

  if (isConnecting) return <p>Connecting...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <GameView room={room} />;
}
```

The first argument is a callback that returns a `Promise<Room>` — any Colyseus matchmaking method works (`joinOrCreate`, `join`, `create`, `joinById`, `consumeSeatReservation`).

**Reconnecting on dependency changes:**

```tsx
const { room } = useRoom(
  () => client.joinOrCreate("game_room", { level }),
  [level],
);
```

When `level` changes the previous room is left and a new connection is established.

**Conditional connection:**

Pass a falsy value to skip connecting until a condition is met:

```tsx
const { room } = useRoom(
  isReady ? () => client.joinOrCreate("game_room") : null,
  [isReady],
);
```

### `useRoomState(room, selector?)`

Subscribes to Colyseus room state changes and returns immutable plain-object snapshots. Unchanged portions of the state tree keep referential equality between renders, so React components only re-render when the data they use actually changes.

```tsx
import { useRoom, useRoomState } from "@colyseus/react";

function Game() {
  const { room } = useRoom(() => client.joinOrCreate("game_room"));
  const state = useRoomState(room);

  if (!state) return <p>Waiting for state...</p>;

  return <p>Players: {state.players.size}</p>;
}
```

**Using a selector** to subscribe to a subset of the state:

```tsx
const players = useRoomState(room, (state) => state.players);
```

Only components that read `players` will re-render when the players map changes.

### `useRoomMessage(room, type, callback)`

Subscribes to Colyseus room messages. The callback is kept in a ref so it is always up-to-date without re-subscribing. Automatically unsubscribes when the room changes or the component unmounts.

```tsx
import { useRoom, useRoomMessage } from "@colyseus/react";

function Chat() {
  const { room } = useRoom(() => client.joinOrCreate("game_room"));
  const [messages, setMessages] = useState<string[]>([]);

  useRoomMessage(room, "chat", (message) => {
    setMessages((prev) => [...prev, message]);
  });

  return (
    <ul>
      {messages.map((msg, i) => <li key={i}>{msg}</li>)}
    </ul>
  );
}
```

Pass `"*"` as the type to listen to all message types.

### `useLobbyRoom(callback, deps?)`

Connects to a Colyseus [Lobby Room](https://docs.colyseus.io/builtin-rooms/lobby/) and provides a live-updating list of available rooms. The list is automatically maintained as rooms are created, updated, and removed.

```tsx
import { Client } from "@colyseus/sdk";
import { useLobbyRoom } from "@colyseus/react";

const client = new Client("ws://localhost:2567");

function Lobby() {
  const { rooms, error, isConnecting } = useLobbyRoom(
    () => client.joinOrCreate("lobby"),
  );

  if (isConnecting) return <p>Connecting...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <ul>
      {rooms.map((room) => (
        <li key={room.roomId}>
          {room.name} — {room.clients}/{room.maxClients} players
        </li>
      ))}
    </ul>
  );
}
```

**Return value:**

| Field | Type | Description |
|---|---|---|
| `rooms` | `RoomAvailable<Metadata>[]` | Live list of available rooms |
| `room` | `Room \| undefined` | The underlying lobby room connection |
| `error` | `Error \| undefined` | Connection error, if any |
| `isConnecting` | `boolean` | `true` while connecting to the lobby |

### `useQueueRoom(connect, consume, deps?)`

Manages the full lifecycle of a Colyseus matchmaking queue: connecting to the queue room, tracking group size, receiving a seat reservation, confirming, and consuming the seat to join the match room. Cleans up both rooms on unmount.

```tsx
import { Client } from "@colyseus/sdk";
import { useQueueRoom } from "@colyseus/react";

const client = new Client("ws://localhost:2567");

function Matchmaking() {
  const { room, clients, isWaiting, error } = useQueueRoom(
    () => client.joinOrCreate("queue", { rank: 1200 }),
    (reservation) => client.consumeSeatReservation(reservation),
  );

  if (error) return <p>Error: {error.message}</p>;
  if (room) return <GameScreen room={room} />;
  if (isWaiting) return <p>Waiting for match... {clients} players in group</p>;
  return <p>Connecting...</p>;
}
```

The first argument connects to the queue room. The second argument is called with the `SeatReservation` once a match is found — use `client.consumeSeatReservation()` to join the match room.

**Return value:**

| Field | Type | Description |
|---|---|---|
| `room` | `Room \| undefined` | The match room, once the seat has been consumed |
| `queue` | `Room \| undefined` | The queue room while waiting (undefined after match is joined) |
| `clients` | `number` | Number of clients in the current matchmaking group |
| `seat` | `SeatReservation \| undefined` | The seat reservation, once received |
| `error` | `Error \| undefined` | Connection or matchmaking error |
| `isWaiting` | `boolean` | `true` while connected to the queue and waiting for a match |

## Netcode hooks (Colyseus 0.18+)

React bindings for the `@colyseus/sdk` Predict tools — client prediction, reconciliation and remote smoothing. See the [netcode docs](https://docs.colyseus.io/netcode/client-prediction) for the underlying concepts.

**The one rule:** structure renders through snapshots, motion renders through predict reads. `useRoomState` re-renders at patch rate with **raw synced values** — rendering positions from it gives you jittery patch-rate motion. Predicted/smoothed values change every frame and must stay out of the React render cycle: read them with `predict.value(instance, field)` inside your frame loop (R3F `useFrame`, or the `usePredictLoop` callback) and write into refs.

All hooks below exist in two forms: standalone (`useX(room, ...)`) and bound (returned by `createRoomContext(options)`, no room argument). Pass Predict options once via `createRoomContext({ predict: { mode: "lerp", delay: 100 } })`.

### `usePredict(room, options?)`

Returns the room's shared `Predict` instance. `Predict.get()` constructs a fresh instance per call, so the hook memoizes one per room, reference-counts consumers, and disposes it when the last consumer unmounts.

### `useInput(room, options?)`

Returns the room's `InputHandle` (`room.input()` — idempotent, stable per room). Stage fields on `input.data`, then `input.send()` once per fixed step inside the `usePredictLoop` callback.

### `usePredictLoop(room, onSteps, options?)`

Owns the per-frame driver: calls `predict.tick(now)` once per frame and hands you the number of fixed steps due — stage + send exactly that many inputs inside the callback ("send before you read"). By default it runs its own `requestAnimationFrame`; with `{ external: true }` it returns a `drive(now?)` function to call from a frame loop you already have:

```tsx
// React Three Fiber — drive at an early priority so ticks precede reads:
const drive = usePredictLoop(onSteps, { external: true });
useFrame(() => drive(), -1);
```

### `useReconciler(room, select, options)`

Active prediction for the entity you control — `predict.reconciler()` with the lifecycle handled: waits for the entity to spawn (`select: (state, room) => instance`), recreates the controller if the server replaces the instance, and disposes on unmount. `options.input` defaults to the room's handle.

```tsx
const me = useReconciler(
  (state, room) => state.players.get(room.sessionId),
  { step: (ctx, p, cmd) => applyInput(p, cmd, ctx.dt), smoothing: 15, snap: 5 },
);
```

### `useAttachAll(room, key, config, deps?)`

Passive smoothing for a root-state collection — `predict.attachAll()` as an effect, detached on unmount. Attach angular fields in a separate call:

```tsx
useAttachAll("players", { mode: "lerp", fields: ["x", "y", "z"] });
useAttachAll("players", { mode: "lerp", fields: ["heading"], angle: true });
```

### `useEventChannel(room, options)`

Optimistic event channel — `predict.defineEvent()` with teardown on unmount, **plus reactivity**: the calling component re-renders on predict/confirm/reject/unpredicted, so flag-shaped derives work in plain render code:

```tsx
const pickups = useEventChannel({
  confirmOn: { collection: "items", field: "alive", equals: false },
});
const hidden = !item.alive || pickups?.has(id);
```

### `useEntityInstance(room, select)` / `useSessionEntity(room, collectionKey)`

Select a **decoded schema instance** (what the Predict APIs key off), re-rendering only when its identity changes — never on field updates. `useSessionEntity` is the common case: your own entity by `sessionId`.

### `getSchemaInstance(snapshot)`

Bridges `useRoomState` snapshots back to their decoded instance, for `predict.value()` reads on entities you render from snapshot lists:

```tsx
const source = getSchemaInstance(playerSnapshot);
useFrame(() => { ref.current.position.x = predict.value(source, "x"); });
```

### `useInputBuffer()`

The ["buffer, then consume"](https://docs.colyseus.io/netcode/recipes#taps-between-steps-buffer-then-consume) input recipe as a hook: `press()` in the React event handler, `consume()` inside the send loop so a tap lands on exactly one fixed step — never lost on a 0-step frame, never doubled on a multi-step frame.

For a complete working example (R3F + prediction + remote lerp), see [r3f-lobby-car-prototype](https://github.com/endel/r3f-lobby-car-prototype).

## Contexts

### `createRoomContext()`

Creates a set of hooks and a `RoomProvider` component that share a single room connection across React reconciler boundaries (e.g. DOM + React Three Fiber). The room is stored in a closure-scoped external store rather than React Context, so the hooks work in any reconciler tree that imports them.

```tsx
import { Client } from "@colyseus/sdk";
import { createRoomContext } from "@colyseus/react";

const client = new Client("ws://localhost:2567");

const { RoomProvider, useRoom, useRoomState } = createRoomContext();
```

**Wrap your app with `RoomProvider`:**

```tsx
function App() {
  return (
    <RoomProvider connect={() => client.joinOrCreate("game_room")}>
      <UI />
      <Canvas>
        <GameScene />
      </Canvas>
    </RoomProvider>
  );
}
```

`RoomProvider` accepts a `connect` callback (same as the standalone `useRoom` hook) and an optional `deps` array. Pass a falsy value to `connect` to defer the connection.

**Use the hooks in any component — DOM or R3F:**

```tsx
function UI() {
  const { room, error, isConnecting } = useRoom();
  const players = useRoomState((state) => state.players);

  if (isConnecting) return <p>Connecting...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <p>Players: {players?.size}</p>;
}
```

The returned `useRoom()` and `useRoomState(selector?)` work identically to the standalone hooks but don't require you to pass the room as an argument.

### `createLobbyContext()`

Creates a `LobbyProvider` and `useLobby` hook for sharing lobby room data globally across your app — useful when you need room metadata available persistently alongside an active game room, not just on a lobby screen. Like `createRoomContext`, it uses a closure-scoped external store so the hook works across reconciler boundaries.

```tsx
import { Client } from "@colyseus/sdk";
import { createLobbyContext, createRoomContext } from "@colyseus/react";

const client = new Client("ws://localhost:2567");

const { LobbyProvider, useLobby } = createLobbyContext<MyMetadata>();
const { RoomProvider, useRoom, useRoomState } = createRoomContext();
```

**Wrap your app with `LobbyProvider` (can nest with `RoomProvider`):**

```tsx
function App() {
  return (
    <LobbyProvider connect={() => client.joinOrCreate("lobby")}>
      <RoomProvider connect={() => client.joinOrCreate("game_room")}>
        <UI />
        <Canvas>
          <GameScene />
        </Canvas>
      </RoomProvider>
    </LobbyProvider>
  );
}
```

`LobbyProvider` accepts a `connect` callback (same as `useLobbyRoom`) and an optional `deps` array. The lobby connection persists independently of the game room.

**Access lobby data from any component — even deep inside the game:**

```tsx
function RoomBrowser() {
  const { rooms, error, isConnecting } = useLobby();

  if (isConnecting) return <p>Loading rooms...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <ul>
      {rooms.map((room) => (
        <li key={room.roomId}>
          {room.metadata.displayName} — {room.clients}/{room.maxClients}
        </li>
      ))}
    </ul>
  );
}
```

The returned `useLobby()` hook provides the same fields as `useLobbyRoom` (`rooms`, `room`, `error`, `isConnecting`).

## Credits

Inspiration and previous work by [@pedr0fontoura](https://github.com/pedr0fontoura) — [use-colyseus](https://github.com/pedr0fontoura/use-colyseus/).
Rewrite and new `useRoomState()` made by [@FTWinston](https://github.com/FTWinston).
