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
 *
 * The W2 agent-loop fs tools (`fs_read`, `fs_write`) also ride this contract
 * — their write path rejects on `ok === false` and their read path carries
 * the `content` / `numLines` back to the agent. The extra fields are
 * optional so the minimal main↔renderer wire stays backward-compatible
 * with renderers that only know the `{ schemaVersion, seq }` core.
 */

export const FS_UPDATED_ACK_SCHEMA_VERSION = 1 as const;

export interface FsUpdatedV1 {
  schemaVersion: 1;
  /** Monotonic sequence id per main-process generation run. */
  seq: number;
  /** Path that was written. Present when the event carries the write so the
   *  renderer can route the update to the right preview; omitted by the
   *  minimal main→renderer ping path. */
  path?: string;
  /** Full file content after the write. Same rationale as `path`. */
  content?: string;
}

export interface FsUpdatedAckV1 {
  schemaVersion: 1;
  /** Must match the `seq` of the FsUpdatedV1 being acknowledged. */
  seq: number;
  /** W2 fs_write ACK carries success/failure so the agent tool can decide
   *  whether to surface an error. Omitted on the simple renderer→main ping. */
  ok?: boolean;
  /** Populated when `ok === false`. */
  error?: string;
}

/**
 * ACK for `fs_read` (viewing a file from the main-side virtual fs). Rides
 * the same `seq` discipline as writes. Separate interface because the
 * payload a reader needs differs from what a writer ACK carries.
 */
export interface FsViewAckV1 {
  schemaVersion: 1;
  seq: number;
  ok: boolean;
  /** File body when `ok === true`. */
  content?: string;
  /** Line count of `content`. */
  numLines?: number;
  /** Populated when `ok === false`. */
  error?: string;
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
