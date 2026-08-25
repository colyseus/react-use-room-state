// Declares the package's own client boundary: without it, a Next.js App Router
// Server Component importing any hook here fails the build outright. The
// bundler hoists this to the top of dist/index.mjs and dist/index.cjs.
"use client";

export { useRoomState } from './schema/useRoomState';
export { useRoom } from './room/useRoom';
export { useRoomMessage } from './room/useRoomMessage';
export { createRoomContext, type CreateRoomContextOptions } from './context/createRoomContext';
export { createLobbyContext } from './context/createLobbyContext';
export { useLobbyRoom } from './room/useLobbyRoom';
export { useQueueRoom } from './room/useQueueRoom';
export type { UseRoomResult } from './room/useRoom';
export type { UseLobbyRoomResult } from './room/useLobbyRoom';
export type { UseQueueRoomResult } from './room/useQueueRoom';
export type { IArray, IMap, Snapshot } from './schema/createSnapshot';
export { getSchemaInstance } from './schema/createSnapshot';

// Predict hooks (@colyseus/sdk 0.18+ netcode)
export { usePredict } from './predict/usePredict';
export { useInput } from './predict/useInput';
export { useEntityInstance } from './predict/useEntityInstance';
export { useSessionEntity } from './predict/useSessionEntity';
export { useAttachAll } from './predict/useAttachAll';
export { useReconciler, type UseReconcilerOptions } from './predict/useReconciler';
export { usePredictLoop, type PredictLoopOptions } from './predict/usePredictLoop';
export { useEventChannel, type UseEventChannelOptions } from './predict/useEventChannel';
export { useInputBuffer, type InputBuffer } from './predict/useInputBuffer';
