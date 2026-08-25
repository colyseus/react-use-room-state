import type { InferState, InferInput, ExtractRoomClientMessages, NormalizeRoomType } from "@colyseus/shared-types";
import { useSyncExternalStore, useEffect, type ReactNode, type DependencyList } from "react";
import type { Room, Predict, PredictGetOptions, InputHandle, InputOptions, Reconciler, AttachConfig } from "@colyseus/sdk";
// not re-exported from the sdk root — only from the /predict subpath
import type { PredictedEventChannel } from "@colyseus/sdk/predict";
import { useRoom as useRoomLifecycle, type UseRoomResult } from "../room/useRoom";
import { useRoomState as useRoomStateOriginal } from "../schema/useRoomState";
import { useRoomMessage as useRoomMessageStandalone } from "../room/useRoomMessage";
import type { Snapshot } from "../schema/createSnapshot";
import { usePredict as usePredictStandalone } from "../predict/usePredict";
import { useInput as useInputStandalone } from "../predict/useInput";
import { useEntityInstance as useEntityInstanceStandalone } from "../predict/useEntityInstance";
import { useSessionEntity as useSessionEntityStandalone } from "../predict/useSessionEntity";
import { useAttachAll as useAttachAllStandalone } from "../predict/useAttachAll";
import { useReconciler as useReconcilerStandalone, type UseReconcilerOptions } from "../predict/useReconciler";
import { usePredictLoop as usePredictLoopStandalone, type PredictLoopOptions } from "../predict/usePredictLoop";
import { useEventChannel as useEventChannelStandalone, type UseEventChannelOptions } from "../predict/useEventChannel";

interface RoomProviderProps<T, State> {
  connect: (() => Promise<Room<T, State>>) | null | undefined | false;
  deps?: DependencyList;
  children: ReactNode;
}

/** Options for {@link createRoomContext}. */
export interface CreateRoomContextOptions {
  /**
   * Options for the room's shared `Predict` instance (`@colyseus/sdk` 0.18+),
   * applied when the instance is first created — e.g.
   * `{ mode: "lerp", delay: 100 }`. Centralizing them here keeps every
   * predict-aware hook of this context on the same instance configuration.
   */
  predict?: PredictGetOptions;
}

/**
 * Creates a set of hooks and a Provider for sharing a Colyseus room
 * across React reconciler boundaries (e.g. DOM + React Three Fiber).
 *
 * Uses a closure-scoped external store (not React Context), so hooks
 * work in any reconciler tree that imports them.
 *
 * @template T - A Room definition type or a Schema state type.
 *   When a Schema type is passed, it is used directly as the state.
 *   When a Room definition type is passed, the state is inferred via `InferState`.
 *
 * @example
 * ```tsx
 * const { RoomProvider, useRoom, useRoomState } = createRoomContext<MyState>();
 *
 * // Wrap your app
 * <RoomProvider connect={() => client.joinOrCreate("my_room")}>
 *   <App />
 * </RoomProvider>
 *
 * // In any component (DOM or R3F):
 * const { room } = useRoom();
 * const players = useRoomState((s) => s.players);
 * room.send("action", data);
 * ```
 */
