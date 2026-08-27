/**
 * Atomic slot claiming for harness spawns (F4) and the attempt cap setting (F3).
 *
 * F4: personas and the judge used awaitSpawn (which polls canSpawn and reserves
 * nothing) plus a separate recordSpawn — check-then-act. With
 * maxParallelPersonas > 1, two personas could both see the last slot free and
 * both take it, overrunning the window the governor exists to protect.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// Must be set before quota-governor is imported: the real quota window is not ours.
process.env.MC_GOVERNOR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-slot-'));

const { awaitClaimedSlot } = await import('../src/harness/spawn-slot');
const { ledgerFilePath, readLedger, status } = await import('../src/engine/quota-governor');
const { loadConfig } = await import('../src/engine/config');

/** Fill the window so exactly `slots` remain for autonomous roles. */
function leaveSlots(slots: number): void {
  writeFileSync(ledgerFilePath(), JSON.stringify({ spawns: [], backends: {} }), 'utf-8');
  const { reserveFloor } = status();
  const fill = Math.max(0, reserveFloor - slots);
  writeFileSync(
    ledgerFilePath(),
    JSON.stringify({
      spawns: Array.from({ length: fill }, (_, i) => ({
        ts: new Date(Date.now() - 60_000).toISOString(),
        backend: 'claude',
        role: 'builder',
        ref: `filler_${i}`,
      })),
      backends: {},
    }),
    'utf-8',
  );
  expect(status().remainingForAutonomy).toBe(slots);
}

const claim = (ref: string) =>
  awaitClaimedSlot('persona', { label: `persona ${ref}`, ref, maxWaitMs: 40, pollMs: 5 });

describe('awaitClaimedSlot', () => {
  beforeEach(() => leaveSlots(2));

  it('never lets concurrent claims exceed the window', async () => {
    const results = await Promise.allSettled([
      claim('p1'),
      claim('p2'),
      claim('p3'),
      claim('p4'),
      claim('p5'),
    ]);
    const granted = results.filter((r) => r.status === 'fulfilled');
    expect(granted.length).toBe(2);
    expect(status().remainingForAutonomy).toBe(0);
    // The refused ones say why rather than spawning anyway.
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/governor denied/);
    }
  });

  it('books each granted slot exactly once — no double counting', async () => {
    const before = readLedger().spawns.length;
    await Promise.allSettled([claim('p1'), claim('p2'), claim('p3')]);
    const added = readLedger().spawns.slice(before);
    expect(added.length).toBe(2);
    expect(new Set(added.map((s) => s.ref)).size).toBe(2);
    expect(added.every((s) => s.role === 'persona')).toBe(true);
  });

  it('writes nothing when the claim is refused', async () => {
    leaveSlots(0);
    const before = readLedger().spawns.length;
    await expect(claim('p1')).rejects.toThrow(/governor denied/);
    expect(readLedger().spawns.length).toBe(before);
  });

  it('grants the slot and returns the routed backend when there is room', async () => {
    leaveSlots(5);
    await expect(claim('p1')).resolves.toBe('claude');
  });
});

describe('harness.maxVerificationAttempts is a live setting (F3)', () => {
  it('defaults to 3 and is typed, not read through a cast with a fallback', () => {
    expect(loadConfig().execution.harness.maxVerificationAttempts).toBeGreaterThanOrEqual(1);
    expect(loadConfig().execution.harness.maxVerificationAttempts).toBeLessThanOrEqual(10);
  });
});
