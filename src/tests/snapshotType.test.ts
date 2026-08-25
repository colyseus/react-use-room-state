/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { test, expect } from "vitest";
import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import type { Snapshot } from "../schema/createSnapshot";

/**
 * These assertions are checked at compile time — a wrong `Snapshot<T>` makes
 * this file fail to type-check. (Run `npx tsc --noEmit src/tests/snapshotType.test.ts`.)
 * The runtime `test` below is a no-op so vitest still includes the file.
 */

class Weapon extends Schema {
    @type("string") name = "";
    @type("number") damage = 0;
}
class PlayerState extends Schema {
    @type([Weapon]) loadout = new ArraySchema<Weapon>();
    @type({ map: Weapon }) weapons = new MapSchema<Weapon>();
}

// Plain interfaces — frontends can type props without importing @colyseus/schema.
interface IWeapon { name: string; damage: number; }
interface IPlayer {
    loadout: ReadonlyArray<IWeapon>;
    weapons: ReadonlyMap<string, IWeapon>;
}

// Structural equivalence via bidirectional assignability (robust for the
// non-homomorphic, key-remapped mapped type that strips `~refId`).
type Ext<A, B> = A extends B ? true : false;
function expectMutual<A, B>(_: Ext<A, B> extends true ? (Ext<B, A> extends true ? true : never) : never) {}

type W = { readonly name: string; readonly damage: number };

// Concrete Colyseus schema paths — element type preserved, `~refId` stripped.
expectMutual<Snapshot<Weapon>, W>(true);
expectMutual<Snapshot<ArraySchema<Weapon>>, ReadonlyArray<W>>(true);
expectMutual<Snapshot<MapSchema<Weapon>>, { readonly [k: string]: W }>(true);
expectMutual<Snapshot<PlayerState>["loadout"], ReadonlyArray<W>>(true);
expectMutual<Snapshot<PlayerState>["weapons"], { readonly [k: string]: W }>(true);

// Plain interface paths (the PR #9 feature).
expectMutual<Snapshot<IPlayer>["loadout"], ReadonlyArray<W>>(true);
expectMutual<Snapshot<IPlayer>["weapons"], { readonly [k: string]: W }>(true);

// Primitives pass through.
expectMutual<Snapshot<number>, number>(true);
expectMutual<Snapshot<string>, string>(true);
expectMutual<Snapshot<boolean>, boolean>(true);

// Regression guard: ArraySchema element must NOT collapse to `unknown`.
type IsUnknown<T> = unknown extends T ? ([T] extends [{}] ? false : true) : false;
const elementNotUnknown: IsUnknown<Snapshot<ArraySchema<Weapon>>[number]> = false;
void elementNotUnknown;

test("Snapshot<T> type assertions compile", () => {
    expect(true).toBe(true);
});
