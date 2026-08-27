import type { DesignCriticEvent } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_BASE_STEP_MS, createCritiqueReplayer, stepDelayMs } from './critique-replay';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function event(phase: DesignCriticEvent['phase']): DesignCriticEvent {
  return {
    designId: 'd1',
    turnId: 'dt1',
    phase,
    status: 'running',
    rule: null,
    score: null,
    threshold: 75,
    error: null,
  };
}

describe('stepDelayMs', () => {
  it('halves at 2x and quarters at 4x', () => {
    expect(stepDelayMs(1)).toBe(REPLAY_BASE_STEP_MS);
    expect(stepDelayMs(2)).toBe(REPLAY_BASE_STEP_MS / 2);
    expect(stepDelayMs(4)).toBe(REPLAY_BASE_STEP_MS / 4);
  });
});

describe('createCritiqueReplayer', () => {
  it('dispatches the first event synchronously', () => {
    const onEvent = vi.fn();
    createCritiqueReplayer([event('start'), event('end')], 1, { onEvent, onDone: vi.fn() });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: 'start' }), 0);
  });

  it('paces the rest at stepDelayMs(speed) and calls onDone exactly once exhausted', () => {
    const onEvent = vi.fn();
    const onDone = vi.fn();
    createCritiqueReplayer([event('start'), event('rule'), event('end')], 1, { onEvent, onDone });
    expect(onEvent).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REPLAY_BASE_STEP_MS);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REPLAY_BASE_STEP_MS);
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('runs proportionally faster at higher speeds', () => {
    const onEvent = vi.fn();
    createCritiqueReplayer([event('start'), event('end')], 4, { onEvent, onDone: vi.fn() });
    vi.advanceTimersByTime(REPLAY_BASE_STEP_MS / 4);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('calls onDone immediately, with no timer, for an empty transcript', () => {
    const onDone = vi.fn();
    createCritiqueReplayer([], 1, { onEvent: vi.fn(), onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    // Nothing pending, so advancing time changes nothing.
    vi.advanceTimersByTime(10_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels the pending step', () => {
    const onEvent = vi.fn();
    const replayer = createCritiqueReplayer([event('start'), event('rule'), event('end')], 1, {
      onEvent,
      onDone: vi.fn(),
    });
    replayer.stop();
    vi.advanceTimersByTime(10_000);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('setSpeed changes the delay for the next scheduled step, not the one in flight', () => {
    const onEvent = vi.fn();
    const replayer = createCritiqueReplayer([event('start'), event('rule'), event('end')], 1, {
      onEvent,
      onDone: vi.fn(),
    });
    replayer.setSpeed(4);
    // The next step was already scheduled at 1x's delay when speed flips —
    // this only changes what stepDelayMs is consulted for going forward.
    vi.advanceTimersByTime(REPLAY_BASE_STEP_MS / 4);
    expect(onEvent).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REPLAY_BASE_STEP_MS - REPLAY_BASE_STEP_MS / 4);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
