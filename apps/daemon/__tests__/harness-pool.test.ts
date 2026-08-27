/**
 * The persona worker pool's cancellation contract.
 *
 * A bare Promise.all rejected on the first failure while the remaining workers
 * kept pulling personas off the roster — so run-verification's `finally` tore the
 * env and bridge down underneath agents that were still driving a browser at
 * them. The pool must stop taking new work AND settle before it rethrows.
 */

import { describe, expect, it } from 'vitest';
import { mapWithLimit } from '../src/harness/run-verification';

describe('mapWithLimit', () => {
  it('returns results in input order regardless of completion order', async () => {
    const out = await mapWithLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('stops handing out work after a failure', async () => {
    const seen: number[] = [];
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    await expect(
      mapWithLimit(items, 2, async (n) => {
        seen.push(n);
        await new Promise((r) => setTimeout(r, 5));
        if (n === 1) throw new Error('governor abort');
        return n;
      }),
    ).rejects.toThrow('governor abort');

    // The two workers each had one item in flight; nothing past that was started.
    expect(seen.length).toBeLessThanOrEqual(4);
    expect(seen).toContain(1);
  });

  it('waits for in-flight work to settle before rethrowing', async () => {
    let inFlight = 0;
    let sawOverlapAfterThrow = false;
    let thrown = false;

    await expect(
      mapWithLimit([1, 2], 2, async (n) => {
        inFlight += 1;
        if (n === 1) {
          thrown = true;
          inFlight -= 1;
          throw new Error('boom');
        }
        await new Promise((r) => setTimeout(r, 20));
        if (thrown) sawOverlapAfterThrow = true;
        inFlight -= 1;
        return n;
      }),
    ).rejects.toThrow('boom');

    // The slow worker really was still running when the fast one threw...
    expect(sawOverlapAfterThrow).toBe(true);
    // ...and the pool did not resolve until it finished. Teardown is safe.
    expect(inFlight).toBe(0);
  });

  it('propagates the FIRST failure, not the last', async () => {
    await expect(
      mapWithLimit([1, 2], 1, async (n) => {
        throw new Error(`fail-${n}`);
      }),
    ).rejects.toThrow('fail-1');
  });
});
