'use client';

import { useEffect, useRef } from 'react';

export interface SmartPollOptions {
  /** Poll interval in ms while visible and healthy. */
  intervalMs: number;
  /** Set false to stop all polling (mount fire included). Default true. */
  enabled?: boolean;
  /**
   * Identity of the resource being polled (e.g. a run id). Changing it tears
   * down the current scheduler and starts a fresh one with an immediate fire,
   * so switching resources doesn't wait out the old interval.
   */
  key?: string | number | null;
}

const BACKOFF_FACTOR = 1.5;
const MAX_BACKOFF_MULTIPLIER = 3;

/**
 * Pure scheduling core, deliberately DOM-free so it's unit-testable: this
 * repo's vitest config runs in the "node" environment (no jsdom /
 * @testing-library/react installed), so React hooks can't be rendered in
 * tests. `useSmartPoll` below is a thin wrapper that feeds this class
 * `document.hidden` / `visibilitychange`.
 */
export class SmartPollScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoffMultiplier = 1;
  private paused = false;
  private stopped = false;
  /** Bumped on stop() so a tick already in flight can tell it's been superseded. */
  private generation = 0;

  constructor(
    private readonly fn: (isStale: () => boolean) => void | Promise<void>,
    private readonly intervalMs: number,
  ) {}

  private effectiveInterval() {
    return this.intervalMs * this.backoffMultiplier;
  }

  private clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNext() {
    this.clearTimer();
    if (this.stopped || this.paused) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.effectiveInterval());
  }

  private async tick() {
    const gen = this.generation;
    const isStale = () => gen !== this.generation;
    this.clearTimer();
    try {
      await this.fn(isStale);
      if (isStale()) return; // superseded mid-flight — don't touch backoff or reschedule
      this.backoffMultiplier = 1;
    } catch {
      if (isStale()) return;
      this.backoffMultiplier = Math.min(
        this.backoffMultiplier * BACKOFF_FACTOR,
        MAX_BACKOFF_MULTIPLIER,
      );
    }
    this.scheduleNext();
  }

  /** Fires once immediately, then schedules the recurring poll (unless paused). */
  start() {
    this.stopped = false;
    void this.tick();
  }

  pause() {
    this.paused = true;
    this.clearTimer();
  }

  /** Resumes and fires immediately. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    this.generation++; // any in-flight tick's isStale() now reports true
    this.clearTimer();
  }
}

/**
 * Visibility-aware polling: always fires once on mount, pauses while the
 * tab is hidden, and resumes with an immediate fire when it becomes visible
 * again. Consecutive failures back off the interval (x1.5/failure, capped
 * at 3x); a success resets the backoff.
 */
export function useSmartPoll(
  fn: (isStale: () => boolean) => void | Promise<void>,
  options: SmartPollOptions,
) {
  const { intervalMs, enabled = true, key } = options;

  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    const scheduler = new SmartPollScheduler((isStale) => fnRef.current(isStale), intervalMs);

    if (typeof document !== 'undefined' && document.hidden) {
      scheduler.pause();
    }
    scheduler.start();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        scheduler.pause();
      } else {
        scheduler.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      scheduler.stop();
    };
    // `key` intentionally participates: a changed resource identity (e.g. a new
    // runId) tears down the old scheduler — invalidating any in-flight tick via
    // generation — and starts a fresh one with an immediate fire.
  }, [intervalMs, enabled, key]);
}
