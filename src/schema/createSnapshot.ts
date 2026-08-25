/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, ArraySchema, MapSchema } from "@colyseus/schema";

/** Symbol used by @colyseus/schema v5 to tag decoded instances with their refId. */
const REF_ID_SYMBOL: unique symbol = Symbol.for("$refId") as never;

/** Property key used by @colyseus/schema v4 to tag decoded instances with their refId. */
const REF_ID_KEY = "~refId";

/** Cache of field-name arrays, keyed by Schema constructor. */
const fieldNamesByCtor = new WeakMap<Function, string[]>();

/**
 * Returns the declared field names for a Schema class, reading from
 * `Symbol.metadata` set by `@type()` decorators / the `schema()` builder.
 * Handles both v4 and v5 metadata shapes (v5 mixes `index → field` entries
 * with `fieldName → index` reverse-lookup entries). Memoized per constructor.
 */
function getSchemaFieldNames(node: object): string[] | undefined {
    const ctor = node.constructor as Function | undefined;
    if (!ctor) return undefined;
    const cached = fieldNamesByCtor.get(ctor);
    if (cached) return cached;
    const metadata = (ctor as any)?.[Symbol.metadata];
    if (metadata && typeof metadata === "object") {
        const names: string[] = [];
        for (const entry of Object.values(metadata as Record<string, unknown>)) {
            // keep field descriptors; skip v5's fieldName → index reverse entries
            if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
                names.push((entry as { name: string }).name);
            }
        }
        fieldNamesByCtor.set(ctor, names);
        return names;
    }
    return undefined;
}

/**
 * Remove function properties from a type.
 */
type OmitFunctions<T> = Omit<T, {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T]>;

/**
 * Recursively applies `readonly` to all properties of a type.
 */
type DeepReadonly<T> = T extends (infer R)[]
    ? ReadonlyArray<DeepReadonly<R>>
    : T extends Record<string, any>
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * Structural shape of a readonly array, minus `concat` — whose `ArraySchema`
 * override (`ArraySchema<V>` return) is incompatible with `ReadonlyArray`.
 * Lets `Snapshot` accept a plain `Array`/`ReadonlyArray` interface, not only
 * `ArraySchema`, so frontends can type props against shared interfaces.
 */
export type IArray<T> = Omit<ReadonlyArray<T>, 'concat'>;

/**
 * Structural shape of a readonly map, using `IterableIterator` (as `MapSchema`
 * does) rather than the lib's `MapIterator`. Lets `Snapshot` accept a plain
 * `Map`/`ReadonlyMap` interface, not only `MapSchema`.
 */
export type IMap<K, V> = Omit<ReadonlyMap<K, V>, typeof Symbol.iterator> & {
    [Symbol.iterator](): IterableIterator<[K, V]>;
};

/** Primitive (non-object) types, passed through a snapshot unchanged. */
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** Anything usable as a Map key. (MapSchema keys are always strings.) */
type MapKey = string | number | symbol;

/**
 * Transforms a Colyseus Schema type into an immutable, plain JavaScript type.
 *
 * - `ArraySchema<T>` (or `Array<T>` / `ReadonlyArray<T>`) becomes `readonly T[]`
 * - `MapSchema<T>` (or `Map<K, T>` / `ReadonlyMap<K, T>`) becomes `Readonly<Record<K, T>>`
 * - `Schema` subclasses (and plain objects) become plain objects with only data properties
 * - Primitives remain unchanged
 *
 * Colyseus's concrete `ArraySchema`/`MapSchema` are matched first for precise
 * element inference; `ArraySchema`'s overridden member signatures don't infer
 * cleanly through `IArray`, so the structural branches only catch plain types.
 * The internal `~refId` tag added to decoded instances is dropped — the runtime
 * snapshot only copies `@type`-decorated fields, never `~refId`.
 *
 * @template T - The Colyseus Schema (or equivalent plain) type to snapshot
 */
export type Snapshot<T> = DeepReadonly<
    T extends ArraySchema<infer U>
    ? Snapshot<U>[]
    : T extends MapSchema<infer U>
    ? Record<string, Snapshot<U>>
    : T extends IArray<infer U>
    ? Snapshot<U>[]
    : T extends IMap<infer K extends MapKey, infer U>
    ? Record<K, Snapshot<U>>
    : T extends Primitive
    ? T
    : T extends object
    // strip Schema-base internals: v4's `~refId` tag, v5's symbol-keyed
    // members ($refId, $values) and `isTrackingPaused`
    ? { [K in keyof OmitFunctions<T> as Exclude<K, "~refId" | "isTrackingPaused" | symbol>]: Snapshot<OmitFunctions<T>[K]> }
    : T
>;

/**
 * Context passed through the snapshot recursion.
 */
