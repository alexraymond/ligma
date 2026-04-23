/**
 * FS-update ACK coordinator for main-process agent runs.
 *
 * Main emits `fs_updated` events to the renderer and awaits a matching
 * `fs_updated_ack` IPC call keyed by monotonic `seq`. On timeout, the
 * CoreLogger warns — there is NO silent fallback. The intent is to surface
 * renderer-side drops so we can diagnose dropped preview updates.
 *
 * Scope: one tracker per agent run. `abort()` rejects every pending waiter
 * (used on aborted generation).
 */

import type { CoreLogger } from '@ligma/core';

export interface FsAckTrackerOptions {
  /** Log scope for warn/info emissions. */
  logger: CoreLogger;
  /** Wait budget per pending ACK. */
  timeoutMs: number;
  /** Correlation id included in every log line. */
  generationId: string;
}

export interface FsAckTracker {
  /** Allocate + return the next seq number. Caller emits the `fs_updated`
   *  event with this seq, then awaits the returned promise. */
  nextSeq(): number;
  /**
   * Returns a promise that resolves when the renderer acks `seq` within
   * `timeoutMs`, or resolves after logging `claude-cli.fs_ack.timeout`.
   * Never rejects for timeout — the caller treats timeouts as telemetry,
   * not as a failure path (per W1 acceptance: "NO silent fallback — user
   * will wake up and find logged timeouts").
   */
  wait(seq: number): Promise<void>;
  /**
   * Signal that `seq` has been acknowledged by the renderer. Idempotent:
   * duplicate acks are ignored.
   */
  ack(seq: number): void;
  /** Abort all pending waiters (on run cancellation). */
  abort(): void;
}

/** Constructor for the tracker. Pure factory — no ipcMain coupling so the
 *  unit test can exercise the coordination without Electron. */
export function createFsAckTracker(opts: FsAckTrackerOptions): FsAckTracker {
  let nextId = 0;
  const pending = new Map<number, { resolve: () => void; timer: NodeJS.Timeout }>();

  return {
    nextSeq(): number {
      const id = nextId;
      nextId += 1;
      return id;
    },
    wait(seq: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.has(seq)) return;
          pending.delete(seq);
          opts.logger.warn('claude-cli.fs_ack.timeout', {
            generationId: opts.generationId,
            seq,
            timeoutMs: opts.timeoutMs,
          });
          resolve();
        }, opts.timeoutMs);
        // Unref so the heartbeat timer never blocks process exit in tests.
        if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
          timer.unref();
        }
        pending.set(seq, { resolve, timer });
      });
    },
    ack(seq: number): void {
      const entry = pending.get(seq);
      if (entry === undefined) return;
      pending.delete(seq);
      clearTimeout(entry.timer);
      entry.resolve();
    },
    abort(): void {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve();
      }
      pending.clear();
    },
  };
}
