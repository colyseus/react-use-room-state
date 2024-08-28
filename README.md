# Experimenting with `useRoomState` hook

> This is a work-in-progress experiment and currently does not work as expected.

The idea here is to create a React hook that is able to trigger a re-render only when the requested portion of the state receives an update.

Since `@colyseus/schema` v3 exposes the `.triggerChanges` method from the `Decoder` - we can hopefully use this to our advantage.

Inspiration/previous work has been done by [@pedr0fontoura](https://github.com/pedr0fontoura) on [pedr0fontoura/use-colyseus/](https://github.com/pedr0fontoura/use-colyseus/)

## Overview

The `App.tsx` uses `useRoomState()` to "subscribe" to simulated room state changes:

```typescript
function App() {
  const state = useRoomState((state) => state);
  // ...
}
```

The simulation of server-side changes are made via `simulatePatchState()`:

```typescript
simulatePatchState((state) => {
  const randomKey = Array.from(state.players.keys())[
    Math.floor(Math.random() * state.players.size)
  ];
  state.players.delete(randomKey);
});
```