export interface SnapshotContext {
    /** Map of refId → Schema object from decoder.root.refs */
    refs: Map<number, any> | undefined;
    /** Cache of snapshot results per refId (persistent across passes) */
    resultsByRefId: Map<number, any>;
    /** refIds already visited in the current pass (for cycle detection) */
    visitedThisPass: Set<number>;
    /** refIds dirty since their cached result was last rebuilt; consumed here on rebuild */
    dirtyRefIds: Set<number>;
    /** Map of childRefId → parentRefId for ancestor tracking */
    parentRefIdMap: Map<number, number>;
    /** Current parent refId during traversal (used to build parentRefIdMap) */
    currentParentRefId: number;
}

/**
 * Maps snapshot results back to the decoded schema instance they were built
 * from. Populated by `createSnapshot`; read via `getSchemaInstance`. Snapshot objects
 * persist across renders (structural sharing), so the mapping stays valid for
 * as long as the snapshot is reachable.
 */
const sourceBySnapshot = new WeakMap<object, object>();

/**
 * Returns the decoded schema instance a snapshot was created from, or
 * `undefined` when the value isn't a snapshot produced by this package.
 *
 * The Predict APIs of `@colyseus/sdk` (e.g. `predict.value(instance, field)`)
 * key off decoded schema instances, while `useRoomState` hands components
 * plain snapshots. This bridges the two:
 *
 * ```tsx
 * const player = useRoomState((s) => s.players.get(id));
 * const source = getSchemaInstance(player);       // the decoded Player instance
 * useFrame(() => {
 *   ref.current.position.x = predict.value(source, "x");
 * });
 * ```
 */
export function getSchemaInstance<T = unknown>(snapshot: unknown): T | undefined {
    return (snapshot !== null && typeof snapshot === "object")
        ? sourceBySnapshot.get(snapshot) as T | undefined
        : undefined;
}

/**
 * Returns the refId stored on a Schema/ArraySchema/MapSchema instance
 * by the decoder, or -1 if absent.
 */
export function getRefId(node: object): number {
    const refId = (node as any)[REF_ID_SYMBOL] ?? (node as any)[REF_ID_KEY];
    return typeof refId === "number" ? refId : -1;
}

/**
 * Creates a snapshot of a MapSchema into a plain JavaScript object with structural sharing.
 */
function createSnapshotForMapSchema(
    node: MapSchema<any>,
    previousResult: Record<string, any> | undefined,
    ctx: SnapshotContext,
    isDerived: boolean
): Record<string, any> {
    const snapshotted: Record<string, any> = {};
    let hasChanged = previousResult === undefined;

    for (const [key, value] of node) {
        const snapshottedValue = createSnapshot(value, ctx, isDerived ? previousResult?.[key] : undefined);
        snapshotted[key] = snapshottedValue;

        if (!hasChanged && previousResult && previousResult[key] !== snapshottedValue) {
            hasChanged = true;
        }
    }

    // Detect removed keys by comparing sizes (no array allocations).
    if (!hasChanged && previousResult) {
        let prevCount = 0;
        for (const _key in previousResult) prevCount++;
        if (prevCount !== node.size) hasChanged = true;
    }

    return hasChanged ? snapshotted : previousResult!;
}

/**
 * Creates a snapshot of an ArraySchema into a plain JavaScript array with structural sharing.
 */
function createSnapshotForArraySchema(
    node: ArraySchema<any>,
    previousResult: any[] | undefined,
    ctx: SnapshotContext,
    isDerived: boolean
): any[] {
    const length = node.length;
    let hasChanged = !previousResult || !Array.isArray(previousResult) || length !== previousResult.length;

    const snapshotted: any[] = new Array(length);

    for (let i = 0; i < length; i++) {
        const snapshottedValue = createSnapshot(node.at(i), ctx, isDerived ? previousResult?.[i] : undefined);
        snapshotted[i] = snapshottedValue;

        if (!hasChanged && previousResult && previousResult[i] !== snapshottedValue) {
            hasChanged = true;
        }
    }

    return hasChanged ? snapshotted : previousResult!;
}

/** True for object literals (and null-prototype objects), not class instances. */
function isPlainObject(value: unknown): value is Record<string, any> {
    if (value === null || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Creates a snapshot of a selector-built object literal with structural sharing.
 */
function createSnapshotForPlainObject(
    node: Record<string, any>,
    previousResult: Record<string, any> | undefined,
    ctx: SnapshotContext
): Record<string, any> {
    const snapshotted: Record<string, any> = {};
    let hasChanged = previousResult === undefined;
    let keyCount = 0;

    for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === "function") { continue; } // dropped, as `Snapshot` does

        keyCount++;
        const previousValue = previousResult?.[key];
        const snapshottedValue = createSnapshot(value, ctx, previousValue);
        snapshotted[key] = snapshottedValue;

        if (!hasChanged && previousValue !== snapshottedValue) {
            hasChanged = true;
        }
    }

    // Dropped keys leave every survivor matching, so the count has to be checked too.
    if (!hasChanged && Object.keys(previousResult!).length !== keyCount) {
        hasChanged = true;
    }

    return hasChanged ? snapshotted : previousResult!;
}

