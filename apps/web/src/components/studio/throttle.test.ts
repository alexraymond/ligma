/**
 * The progressive-render cadence. Two properties matter and both were the
 * reason ligma-classic's version existed: independent per-key slots, and a
 * trailing edge that never drops the final state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FS_THROTTLE_MS, createKeyedThrottle } from './throttle';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createKeyedThrottle', () => {
  it('flushes the first value immediately', () => {
    const flush = vi.fn();
    createKeyedThrottle<string>(flush).schedule('a', 'one');
    expect(flush).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('coalesces a burst into one trailing flush carrying the last value', () => {
    const flush = vi.fn();
    const throttle = createKeyedThrottle<string>(flush);
    throttle.schedule('a', '1'); // immediate
    for (const value of ['2', '3', '4']) throttle.schedule('a', value);
    expect(flush).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FS_THROTTLE_MS);
    expect(flush).toHaveBeenCalledTimes(2);
    // The final state always lands — never one write short.
    expect(flush).toHaveBeenLastCalledWith('4');
  });

  it('keys slots independently so parallel files do not strobe together', () => {
    const flush = vi.fn();
    const throttle = createKeyedThrottle<string>(flush);
    throttle.schedule('a', 'a1');
    throttle.schedule('b', 'b1');
    expect(flush).toHaveBeenCalledTimes(2);

    throttle.schedule('a', 'a2');
    vi.advanceTimersByTime(FS_THROTTLE_MS);
    expect(flush).toHaveBeenCalledTimes(3);
    expect(flush).toHaveBeenLastCalledWith('a2');
  });

  it('cancelAll drops armed timers', () => {
    const flush = vi.fn();
    const throttle = createKeyedThrottle<string>(flush);
    throttle.schedule('a', '1');
    throttle.schedule('a', '2');
    throttle.cancelAll();
    vi.advanceTimersByTime(FS_THROTTLE_MS * 4);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
