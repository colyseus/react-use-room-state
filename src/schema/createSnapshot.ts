/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, ArraySchema, MapSchema } from "@colyseus/schema";
/** Property key used by @colyseus/schema to tag decoded instances with their refId. */
const REF_ID_KEY = "~refId";

/** Cache of field-name arrays, keyed by Schema constructor. */
const fieldNamesByCtor = new WeakMap<Function, string[]>();

/**
 * Returns the `@type`-decorated field names for a Schema class,
 * reading from `Symbol.metadata` set by v4's `@type()` decorators.
 * Memoized per constructor.
 */
function getSchemaFieldNames(node: object): string[] | undefined {
    const ctor = node.constructor as Function | undefined;
    if (!ctor) return undefined;
    const cached = fieldNamesByCtor.get(ctor);
    if (cached) return cached;
    const metadata = (ctor as any)?.[Symbol.metadata];
    if (metadata && typeof metadata === "object") {
        const names = Object.values(metadata as Record<string, { name: string }>).map(f => f.name);
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
 * Like ReadonlyArray<T>, but remove concat, so that ArraySchema
 * implements it.
 */
export type IArray<T> = Omit<ReadonlyArray<T>, 'concat'>;

/**
 * Like ReadonlyMap<K, V>, but uses IterableIterator instead of MapIterator,
 * so that MapSchema implements it.
 */
export type IMap<K, V> = Omit<ReadonlyMap<K, V>, typeof Symbol.iterator> & {
    [Symbol.iterator](): IterableIterator<[K, V]>;
};

/**
 * A helper to detect primitives
 */
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Anything that can be a Map key. (MapSchema keys are always strings.)
 */
type MapKey = string | number | symbol;

/**
 * Transforms a Colyseus Schema type into an immutable, plain JavaScript type.
 * 
 * - `ArraySchema<T>` (or `Array<T>`) becomes `readonly T[]`
 * - `MapSchema<T>` (or `Map<K, T>`) becomes `Readonly<Record<string, T>>`
 * - `Schema` (or `object`) subclasses become plain objects with only data properties
 * - Primitives remain unchanged
 * 
 * @template T - The Colyseus Schema type to snapshot
 */
export type Snapshot<T> = DeepReadonly<
    T extends IArray<infer U>
    ? Snapshot<U>[]
    : T extends IMap<infer K extends MapKey, infer U>
    ? Partial<Record<K, Snapshot<U>>>
    : T extends Primitive
    ? T
    : T extends object
    ? { [K in keyof OmitFunctions<T>]: Snapshot<OmitFunctions<T>[K]> }
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
    /** Set of refIds that have been modified since the last snapshot */
    dirtyRefIds: Set<number>;
    /** Map of childRefId → parentRefId for ancestor tracking */
    parentRefIdMap: Map<number, number>;
    /** Current parent refId during traversal (used to build parentRefIdMap) */
    currentParentRefId: number;
}

/**
 * Returns the refId stored on a Schema/ArraySchema/MapSchema instance
 * by the decoder, or -1 if absent.
 */
function getRefId(node: object): number {
    const refId = (node as any)[REF_ID_KEY];
    return typeof refId === "number" ? refId : -1;
}

/**
 * Creates a snapshot of a MapSchema into a plain JavaScript object with structural sharing.
 */
function createSnapshotForMapSchema(
    node: MapSchema<any>,
    previousResult: Partial<Record<string, any>> | undefined,
    ctx: SnapshotContext
): Partial<Record<string, any>> {
    const snapshotted: Partial<Record<string, any>> = {};
    let hasChanged = previousResult === undefined;

    for (const [key, value] of node) {
        const snapshottedValue = createSnapshot(value, ctx);
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
    ctx: SnapshotContext
): any[] {
    const length = node.length;
    let hasChanged = !previousResult || !Array.isArray(previousResult) || length !== previousResult.length;

    const snapshotted: any[] = new Array(length);

    for (let i = 0; i < length; i++) {
        const snapshottedValue = createSnapshot(node.at(i), ctx);
        snapshotted[i] = snapshottedValue;

        if (!hasChanged && previousResult && previousResult[i] !== snapshottedValue) {
            hasChanged = true;
        }
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
        throw new Error(`createSnapshotForSchema: no field metadata found on ${node.constructor?.name ?? 'unknown'}. Is @colyseus/schema v4 installed?`);
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
 * @returns The snapshotted plain JavaScript value
 */
export function createSnapshot<T>(node: T, ctx: SnapshotContext): Snapshot<T> {
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

    // Previous-pass result for structural sharing comparison.
    const previousResult = refId !== -1 ? ctx.resultsByRefId.get(refId) : undefined;

    // If this node is not dirty and we have a previous result,
    // we can skip the entire subtree. With ancestor tracking, if any descendant
    // changed, this node would have been marked dirty too.
    if (refId !== -1 && previousResult !== undefined && !ctx.dirtyRefIds.has(refId)) {
        ctx.visitedThisPass.add(refId);
        return previousResult as Snapshot<T>;
    }

    // Set this node as the parent for any children we process.
    const savedParentRefId = ctx.currentParentRefId;
    ctx.currentParentRefId = refId;

    let result: any;

    if (typeof (node as any)['set'] === 'function') { // instanceof MapSchema
        result = createSnapshotForMapSchema(node as unknown as MapSchema<any>, previousResult, ctx);

    } else if (typeof (node as any)['push'] === 'function') { // instanceof ArraySchema
        result = createSnapshotForArraySchema(node as unknown as ArraySchema<any>, previousResult, ctx);

    } else if (Schema.isSchema(node)) {
        result = createSnapshotForSchema(node, previousResult, ctx);

    } else {
        // Plain object or unknown type - pass through.
        result = node;
    }

    // Restore parent and cache result.
    ctx.currentParentRefId = savedParentRefId;
    if (refId !== -1) {
        ctx.resultsByRefId.set(refId, result);
        ctx.visitedThisPass.add(refId);
    }

    return result as Snapshot<T>;
}
