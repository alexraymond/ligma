import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * needs-you-ping.ts — the 24h overdue-blocking-item ping (UX-REBUILD-BRIEF
 * §Phase 1), against a throwaway data dir. No osascript call is exercised
 * here (checkAndPingOverdue takes an injectable `notify`, spied instead).
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-needs-you-ping-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { overdueBlockingItems, readPinged, writePinged, DEFAULT_THRESHOLD_MS } = await import(
  './needs-you-ping'
);

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-14T12:00:00.000Z');

function card(
  overrides: Partial<{ id: string; kind: string; title: string; createdAt: string }> = {},
) {
  return {
    id: 'item_1',
    kind: 'decision',
    title: 'Untitled',
    createdAt: new Date(NOW - 25 * HOUR).toISOString(),
    ...overrides,
  };
}

describe('overdueBlockingItems', () => {
  it('includes a blocking-kind card older than 24h and not yet pinged', () => {
    const out = overdueBlockingItems([card({ id: 'd1', kind: 'decision' })], new Set(), NOW);
    expect(out).toEqual([{ id: 'd1', title: 'Untitled' }]);
  });

  it('excludes FYI kinds even when old and unpinged', () => {
    for (const kind of ['stale-brief', 'verdict-spot-check', 'inbox']) {
      const out = overdueBlockingItems([card({ id: 'fyi', kind })], new Set(), NOW);
      expect(out).toEqual([]);
    }
  });

  it('excludes a blocking card younger than the threshold', () => {
    const out = overdueBlockingItems(
      [card({ id: 'young', createdAt: new Date(NOW - 1 * HOUR).toISOString() })],
      new Set(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('excludes a card already pinged', () => {
    const out = overdueBlockingItems([card({ id: 'seen' })], new Set(['seen']), NOW);
    expect(out).toEqual([]);
  });

  it('excludes a card with an unparseable createdAt — absent is not old', () => {
    const out = overdueBlockingItems(
      [card({ id: 'bad-date', createdAt: 'not-a-date' })],
      new Set(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('honors a custom threshold', () => {
    const oneHourOld = card({ id: 'h1', createdAt: new Date(NOW - 2 * HOUR).toISOString() });
    expect(overdueBlockingItems([oneHourOld], new Set(), NOW, HOUR)).toEqual([
      { id: 'h1', title: 'Untitled' },
    ]);
    expect(overdueBlockingItems([oneHourOld], new Set(), NOW, DEFAULT_THRESHOLD_MS)).toEqual([]);
  });

  it('covers every blocking kind', () => {
    const blocking = ['decision', 'design-approval', 'promote-pending', 'adoption-review'];
    const cards = blocking.map((kind, i) => card({ id: `k${i}`, kind }));
    const out = overdueBlockingItems(cards, new Set(), NOW);
    expect(out.map((o) => o.id)).toEqual(blocking.map((_, i) => `k${i}`));
  });
});

describe('pings persistence', () => {
  it('round-trips a write through a read', () => {
    writePinged(new Set(['a', 'b', 'c']));
    expect(readPinged()).toEqual(new Set(['a', 'b', 'c']));
  });

  it('treats a missing file as empty, no throw', () => {
    rmSync(path.join(dataDir, 'needs-you-pings.json'), { force: true });
    expect(readPinged()).toEqual(new Set());
  });

  it('treats a corrupt file as empty, no throw', () => {
    writeFileSync(path.join(dataDir, 'needs-you-pings.json'), '{not json', 'utf-8');
    expect(readPinged()).toEqual(new Set());
  });

  it('writes the documented { pinged: string[] } shape', () => {
    writePinged(new Set(['x']));
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'needs-you-pings.json'), 'utf-8'));
    expect(raw).toEqual({ pinged: ['x'] });
  });
});