/**
 * Creates a snapshot of a Schema object into a plain JavaScript object with structural sharing.
 */
function createSnapshotForSchema(
    node: Schema,
    previousResult: Record<string, any> | undefined,
    ctx: SnapshotContext
): Record<string, any> {
    const snapshotted: Record<string, any> = {};
    let hasChanged = previousResult === undefined;

    // Get Colyseus schema field names via Symbol.metadata.
    const fieldNames = getSchemaFieldNames(node);

    if (!fieldNames) {
        throw new Error(`createSnapshotForSchema: no field metadata found on ${node.constructor?.name ?? 'unknown'}. Is @colyseus/schema v4+ installed?`);
    }

    for (const fieldName of fieldNames) {
        const value = (node as any)[fieldName];
        if (typeof value !== "function") {
            const snapshottedValue = createSnapshot(value, ctx);
            snapshotted[fieldName] = snapshottedValue;

            if (!hasChanged && previousResult && previousResult[fieldName] !== snapshottedValue) {
                hasChanged = true;
            }
        }
    }

    return hasChanged ? snapshotted : previousResult!;
}

/**
 * Recursively creates a snapshot of a Colyseus Schema node into plain JavaScript objects.
 * 
 * This function implements structural sharing: if a node and all its descendants
 * are unchanged from the previous render, the previous snapshot result is reused.
 * This ensures referential equality for unchanged subtrees, allowing React memoization.
 * 
 * @param node - The value to snapshot (may be a Schema, primitive, etc.)
 * @param ctx - The snapshot context with refs and previous results
 * @param previousDerived - Prior result for a node the decoder never tagged (a
 *   container the selector built); refId-keyed nodes ignore it and use the cache
 * @returns The snapshotted plain JavaScript value
 */
export function createSnapshot<T>(node: T, ctx: SnapshotContext, previousDerived?: any): Snapshot<T> {
    // Pass through primitives and null/undefined.
    if (node === null || node === undefined || typeof node !== "object") {
        return node as Snapshot<T>;
    }

    // Read the stable refId directly off the instance (set by the decoder).
    const refId = getRefId(node);

    // Record the parent relationship for ancestor tracking.
    if (refId !== -1 && ctx.currentParentRefId !== -1) {
        ctx.parentRefIdMap.set(refId, ctx.currentParentRefId);
    }

    // Cycle / shared-reference short-circuit: already processed in this pass.
    if (refId !== -1 && ctx.visitedThisPass.has(refId)) {
        return ctx.resultsByRefId.get(refId);
    }

    // Previous-pass result for structural sharing comparison. A selector-built
    // container has no refId to look up, so its previous result is passed down.
    const previousResult = refId !== -1 ? ctx.resultsByRefId.get(refId) : previousDerived;

    // If this ref isn't dirty and we have a previous result, the whole subtree is
    // unchanged (a descendant change would have marked this ref dirty too via the
    // ancestor walk in `getOrCreateSubscription`), so reuse it.
    if (refId !== -1 && previousResult !== undefined && !ctx.dirtyRefIds.has(refId)) {
        ctx.visitedThisPass.add(refId);
        return previousResult as Snapshot<T>;
    }

    // Set this node as the parent for any children we process.
    const savedParentRefId = ctx.currentParentRefId;
    ctx.currentParentRefId = refId;

    let result: any;

    if (typeof (node as any)['set'] === 'function') { // instanceof MapSchema
        result = createSnapshotForMapSchema(node as unknown as MapSchema<any>, previousResult, ctx, refId === -1);

    } else if (typeof (node as any)['push'] === 'function') { // instanceof ArraySchema
        result = createSnapshotForArraySchema(node as unknown as ArraySchema<any>, previousResult, ctx, refId === -1);

    } else if (Schema.isSchema(node)) {
        result = createSnapshotForSchema(node, previousResult, ctx);

    } else if (isPlainObject(node)) {
        // Selector-built object literal: snapshot the values, so a `{ ... }` selector
        // yields the same plain data a `[ ... ]` one does instead of leaking live nodes.
        result = createSnapshotForPlainObject(node, previousResult, ctx);

    } else {
        // Unknown type - pass through.
        result = node;
    }

    // Restore parent, cache the result, and consume the dirty mark: this ref now
    // reflects the latest decode, so clear it rather than bulk-clearing per decode.
    ctx.currentParentRefId = savedParentRefId;
    if (refId !== -1) {
        ctx.resultsByRefId.set(refId, result);
        ctx.dirtyRefIds.delete(refId);
        ctx.visitedThisPass.add(refId);
        if (result !== node) sourceBySnapshot.set(result, node);
    }

    return result as Snapshot<T>;
}
