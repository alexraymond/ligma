import { SmartPollScheduler } from '@/hooks/use-smart-poll';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── SmartPollScheduler ──────────────────────────────────────────────────────
//
// This repo's vitest config runs in the "node" environment (no jsdom /
// @testing-library/react installed), so the `useSmartPoll` React hook can't
// be rendered here. Instead these tests exercise `SmartPollScheduler`, the
// DOM-free scheduling core the hook wraps — it owns all the timing/backoff
// logic; the hook itself only wires `document.hidden` / `visibilitychange`
// to `pause()` / `resume()`.

const INTERVAL = 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SmartPollScheduler', () => {
  it('fires once immediately on start()', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('polls again after intervalMs on success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fn).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('pause() stops the recurring timer; resume() fires immediately', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    scheduler.pause();
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(fn).toHaveBeenCalledTimes(1); // still paused, no extra polls

    scheduler.resume();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2); // immediate fire on resume

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fn).toHaveBeenCalledTimes(3); // recurring polling resumed

    scheduler.stop();
  });

  it('backs off x1.5 per consecutive failure, capped at 3x base interval', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1); // failure #1 -> next interval = 1.5x

    await vi.advanceTimersByTimeAsync(INTERVAL * 1.5);
    expect(fn).toHaveBeenCalledTimes(2); // failure #2 -> next interval = 2.25x

    await vi.advanceTimersByTimeAsync(INTERVAL * 2.25);
    expect(fn).toHaveBeenCalledTimes(3); // failure #3 -> would be 3.375x, capped at 3x

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(4);

    // Interval stays capped at 3x on further consecutive failures.
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(5);

    scheduler.stop();
  });

  it('a success resets the backoff multiplier to 1x', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1); // failure -> next interval = 1.5x

    await vi.advanceTimersByTimeAsync(INTERVAL * 1.5);
    expect(fn).toHaveBeenCalledTimes(2); // success -> backoff resets to 1x

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fn).toHaveBeenCalledTimes(3); // back to base interval, not 1.5x

    scheduler.stop();
  });

  it('stop() cancels the recurring timer for good', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── Resource-identity ("key") behaviour ────────────────────────────────────
//
// use-run-output wires runId in as `key`, per SmartPollOptions. useSmartPoll
// puts `key` in its effect deps, so a changed key tears the scheduler down
// and mounts a fresh one — exercised here as two scheduler instances, exactly
// what the effect's cleanup + re-run produces. The interesting part is what
// happens to a tick that was still in flight when that teardown happened.

describe('SmartPollScheduler — resource identity / generation', () => {
  it('a new instance for a changed key fires immediately, not after the old interval', async () => {
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const s1 = new SmartPollScheduler(fn1, INTERVAL);
    s1.start();
    await Promise.resolve();
    expect(fn1).toHaveBeenCalledTimes(1);
    s1.stop(); // simulates the effect cleanup on key change

    // Only a fraction of INTERVAL has elapsed — a naive "keep polling on the
    // same timer" implementation would still be waiting here.
    const fn2 = vi.fn().mockResolvedValue(undefined);
    const s2 = new SmartPollScheduler(fn2, INTERVAL);
    s2.start();
    await Promise.resolve();
    expect(fn2).toHaveBeenCalledTimes(1); // immediate fire for the new resource

    s2.stop();
  });

  it('passes an isStale() check into fn that flips true once the scheduler is stopped mid-flight', async () => {
    let releaseFn: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    let observedStale: boolean | undefined;

    const fn = vi.fn(async (isStale: () => boolean) => {
      await gate;
      observedStale = isStale();
    });
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve(); // tick() begins, fn() is now awaiting `gate`
    expect(fn).toHaveBeenCalledTimes(1);

    // Simulates a key change tearing this scheduler down while its request
    // for the OLD resource is still in flight.
    scheduler.stop();

    releaseFn();
    await gate;
    await Promise.resolve();
    await Promise.resolve();

    expect(observedStale).toBe(true);
  });

  it('does not reschedule a follow-up tick for a response that resolves after stop()', async () => {
    let releaseFn: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    const fn = vi.fn(async () => {
      await gate;
    });
    const scheduler = new SmartPollScheduler(fn, INTERVAL);

    scheduler.start();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    scheduler.stop();
    releaseFn();
    await gate;
    await Promise.resolve();

    // If the stale tick had scheduled a follow-up despite stop(), this would
    // eventually fire a second call.
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
