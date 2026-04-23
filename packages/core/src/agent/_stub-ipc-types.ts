/**
 * Temporary stub for the IPC-ACK contract that W1 is adding at
 * `packages/shared/src/ipc-ack.ts`. When W1 lands, the imports in
 * `./tools/fs-read.ts` and `./tools/fs-write.ts` should be flipped to
 * `@ligma/shared` (or whatever W3 has renamed the package to by
 * then) and this file deleted.
 *
 * Only the shapes the W2 agent-loop tools actually consume live here —
 * keeping the surface small makes the post-merge swap mechanical.
 */

export const FS_UPDATED_SCHEMA_VERSION = 1 as const;

export interface FsUpdatedV1 {
  schemaVersion: typeof FS_UPDATED_SCHEMA_VERSION;
  seq: number;
  path: string;
  content: string;
}

export interface FsUpdatedAckV1 {
  schemaVersion: typeof FS_UPDATED_SCHEMA_VERSION;
  seq: number;
  ok: boolean;
  error?: string;
}

export const FS_VIEWED_SCHEMA_VERSION = 1 as const;

export interface FsViewRequestV1 {
  schemaVersion: typeof FS_VIEWED_SCHEMA_VERSION;
  seq: number;
  path: string;
  /** 1-indexed inclusive `[start, end]`. `end = -1` means EOF. */
  viewRange?: [number, number];
}

export interface FsViewAckV1 {
  schemaVersion: typeof FS_VIEWED_SCHEMA_VERSION;
  seq: number;
  ok: boolean;
  content?: string;
  numLines?: number;
  error?: string;
}
