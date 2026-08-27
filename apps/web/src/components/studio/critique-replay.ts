/**
 * Timing for the critique lane's Replay control: paces a finished
 * transcript's events onto a callback at a chosen speed.
 *
 * Shaped like `throttle.ts`'s `createKeyedThrottle` on purpose — a plain
 * factory over injectable timers, no React — so the cadence is unit-testable
 * with `vi.useFakeTimers()` alone. `use-critique-replay.ts` is the thin React
 * wrapper that feeds this into state.
 */

import type { DesignCriticEvent } from '@ligma/api';

export type ReplaySpeedMultiplier = 1 | 2 | 4;

/** Delay between dispatched events at 1x. Halves at 2x, quarters at 4x. */
export const REPLAY_BASE_STEP_MS = 600;

export function stepDelayMs(speed: ReplaySpeedMultiplier): number {
  return REPLAY_BASE_STEP_MS / speed;
}

export interface CritiqueReplayer {
  /** Takes effect on the next scheduled step — never rewinds one in flight. */
  setSpeed(speed: ReplaySpeedMultiplier): void;
  /** Cancels the pending step, if any. Idempotent. */
  stop(): void;
}

export interface CreateCritiqueReplayerOptions {
  onEvent: (event: DesignCriticEvent, index: number) => void;
  onDone: () => void;
  /** Test seam; defaults to the platform timer. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Replays `events` in order: the first fires synchronously (so "playing" is
 * visibly distinct from "loading" the moment playback starts), each
 * following one after `stepDelayMs(speed)`. Transcripts don't carry
 * per-event timestamps — there is no "recorded cadence" to honour — so a
 * fixed step is the whole model.
 *
 * ponytail: no pause/resume-from-cursor — not asked for (OD-057 wants a
 * speed control, not scrubbing). Add a cursor-preserving pause if a rewind
 * control ever lands.
 */
export function createCritiqueReplayer(
  events: DesignCriticEvent[],
  initialSpeed: ReplaySpeedMultiplier,
  options: CreateCritiqueReplayerOptions,
): CritiqueReplayer {
  const setT = options.setTimeoutFn ?? setTimeout;
  const clearT = options.clearTimeoutFn ?? clearTimeout;
  let speed = initialSpeed;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const step = (): void => {
    if (stopped) return;
    options.onEvent(events[cursor]!, cursor);
    cursor += 1;
    if (cursor < events.length) {
      timer = setT(step, stepDelayMs(speed));
    } else {
      options.onDone();
    }
  };

  if (events.length === 0) {
    options.onDone();
  } else {
    step();
  }

  return {
    setSpeed(next) {
      speed = next;
    },
    stop() {
      stopped = true;
      if (timer !== null) clearT(timer);
      timer = null;
    },
  };
}
