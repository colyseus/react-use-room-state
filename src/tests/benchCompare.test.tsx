/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { test } from 'vitest';
import { Schema, ArraySchema, MapSchema, Encoder, Decoder, type DataChange, type } from "@colyseus/schema";
import v8 from "node:v8";
import { renderHook, act } from '@testing-library/react';
import { useCallback, useRef, useSyncExternalStore } from 'react';

// Opt-in: BENCH=1 npx vitest run src/tests/benchCompare.test.tsx
const runBench = process.env.BENCH === "1";
const maybeTest = runBench ? test : test.skip;
Encoder.BUFFER_SIZE = 8 * 1024 * 1024;

import { createSnapshot, SnapshotContext } from "../schema/createSnapshot";
import { getOrCreateSubscription } from "../schema/getOrCreateSubscription";
import { useColyseusState } from "../schema/useColyseusState";

// ───────────────────────────── schema ─────────────────────────────
class Cell extends Schema {
  @type("number") value = 0;
  @type("boolean") revealed = false;
}
class Player extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type([Cell]) inventory = new ArraySchema<Cell>();
}
class State extends Schema {
  @type("number") tick = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type([Cell]) cells = new ArraySchema<Cell>();
}

function simulate<T extends Schema>(make: () => T) {
  const server = make();
  const encoder = new Encoder(server);
  const client = make();
  const decoder = new Decoder(client);
  const apply = (fn: (s: T) => void) => {
    fn(server);
    const bytes = encoder.encode();
    decoder.decode(new Uint8Array(bytes));
    encoder.discardChanges();
  };
  apply(() => {});
  return { server, client, decoder, apply };
}

// ───────── BASELINE engine: the dirty-Set the version map replaced ─────────
// Structural sharing identical to createSnapshot.ts; the ONLY difference is the
// short-circuit test (Set.has vs version compare) and the decode-side marking.
const REF_ID_KEY = "~refId";
const fieldCache = new WeakMap<Function, string[]>();
function fields(node: any): string[] {
  const ctor = node.constructor as Function;
  const c = fieldCache.get(ctor); if (c) return c;
  const md = (ctor as any)?.[Symbol.metadata];
  const names = md ? Object.values(md).map((f: any) => f.name) : [];
  fieldCache.set(ctor, names); return names;
}
function refOf(n: any): number { const r = n?.[REF_ID_KEY]; return typeof r === "number" ? r : -1; }
interface BaseCtx { results: Map<number, any>; visited: Set<number>; dirty: Set<number>; parents: Map<number, number>; parent: number; }
function baseSnapshot(node: any, ctx: BaseCtx): any {
  if (node === null || node === undefined || typeof node !== "object") return node;
  const refId = refOf(node);
  if (refId !== -1 && ctx.parent !== -1) ctx.parents.set(refId, ctx.parent);
  if (refId !== -1 && ctx.visited.has(refId)) return ctx.results.get(refId);
  const prev = refId !== -1 ? ctx.results.get(refId) : undefined;
  if (refId !== -1 && prev !== undefined && !ctx.dirty.has(refId)) { ctx.visited.add(refId); return prev; }
  const saved = ctx.parent; ctx.parent = refId;
  let result: any;
  if (typeof node.set === "function") {
    const out: any = {}; let changed = prev === undefined;
    for (const [k, v] of node) { const sv = baseSnapshot(v, ctx); out[k] = sv; if (!changed && prev && prev[k] !== sv) changed = true; }
    if (!changed && prev) { let n = 0; for (const _ in prev) n++; if (n !== node.size) changed = true; }
    result = changed ? out : prev;
  } else if (typeof node.push === "function") {
    const len = node.length; let changed = !prev || !Array.isArray(prev) || len !== prev.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) { const sv = baseSnapshot(node.at(i), ctx); out[i] = sv; if (!changed && prev && prev[i] !== sv) changed = true; }
    result = changed ? out : prev;
  } else if (Schema.isSchema(node)) {
    const out: any = {}; let changed = prev === undefined;
    for (const f of fields(node)) { const v = (node as any)[f]; if (typeof v === "function") continue; const sv = baseSnapshot(v, ctx); out[f] = sv; if (!changed && prev && prev[f] !== sv) changed = true; }
    result = changed ? out : prev;
  } else { result = node; }
  ctx.parent = saved;
  if (refId !== -1) { ctx.results.set(refId, result); ctx.visited.add(refId); }
  return result;
}
interface BaseSub { listeners: Set<() => void>; results: Map<number, any>; visited: Set<number>; dirty: Set<number>; parents: Map<number, number>; original: any; }
const baseSubs = new WeakMap<Schema, BaseSub>();
function getBaseSub(state: Schema, decoder: Decoder): BaseSub {
  const e = baseSubs.get(state); if (e) return e;
  const sub: BaseSub = { listeners: new Set(), results: new Map(), visited: new Set(), dirty: new Set(), parents: new Map(), original: decoder.decode };
  decoder.decode = function (this: Decoder, ...args: any[]) {
    sub.dirty.clear(); // pre-fix behavior
    const changes: DataChange[] = sub.original.apply(decoder, args);
    if (changes && changes.length) {
      for (const ch of changes) { let cur: number | undefined = (ch as any).refId; while (cur !== undefined && !sub.dirty.has(cur)) { sub.dirty.add(cur); cur = sub.parents.get(cur); } }
      sub.listeners.forEach((cb) => cb());
    }
    return changes;
  };
  baseSubs.set(state, sub); return sub;
}
function baseTake(state: Schema, sub: BaseSub) {
  sub.visited.clear();
  return baseSnapshot(state, { results: sub.results, visited: sub.visited, dirty: sub.dirty, parents: sub.parents, parent: -1 });
}

