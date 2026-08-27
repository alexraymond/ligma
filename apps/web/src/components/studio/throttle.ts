/**
 * Per-key ~250ms coalescing with a guaranteed trailing-edge flush.
 *
 * Ported from ligma-classic's `useAgentStream.ts` (`FS_THROTTLE_MS = 250`,
 * studio map §2 "Progressive throttled rendering"). Same two properties that
 * made the Wall watchable there:
 *
 *  - **Per-key slots.** A multi-file generation writes to 5+ files in parallel
 *    and every card's iframe reloads on `srcDoc` change; one global slot would
 *    make N cards strobe together. Keyed by `designId::path`.
 *  - **Trailing edge always fires.** Schedule immediately when the window has
 *    already elapsed, otherwise arm a timer for the remainder. The final state
 *    is never dropped, which is what stops a design finishing one write short.
 *
 * The daemon deliberately does not coalesce `design.file-progress` (one frame
 * per tool call, per `DesignFileProgressEvent`'s docstring) — the throttle is
 * the consumer's job, exactly as it was in the desktop app.
 */

/** ligma-classic's cadence, unchanged — a human-legible rebuild, not a strobe. */
export const FS_THROTTLE_MS = 250;

interface Slot<T> {
  timer: ReturnType<typeof setTimeout> | null;
  pending: T | null;
  lastFlushAt: number;
}

export interface KeyedThrottle<T> {
  /** Queue `value` under `key`, flushing at most once per window. */
  schedule(key: string, value: T): void;
  /** Drop every timer. Call from an effect cleanup. */
  cancelAll(): void;
}

export function createKeyedThrottle<T>(
  flush: (value: T) => void,
  windowMs: number = FS_THROTTLE_MS,
): KeyedThrottle<T> {
  const slots = new Map<string, Slot<T>>();

  const flushSlot = (key: string): void => {
    const slot = slots.get(key);
    if (!slot) return;
    slot.timer = null;
    const pending = slot.pending;
    slot.pending = null;
    if (pending === null) return;
    slot.lastFlushAt = Date.now();
    flush(pending);
  };

  return {
    schedule(key, value) {
      let slot = slots.get(key);
      if (!slot) {
        slot = { timer: null, pending: null, lastFlushAt: 0 };
        slots.set(key, slot);
      }
      slot.pending = value;
      const since = Date.now() - slot.lastFlushAt;
      if (since >= windowMs && slot.timer === null) {
        // Cold path: flush now; anything landing inside the window coalesces.
        flushSlot(key);
        return;
      }
      if (slot.timer !== null) return;
      slot.timer = setTimeout(() => flushSlot(key), Math.max(windowMs - since, 0));
    },
    cancelAll() {
      for (const slot of slots.values()) {
        if (slot.timer !== null) clearTimeout(slot.timer);
        slot.timer = null;
      }
      slots.clear();
    },
  };
}
