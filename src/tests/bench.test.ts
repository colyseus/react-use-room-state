/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { test } from 'vitest';
import { Schema, ArraySchema, MapSchema, Encoder, Decoder, type } from "@colyseus/schema";

// Benchmark is opt-in. Run with: BENCH=1 npx vitest run src/tests/bench.test.ts
const runBench = process.env.BENCH === "1";
const maybeTest = runBench ? test : test.skip;
Encoder.BUFFER_SIZE = 8 * 1024 * 1024;
import { createSnapshot, SnapshotContext } from "../schema/createSnapshot";
import { getOrCreateSubscription } from "../schema/getOrCreateSubscription";

class Cell extends Schema {
    @type("number") value = 0;
    @type("boolean") revealed = false;
}

class Player extends Schema {
    @type("string") name = "";
    @type("number") x = 0;
    @type("number") y = 0;
    @type("number") hp = 100;
    @type("number") mp = 50;
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
        decoder.decode(encoder.encode());
        encoder.discardChanges(); // encode lifecycle contract — see simulateState.ts
    };
    apply(() => {});
    return { server, client, decoder, apply };
}

function takeSnapshot<T extends Schema>(state: T, decoder: Decoder, sub: ReturnType<typeof getOrCreateSubscription>) {
    sub.visitedThisPass.clear();
    const ctx: SnapshotContext = {
        refs: decoder.root?.refs,
        resultsByRefId: sub.resultsByRefId,
        visitedThisPass: sub.visitedThisPass,
        dirtyRefIds: sub.dirtyRefIds,
        parentRefIdMap: sub.parentRefIdMap,
        currentParentRefId: -1,
    };
    return createSnapshot(state, ctx);
}

import v8 from "node:v8";

function bench(name: string, fn: () => void, iters: number) {
    for (let i = 0; i < Math.min(50, iters); i++) fn();
    // Best-of-N with forced GC between runs.
    let bestTime = Infinity;
    let bestAlloc = Infinity;
    for (let round = 0; round < 5; round++) {
        if (global.gc) global.gc();
        const before = v8.getHeapStatistics().malloced_memory;
        const t0 = performance.now();
        for (let i = 0; i < iters; i++) fn();
        const t1 = performance.now();
        const after = v8.getHeapStatistics().malloced_memory;
        const perOp = ((t1 - t0) / iters) * 1000;
        const allocPerOp = (after - before) / iters;
        if (perOp < bestTime) bestTime = perOp;
        if (allocPerOp > 0 && allocPerOp < bestAlloc) bestAlloc = allocPerOp;
    }
    const allocStr = bestAlloc === Infinity ? "~" : (bestAlloc / 1024).toFixed(2);
    console.log(`${name.padEnd(50)} ${bestTime.toFixed(2).padStart(8)} µs/op  min  ${allocStr.padStart(8)} KB/op malloced`);
}

function scenario1_largeMapWithTrivialChange() {
    const { server, client, decoder, apply } = simulate(() => new State());
    apply((s) => {
        for (let i = 0; i < 200; i++) {
            const p = new Player();
            p.name = "p" + i;
            p.x = i;
            p.y = i;
            for (let j = 0; j < 10; j++) {
                const c = new Cell();
                c.value = j;
                p.inventory.push(c);
            }
            s.players.set("p" + i, p);
        }
    });
    const sub = getOrCreateSubscription(client, decoder);
    // First snapshot to populate caches.
    takeSnapshot(client, decoder, sub);

    bench("200p x 10i, snapshot-only (tick changed)", () => {
        takeSnapshot(client, decoder, sub);
    }, 2000);
    bench("200p x 10i, decode+snapshot (tick changed)", () => {
        apply((s) => { s.tick++; });
        takeSnapshot(client, decoder, sub);
    }, 200);
}

function scenario2_largeArrayTinyChange() {
    const { server, client, decoder, apply } = simulate(() => new State());
    apply((s) => {
        for (let i = 0; i < 2000; i++) {
            const c = new Cell();
            c.value = i;
            s.cells.push(c);
        }
    });
    const sub = getOrCreateSubscription(client, decoder);
    takeSnapshot(client, decoder, sub);

    bench("2000 cells, snapshot-only (cells[0] changed)", () => {
        takeSnapshot(client, decoder, sub);
    }, 2000);
    bench("2000 cells, decode+snapshot (cells[0]++)", () => {
        apply((s) => { s.cells.at(0)!.value++; });
        takeSnapshot(client, decoder, sub);
    }, 200);
}

function scenario3_manyPlayerMoves() {
    const { server, client, decoder, apply } = simulate(() => new State());
    apply((s) => {
        for (let i = 0; i < 50; i++) {
            const p = new Player();
            p.name = "p" + i;
            s.players.set("p" + i, p);
        }
    });
    const sub = getOrCreateSubscription(client, decoder);
    takeSnapshot(client, decoder, sub);

    bench("50p, snapshot-only", () => {
        takeSnapshot(client, decoder, sub);
    }, 5000);
    bench("50p, decode+snapshot (10 move)", () => {
        apply((s) => {
            for (let i = 0; i < 10; i++) {
                const p = s.players.get("p" + i)!;
                p.x++;
                p.y++;
            }
        });
        takeSnapshot(client, decoder, sub);
    }, 300);
}

function scenario_decodeOverhead() {
    // Compare decode cost with and without our wrapper.
    {
        const { client, decoder, apply } = simulate(() => new State());
        apply((s) => {
            for (let i = 0; i < 200; i++) {
                const p = new Player();
                p.name = "p" + i;
                s.players.set("p" + i, p);
            }
        });
        void client;
        bench("decode only (no wrapper), tick++", () => {
            apply((s) => { s.tick++; });
        }, 300);
    }
    {
        const { client, decoder, apply } = simulate(() => new State());
        apply((s) => {
            for (let i = 0; i < 200; i++) {
                const p = new Player();
                p.name = "p" + i;
                s.players.set("p" + i, p);
            }
        });
        getOrCreateSubscription(client, decoder); // install wrapper
        bench("decode WITH wrapper, tick++", () => {
            apply((s) => { s.tick++; });
        }, 300);
    }
}

function scenario_snapshotAfterDirty() {
    // Measure only the snapshot cost after marking many refs dirty.
    const { client, decoder, apply } = simulate(() => new State());
    apply((s) => {
        for (let i = 0; i < 200; i++) {
            const p = new Player();
            p.name = "p" + i;
            s.players.set("p" + i, p);
        }
    });
    const sub = getOrCreateSubscription(client, decoder);
    takeSnapshot(client, decoder, sub);

    // Each measured op: decode a patch that dirties 50 players, then snapshot.
    bench("200p, 50 players change each patch (isolated)", () => {
        apply((s) => {
            for (let i = 0; i < 50; i++) s.players.get("p" + i)!.x++;
        });
        takeSnapshot(client, decoder, sub);
    }, 200);
}

function scenario4_noChangesFastPath() {
    const { client, decoder } = simulate(() => new State());
    const sub = getOrCreateSubscription(client, decoder);
    takeSnapshot(client, decoder, sub);

    bench("empty state, re-snapshot with no changes", () => {
        takeSnapshot(client, decoder, sub);
    }, 5000);
}

maybeTest("bench", () => {
    console.log("Scenario".padEnd(50) + "   time/op    alloc/op");
    console.log("-".repeat(80));
    scenario1_largeMapWithTrivialChange();
    scenario2_largeArrayTinyChange();
    scenario3_manyPlayerMoves();
    scenario_decodeOverhead();
    scenario_snapshotAfterDirty();
    scenario4_noChangesFastPath();
}, 120_000);