export function createRoomContext<T = any, State = InferState<T, never>>(
  contextOptions: CreateRoomContextOptions = {},
) {
  // Closure-scoped external store — bridges reconciler boundaries.
  const initialSnapshot: UseRoomResult<T, State> = {
    room: undefined,
    error: undefined,
    isConnecting: true,
  };
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot(): UseRoomResult<T, State> {
    return snapshot;
  }

  function getServerSnapshot(): UseRoomResult<T, State> {
    return initialSnapshot;
  }

  function setSnapshot(next: UseRoomResult<T, State>) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /**
   * Manages the room lifecycle. Render once near the root of your app.
   * State is shared via the closure-scoped external store, not React Context.
   */
  function RoomProvider({ connect, deps = [], children }: RoomProviderProps<T, State>) {
    const { room, error, isConnecting } = useRoomLifecycle<T, State>(connect || null, deps);

    useEffect(() => {
      setSnapshot({ room, error, isConnecting });
    }, [room, error, isConnecting]);

    return children;
  }

  /**
   * Returns the room, error, and connection status.
   * Works in DOM tree, R3F tree, or any other reconciler tree.
   */
  function useRoom(): UseRoomResult<T, State> {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }

  /**
   * Returns an immutable snapshot of room state (or a selected slice).
   * No need to pass the room — it's resolved from the store automatically.
   */
  function useRoomState<U = State>(
    selector?: (state: State) => U
  ): Snapshot<U> | undefined {
    const { room } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return useRoomStateOriginal(room, selector);
  }

  /**
   * Subscribes to room messages without needing to pass the room.
   * The room is resolved from the store automatically.
   */
  function useRoomMessage<MessageType extends keyof ExtractRoomClientMessages<NormalizeRoomType<T>>>(
    type: MessageType,
    callback: (payload: ExtractRoomClientMessages<NormalizeRoomType<T>>[MessageType]) => void
  ): void;
  function useRoomMessage(
    type: "*",
    callback: (messageType: string | number, payload: any) => void
  ): void;
  function useRoomMessage<Payload = any>(
    type: [keyof ExtractRoomClientMessages<NormalizeRoomType<T>>] extends [never] ? (string | number) : never,
    callback: (payload: Payload) => void
  ): void;
  function useRoomMessage(
    type: string | number | "*",
    callback: (...args: any[]) => void
  ): void {
    const { room } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    useRoomMessageStandalone(room as any, type as any, callback);
  }

  /** The room resolved from the store (undefined while connecting). */
  function useStoreRoom(): Room<T, State> | undefined {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).room;
  }

  /**
   * Returns the room's shared `Predict` instance, created with this
   * context's `predict` options. See the standalone `usePredict` for details.
   */
  function usePredict(): Predict<State> | undefined {
    return usePredictStandalone<T, State>(useStoreRoom(), contextOptions.predict);
  }

  /**
   * Returns the room's `InputHandle` (stage on `input.data`, then `send()`
   * once per fixed step). See the standalone `useInput` for details.
   */
  function useInput<I = [InferInput<T>] extends [never] ? any : InferInput<T>>(
    options?: InputOptions<I>
  ): InputHandle<I> | undefined {
    return useInputStandalone<T, State, I>(useStoreRoom(), options);
  }

  /**
   * Selects a decoded schema instance from room state, re-rendering only when
   * the selected identity changes. See the standalone `useEntityInstance`.
   */
  function useEntityInstance<S = unknown>(
    select: (state: State, room: Room<T, State>) => S | undefined
  ): S | undefined {
    return useEntityInstanceStandalone<T, State, S>(useStoreRoom(), select);
  }

  /**
   * Returns your own decoded entity (`state[collectionKey].get(sessionId)`).
   * See the standalone `useSessionEntity` for details.
   */
  function useSessionEntity(collectionKey: Parameters<typeof useSessionEntityStandalone<T, State>>[1]) {
    return useSessionEntityStandalone<T, State>(useStoreRoom(), collectionKey);
  }

  /**
   * Attaches passive smoothing to a root-state collection, detaching on
   * unmount. See the standalone `useAttachAll` for details.
   */
  function useAttachAll(
    key: keyof State & string,
    config: AttachConfig<any>,
    deps?: DependencyList
  ): void {
    useAttachAllStandalone<T, State>(useStoreRoom(), key, config, deps, contextOptions.predict);
  }

  /**
   * Runs active prediction for the entity you control, handling late spawn,
   * instance replacement and disposal. See the standalone `useReconciler`.
   */
  function useReconciler<S extends object = any, I = any>(
    select: (state: State, room: Room<T, State>) => S | undefined,
    options: UseReconcilerOptions<S, I>
  ): Reconciler<S, I> | undefined {
    return useReconcilerStandalone<T, State, S, I>(useStoreRoom(), select, options, contextOptions.predict);
  }

  /**
   * Owns the per-frame prediction driver (`predict.tick` + your send loop).
   * See the standalone `usePredictLoop` for details.
   */
  function usePredictLoop(
    onSteps: (steps: number, now: number) => void,
    options?: PredictLoopOptions
  ): (now?: number) => void {
    return usePredictLoopStandalone<T, State>(useStoreRoom(), onSteps, options, contextOptions.predict);
  }

  /**
   * Owns an optimistic event channel with reactive settlement.
   * See the standalone `useEventChannel` for details.
   */
  function useEventChannel<EventT = any>(
    options: UseEventChannelOptions<EventT, State>
  ): PredictedEventChannel<EventT> | undefined {
    return useEventChannelStandalone<EventT, T, State>(useStoreRoom(), options, contextOptions.predict);
  }

  return {
    RoomProvider,
    useRoom,
    useRoomState,
    useRoomMessage,
    usePredict,
    useInput,
    useEntityInstance,
    useSessionEntity,
    useAttachAll,
    useReconciler,
    usePredictLoop,
    useEventChannel,
  };
}