// ───────── version engine wrappers (the shipped code) ─────────
function verTake(state: Schema, decoder: Decoder, sub: ReturnType<typeof getOrCreateSubscription>) {
  sub.visitedThisPass.clear();
  const ctx: SnapshotContext = {
    refs: decoder.root?.refs, resultsByRefId: sub.resultsByRefId, visitedThisPass: sub.visitedThisPass,
    dirtyRefIds: sub.dirtyRefIds,
    parentRefIdMap: sub.parentRefIdMap, currentParentRefId: -1,
  };
  return createSnapshot(state, ctx);
}

// ───────────────────────────── harness ─────────────────────────────
function measure(fn: () => void, iters: number) {
  for (let i = 0; i < Math.min(50, iters); i++) fn();
  let bestTime = Infinity, bestAlloc = Infinity;
  for (let r = 0; r < 6; r++) {
    if (global.gc) global.gc();
    const a0 = v8.getHeapStatistics().malloced_memory;
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn();
    const t1 = performance.now();
    const a1 = v8.getHeapStatistics().malloced_memory;
    const perOp = ((t1 - t0) / iters) * 1000;
    const alloc = (a1 - a0) / iters;
    if (perOp < bestTime) bestTime = perOp;
    if (alloc > 0 && alloc < bestAlloc) bestAlloc = alloc;
  }
  return { time: bestTime, alloc: bestAlloc };
}

function row(name: string, ver: { time: number; alloc: number }, base: { time: number; alloc: number }) {
  const dt = ((ver.time - base.time) / base.time) * 100;
  const sign = dt >= 0 ? "+" : "";
  const vAlloc = ver.alloc === Infinity ? "~" : (ver.alloc / 1024).toFixed(2);
  const bAlloc = base.alloc === Infinity ? "~" : (base.alloc / 1024).toFixed(2);
  console.log(
    name.padEnd(44) +
    `ver ${ver.time.toFixed(3).padStart(8)}µs  base ${base.time.toFixed(3).padStart(8)}µs  Δ ${(sign + dt.toFixed(1) + "%").padStart(8)}` +
    `   alloc ver ${vAlloc.padStart(7)}KB base ${bAlloc.padStart(7)}KB`
  );
}

// Build a populated state and parallel ver/base setups fed identical patches.
function build(populate: (s: State) => void) {
  const ver = simulate(() => new State());
  const base = simulate(() => new State());
  const apply = (fn: (s: State) => void) => { ver.apply(fn); base.apply(fn); };
  apply(populate);
  const verSub = getOrCreateSubscription(ver.client, ver.decoder);
  const baseSub = getBaseSub(base.client, base.decoder);
  verTake(ver.client, ver.decoder, verSub);
  baseTake(base.client, baseSub);
  return { ver, base, apply, verSub, baseSub,
    verSnap: () => verTake(ver.client, ver.decoder, verSub),
    baseSnap: () => baseTake(base.client, baseSub) };
}

