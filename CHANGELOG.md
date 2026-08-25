# Changelog

## 0.18.2

- Pairs with `@colyseus/sdk` 0.18.2, which merges the `smoothing`/`damping` options into one `smoothMs` (time constant in ms; `smoothMs = 1000 / old value`). No API change in the hooks themselves — option types flow through from the SDK.

## 0.18.1

### Fixes

- Selectors that build their own container no longer crash the component with `Maximum update depth exceeded`. `useRoomState(room, (s) => Array.from(s.players.values()))` and `(s) => ({ message: s.myString })` now hold a stable reference between renders. ([#13](https://github.com/colyseus/react-tools/pull/13), reported by [@under-undefined](https://github.com/under-undefined), who also contributed the regression tests — thank you!)
- Object-literal selectors return plain snapshot data, the way array selectors already did. `(s) => ({ player: s.players.get(id) })` previously handed back the live schema node, which also left `getSchemaInstance()` unable to resolve it.

## 0.18.0

Targets Colyseus 0.18 / `@colyseus/schema` v5. From this release on, the package version tracks Colyseus itself — `@colyseus/react` 0.18.x pairs with colyseus 0.18 — hence the jump from 0.1.17.

### Breaking

- Peer dependencies are now `@colyseus/sdk` ^0.18.1, `@colyseus/schema` ^5.0.8 and `@colyseus/shared-types` ^0.18.1. Projects on colyseus 0.17 / schema v4 should stay on the 0.1.x line.

### Features

- **Predict hooks** — React bindings for the 0.18 Predict netcode (client prediction, reconciliation, remote smoothing). Every hook exists standalone (`useX(room, ...)`) and room-bound from `createRoomContext(options)`, with shared Predict options passed once via `createRoomContext({ predict: { mode: "lerp", delay: 100 } })`. See the README's netcode section for usage and the structure-vs-motion rule.
  - `usePredict` — the room's shared `Predict` instance. `Predict.get()` constructs a fresh instance per call, so the hook memoizes one per room, reference-counts consumers, and disposes it (StrictMode-safe, deferred) when the last consumer unmounts.
  - `useInput` — the room's `InputHandle` (`room.input()`, idempotent and stable per room).
  - `usePredictLoop` — the frame driver: `predict.tick(now)` once per frame, then your fixed-step send callback. Owns its own `requestAnimationFrame`, or with `{ external: true }` returns a `drive(now)` function for a frame loop you already have (e.g. R3F `useFrame`).
  - `useReconciler` — active prediction for the entity you control, with the lifecycle handled: waits for late spawn, recreates the controller when the server replaces the instance, disposes on unmount.
  - `useAttachAll` — passive smoothing for a root-state collection (`predict.attachAll()`) as an effect, detached on unmount.
  - `useEventChannel` — optimistic events (`predict.defineEvent()`) with teardown plus reactivity: the calling component re-renders on predict/confirm/reject, so `has(key)`-style derives work in plain render code.
  - `useEntityInstance` / `useSessionEntity` — select decoded schema instances (what the Predict APIs key off), re-rendering only on identity change, never on field updates.
  - `useInputBuffer` — the buffer-then-consume tap recipe: `press()` in the event handler, `consume()` lands it on exactly one fixed step.
  - `getSchemaInstance(snapshot)` — bridges `useRoomState` snapshots back to their decoded instance for `predict.value()` reads (recorded during snapshot creation via a `WeakMap`, so lookups are free).

### Fixes

- Schema v5 compatibility for the snapshot layer:
  - `refId` is read via v5's `Symbol.for("$refId")` tag, with the v4 `~refId` string key kept as a fallback.
  - Field-name derivation tolerates v5's mixed `Metadata` shape (index→field objects plus name→index reverse entries).
  - A no-op `decoder.triggerChanges` is seeded — v5 only collects and returns `DataChange[]` when a subscriber exists, and the subscription wrapper relies on the returned changes.
- `Snapshot<T>` strips the Schema base internals that v5 declares publicly (`isTrackingPaused`, the symbol-keyed `$refId`/`$values`), and accepts plain `Array`/`Map`-shaped interfaces — the newly exported `IArray` / `IMap` types — so frontends can type component props without importing `@colyseus/schema`. Covered by compile-time assertions in `snapshotType.test.ts`. ([#9](https://github.com/colyseus/react-tools/pull/9) by [@FTWinston](https://github.com/FTWinston))
- The `prepare` script (replacing `prepublishOnly`) builds `dist/` on install, so git revisions work directly: `npm install colyseus/react-tools#0.18`. ([#9](https://github.com/colyseus/react-tools/pull/9) by [@FTWinston](https://github.com/FTWinston))
- Server-rendering a component that reads room state no longer crashes with `Missing getServerSnapshot, which is required for server-rendered content`. Every hook that reads a room — `useRoomState`, `useColyseusState`, the `createRoomContext` / `createLobbyContext` hooks, and the predict hooks — now renders on the server as if no room were connected, and picks up the live room right after hydration. ([#12](https://github.com/colyseus/react-tools/pull/12) by [@under-undefined](https://github.com/under-undefined))
- The package now ships a `"use client"` directive, so importing it from a Next.js App Router Server Component no longer fails the build with `You're importing a component that needs useState`. Marking your own component `"use client"` is no longer required just to import a hook.

### Tests

- Test harnesses now call `discardChanges()` after each `encode()`, matching what colyseus core does — without it, schema v5 re-emits stale ops against a frozen index space and corrupts sequential array-splice patches (this had 4 array tests failing).
- New `predictHooks.test.tsx` suite covering the Predict hooks (lifecycle, ref-counting, StrictMode, event-channel reactivity, entity selection).

## 0.1.19

The colyseus 0.17 / schema v4 line; 0.18.1 carries the same fixes.

### Fixes

- Selectors that build their own container no longer crash the component with `Maximum update depth exceeded`. `useRoomState(room, (s) => Array.from(s.players.values()))` and `(s) => ({ message: s.myString })` now hold a stable reference between renders. ([#13](https://github.com/colyseus/react-tools/pull/13), reported by [@under-undefined](https://github.com/under-undefined), who also contributed the regression tests — thank you!)
- Object-literal selectors return plain snapshot data, the way array selectors already did. `(s) => ({ player: s.players.get(id) })` previously handed back the live schema node.

## 0.1.18

### Fixes

- Server-rendering a component that reads room state no longer crashes with `Missing getServerSnapshot, which is required for server-rendered content`. `useRoomState`, `useColyseusState` and the `createRoomContext` / `createLobbyContext` hooks now render on the server as if no room were connected — rooms and decoder state are client-side objects, never serialized for hydration — and pick up the live room right after hydration. ([#12](https://github.com/colyseus/react-tools/pull/12) by [@under-undefined](https://github.com/under-undefined))

## 0.1.17

### Fixes

- Nested `ArraySchema` values inside a `MapSchema` (e.g. `items.get(key).tags`) could still go stale during normal, mounted gameplay — not only across remounts as 0.1.16 addressed. 0.1.16 accumulated the dirty set until a snapshot consumed it, but with several hooks sharing one room subscription, an unrelated hook re-rendering between two decodes could let the next decode clear a mark another hook had not yet consumed, leaving that hook's nested value stale. The dirty set is no longer bulk-cleared on any schedule: a ref's mark is removed only when a snapshot actually rebuilds that ref, so it survives across any number of decodes and unrelated re-renders until the owning hook re-renders and consumes it. Marks are tracked only for refs that already have a cached result (`dirtyRefIds ⊆ resultsByRefId`), which keeps the set bounded by the cache with no extra bookkeeping. Re-render counts and snapshot performance are unchanged. ([#10](https://github.com/colyseus/react-tools/issues/10), follow-up repro by [@konistehrad](https://github.com/konistehrad))

## 0.1.16

### Fixes

- Nested `ArraySchema` values inside a `MapSchema` (e.g. `items.get(key).tags`) could stay stale — the live decoded state was correct, but the snapshot kept the old value. Dirty tracking cleared its set at the start of every decode, so when two or more decodes arrived with no snapshot in between — which happens whenever the hook is not subscribed while patches arrive (the component is unmounted on a route/tab switch, behind a conditional, virtualized out of a list, …) and then remounts — the second decode wiped the first's marks and the snapshot short-circuited the stale subtree. The dirty set now accumulates across decodes and is cleared only once a snapshot has consumed it. ([#10](https://github.com/colyseus/react-tools/issues/10), reported by [@konistehrad](https://github.com/konistehrad))

## 0.1.15

### Performance

- Dropped the per-decode `objectToRefId` reverse-lookup `Map` rebuild. The decoder already tags every Schema/ArraySchema/MapSchema instance with `~refId`, and `DataChange` carries `refId` directly — both are used instead. Eliminates ~137 KB/op of garbage per decode on a 200-player state.
- Unified `previousResultsByRefId` / `currentResultsByRefId` into a single persistent cache plus a reused `visitedThisPass` set. Removes a per-render `Map` allocation and copy loop in `useColyseusState`.
- Memoized `getSchemaFieldNames` per Schema constructor (was `Object.values(metadata).map(...)` on every visit).
- Replaced `Object.keys(prev).length !== Object.keys(next).length` MapSchema size check with a count vs `node.size` comparison (no array allocations).
- Parent-chain dirty walk now short-circuits once it hits an already-dirty ancestor.

Measured on a synthetic "50 of 200 players mutate each tick" benchmark: **~25% faster**, **~99% less allocation** per tick.

### Tests

- +60 tests covering: selectors, primitive `ArraySchema` / `MapSchema`, `Schema` reference reassignment, `MapSchema.clear()`, multiple hooks sharing a subscription, late-binding state/decoder, `useRoomMessage`, `useLobbyRoom`, `useQueueRoom`, `createRoomContext`, `createLobbyContext`, and coexistence with `getDecoderStateCallbacks` (`onAdd` / `onRemove` / `onChange` / `listen`).
- New opt-in microbenchmark at `src/tests/bench.test.ts` (`BENCH=1 NODE_OPTIONS=--expose-gc npx vitest run src/tests/bench.test.ts`).
