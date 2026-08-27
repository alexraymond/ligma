import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deckOrder, needsAttention } from '@ligma/api';
import type { DecisionItem } from '@ligma/api';
import { GET } from '../src/routes/sidebar/route';
import { getDecisions, saveDecisions } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

// Regression test for the sidebar Decisions badge counting ALL pending
// decisions instead of only actionable ones (pending AND deferUntil
// null-or-past) — same predicate the decision deck uses.

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: `dec_sidebar_test_${Math.random().toString(36).slice(2, 8)}`,
    requestedBy: 'developer',
    taskId: null,
    question: 'Which way?',
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe('GET /api/sidebar — pendingDecisions badge', () => {
  let backups: Record<string, string>;

  beforeAll(async () => {
    backups = await backupDataFiles();
  });

  afterAll(async () => {
    await restoreDataFiles(backups);
  });

  it("matches the deck's actionable count, excluding deferred decisions", async () => {
    const data = await getDecisions();
    data.decisions.push(
      decision(), // actionable
      decision({ deferUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }), // deferred — not actionable
    );
    await saveDecisions(data);

    const res = await GET();
    const body = (await res.json()) as { pendingDecisions: number };
    const expected = deckOrder((await getDecisions()).decisions).length;

    expect(body.pendingDecisions).toBe(expected);
    expect(body.pendingDecisions).toBeGreaterThan(0);
  });

  // Regression: a deferred decision whose blocksTask is true still halts its
  // task for the full defer window — it must never disappear from the badge.
  it('still counts a deferred decision that blocksTask, even though the deck excludes it', async () => {
    const data = await getDecisions();
    const deferredBlocking = decision({
      blocksTask: true,
      deferUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    data.decisions.push(deferredBlocking);
    await saveDecisions(data);

    // Confirm the deck itself really does exclude it (that's the whole hazard).
    const deckIds = deckOrder((await getDecisions()).decisions).map((d) => d.id);
    expect(deckIds).not.toContain(deferredBlocking.id);
    expect(needsAttention(deferredBlocking)).toBe(true);

    const res = await GET();
    const body = (await res.json()) as { pendingDecisions: number };
    const expected = (await getDecisions()).decisions.filter((d) => needsAttention(d)).length;
    expect(body.pendingDecisions).toBe(expected);
    expect(body.pendingDecisions).toBeGreaterThanOrEqual(1);
  });
});