maybeTest("bench: shipped (consume-on-rebuild) vs pre-fix (clear-per-decode)", () => {
  console.log("\n=== snapshot / decode engine: shipped (consume-on-rebuild) vs pre-fix (clear-per-decode) ===\n");

  // 200 players × 10 inventory cells ≈ 2400 refs
  {
    const b = build((s) => {
      for (let i = 0; i < 200; i++) { const p = new Player(); p.name = "p" + i;
        for (let j = 0; j < 10; j++) { const c = new Cell(); c.value = j; p.inventory.push(c); }
        s.players.set("p" + i, p); }
    });
    row("2400 refs · snapshot-only (no change)",
      measure(b.verSnap, 3000), measure(b.baseSnap, 3000));
    row("2400 refs · decode+snapshot (tick++)",
      measure(() => { b.ver.apply((s) => s.tick++); b.verSnap(); }, 400),
      measure(() => { b.base.apply((s) => s.tick++); b.baseSnap(); }, 400));
    row("2400 refs · decode+snapshot (1 deep cell++)",
      measure(() => { b.ver.apply((s) => s.players.get("p0")!.inventory.at(0)!.value++); b.verSnap(); }, 400),
      measure(() => { b.base.apply((s) => s.players.get("p0")!.inventory.at(0)!.value++); b.baseSnap(); }, 400));
  }

  // 2000-element flat array
  {
    const b = build((s) => { for (let i = 0; i < 2000; i++) { const c = new Cell(); c.value = i; s.cells.push(c); } });
    row("2000 cells · snapshot-only (no change)",
      measure(b.verSnap, 3000), measure(b.baseSnap, 3000));
    row("2000 cells · decode+snapshot (cells[0]++)",
      measure(() => { b.ver.apply((s) => s.cells.at(0)!.value++); b.verSnap(); }, 400),
      measure(() => { b.base.apply((s) => s.cells.at(0)!.value++); b.baseSnap(); }, 400));
  }

  // many simultaneous changes
  {
    const b = build((s) => { for (let i = 0; i < 200; i++) { const p = new Player(); p.name = "p" + i; s.players.set("p" + i, p); } });
    row("200p · decode+snapshot (50 players move)",
      measure(() => { b.ver.apply((s) => { for (let i = 0; i < 50; i++) s.players.get("p" + i)!.x++; }); b.verSnap(); }, 300),
      measure(() => { b.base.apply((s) => { for (let i = 0; i < 50; i++) s.players.get("p" + i)!.x++; }); b.baseSnap(); }, 300));
    row("200p · decode-only marking (tick++)",
      measure(() => b.ver.apply((s) => s.tick++), 400),
      measure(() => b.base.apply((s) => s.tick++), 400));
  }

  console.log("\n(ver = shipped consume-on-rebuild; base = pre-fix clear-per-decode; Δ = ver vs base)\n");
});

// Baseline (dirty-set) React hook, same shape as useColyseusState.
function useBaseColyseusState<T extends Schema, U>(state: T, decoder: Decoder<T>, selector: (s: T) => U): U {
  const selRef = useRef(selector); selRef.current = selector;
  const getSnapshot = useCallback(() => {
    const sub = getBaseSub(state, decoder);
    sub.visited.clear();
    return baseSnapshot(selRef.current(state), { results: sub.results, visited: sub.visited, dirty: sub.dirty, parents: sub.parents, parent: -1 });
  }, [state, decoder]);
  const subscribe = useCallback((cb: () => void) => {
    const sub = getBaseSub(state, decoder); sub.listeners.add(cb); return () => sub.listeners.delete(cb);
  }, [state, decoder]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ───────────────────────────── React end-to-end ─────────────────────────────
maybeTest("bench: React re-render count + wall time (ver vs base)", () => {
  console.log("\n=== React end-to-end: render-count parity + per-update wall time ===\n");

  function run(label: string, hook: "ver" | "base") {
    const { client, decoder, apply } = simulate(() => new State());
    apply((s) => { for (let i = 0; i < 100; i++) { const p = new Player(); p.name = "p" + i; s.players.set("p" + i, p); } });

    let renders = 0;
    const h = renderHook(() => {
      renders++;
      return hook === "ver"
        ? useColyseusState(client, decoder, (s: State) => s.players)
        : useBaseColyseusState(client, decoder, (s: State) => s.players);
    });

    act(() => { apply((s) => s.players.get("p0")!.x++); }); // warm
    const start = renders;
    const N = 400;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) act(() => { apply((s) => s.players.get("p" + (i % 100))!.x++); });
    const t1 = performance.now();
    h.unmount();
    console.log(`${label.padEnd(22)} ${N} decodes → ${String(renders - start).padStart(4)} renders · ${(t1 - t0).toFixed(1).padStart(7)}ms total · ${(((t1 - t0) / N) * 1000).toFixed(1).padStart(7)}µs/update`);
  }

  run("shipped (on-rebuild)", "ver");
  run("pre-fix (per-decode)", "base");
  console.log("\n(identical render counts ⇒ the change does not alter re-render frequency)\n");
}, 120_000);
