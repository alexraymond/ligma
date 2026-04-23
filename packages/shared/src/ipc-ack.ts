/**
 * Versioned IPC acknowledgement contract for `fs_updated` events.
 *
 * The main process emits `fs_updated` notifications whenever the agent's
 * virtual FS mutates. Renderer acknowledges each event with the matching
 * `seq` so main can detect drop/lag (main awaits the ACK with a bounded
 * timeout — no silent fallback; a timeout is logged via CoreLogger).
 *
 * Schema-versioned so we can evolve the payload without breaking older
 * renderers still hot in memory during an update.
 */

export const FS_UPDATED_ACK_SCHEMA_VERSION = 1 as const;

export interface FsUpdatedV1 {
  schemaVersion: 1;
  /** Monotonic sequence id per main-process generation run. */
  seq: number;
}

export interface FsUpdatedAckV1 {
  schemaVersion: 1;
  /** Must match the `seq` of the FsUpdatedV1 being acknowledged. */
  seq: number;
}

/** Runtime type-guard for a FsUpdatedAckV1 off the IPC wire. */
export function isFsUpdatedAckV1(value: unknown): value is FsUpdatedAckV1 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['schemaVersion'] === 1 &&
    typeof v['seq'] === 'number' &&
    Number.isInteger(v['seq']) &&
    (v['seq'] as number) >= 0
  );
}
