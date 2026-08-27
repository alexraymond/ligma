import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  BATCH_THRESHOLD,
  DEFER_MS,
  DISMISS_ANSWER,
  UNDO_WINDOW_MS,
  applyDisposition,
  deckOrder,
  deferredOrder,
  isActionable,
  isDeferred,
} from '@ligma/api';
import type { DecisionItem } from '@ligma/api';
import { PATCH, POST } from '../src/routes/decisions/route';
import { getActivityLog, getDecisions, saveDecisions } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: `dec_test_${Math.random().toString(36).slice(2, 8)}`,
    requestedBy: 'developer',
    taskId: null,
    question: 'Which way?',
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

// ─── Deck query logic ────────────────────────────────────────────────────────

describe('deck query — actionable filter', () => {
  it('includes a plain pending decision', () => {
    expect(isActionable(decision(), NOW)).toBe(true);
  });

  it('excludes answered decisions', () => {
    expect(isActionable(decision({ status: 'answered', answer: 'A' }), NOW)).toBe(false);
  });

  it('excludes a decision deferred into the future', () => {
    const d = decision({ deferUntil: new Date(NOW + 1000).toISOString() });
    expect(isActionable(d, NOW)).toBe(false);
    expect(isDeferred(d, NOW)).toBe(true);
  });

  it('includes a decision whose defer window has passed', () => {
    const d = decision({ deferUntil: new Date(NOW - 1).toISOString() });
    expect(isActionable(d, NOW)).toBe(true);
    expect(isDeferred(d, NOW)).toBe(false);
  });

  it('treats deferUntil null and unparseable dates as not deferred', () => {
    expect(isActionable(decision({ deferUntil: null }), NOW)).toBe(true);
    expect(isActionable(decision({ deferUntil: 'soon' }), NOW)).toBe(true);
  });

  it('never counts a deferred-but-answered decision as deferred', () => {
    const d = decision({
      status: 'answered',
      answer: 'A',
      deferUntil: new Date(NOW + 1000).toISOString(),
    });
    expect(isDeferred(d, NOW)).toBe(false);
  });
});

describe('deck query — ordering', () => {
  it('puts urgent (urgentAt set) cards first, then oldest first', () => {
    const old = decision({ id: 'old', createdAt: new Date(NOW - 10 * 60_000).toISOString() });
    const newer = decision({ id: 'newer', createdAt: new Date(NOW - 60_000).toISOString() });
    const urgent = decision({
      id: 'urgent',
      createdAt: new Date(NOW - 1000).toISOString(),
      urgentAt: new Date(NOW - 500).toISOString(),
    });

    expect(deckOrder([old, newer, urgent], NOW).map((d) => d.id)).toEqual([
      'urgent',
      'old',
      'newer',
    ]);
  });

  it('does not treat a missing urgentAt as urgent', () => {
    const undefinedFlag = decision({ id: 'unset', createdAt: new Date(NOW - 1000).toISOString() });
    const explicitUrgent = decision({
      id: 'urgent',
      createdAt: new Date(NOW - 100).toISOString(),
      urgentAt: new Date(NOW - 50).toISOString(),
    });
    expect(deckOrder([undefinedFlag, explicitUrgent], NOW).map((d) => d.id)).toEqual([
      'urgent',
      'unset',
    ]);
  });

  it('a blocksTask:true card is NOT treated as urgent by isUrgent/deckOrder', () => {
    const blocking = decision({
      id: 'blocking',
      createdAt: new Date(NOW - 60_000).toISOString(),
      blocksTask: true,
    });
    const urgent = decision({
      id: 'urgent',
      createdAt: new Date(NOW - 1000).toISOString(),
      urgentAt: new Date(NOW - 500).toISOString(),
    });
    // urgentAt still wins the front slot; blocksTask alone does not confer urgency.
    expect(deckOrder([blocking, urgent], NOW).map((d) => d.id)).toEqual(['urgent', 'blocking']);
  });

  it('among non-urgent cards, blocking sorts before non-blocking, then oldest first', () => {
    const nonBlocking = decision({
      id: 'non-blocking',
      createdAt: new Date(NOW - 10 * 60_000).toISOString(),
      blocksTask: false,
    });
    const blocking = decision({
      id: 'blocking',
      createdAt: new Date(NOW - 60_000).toISOString(),
      blocksTask: true,
    });
    expect(deckOrder([nonBlocking, blocking], NOW).map((d) => d.id)).toEqual([
      'blocking',
      'non-blocking',
    ]);
  });

  it('drops non-actionable cards from the deck and lists deferred ones soonest-first', () => {
    const pending = decision({ id: 'p' });
    const answered = decision({ id: 'a', status: 'answered', answer: 'A' });
    const later = decision({ id: 'later', deferUntil: new Date(NOW + 2 * DEFER_MS).toISOString() });
    const sooner = decision({ id: 'sooner', deferUntil: new Date(NOW + DEFER_MS).toISOString() });

    expect(deckOrder([pending, answered, later, sooner], NOW).map((d) => d.id)).toEqual(['p']);
    expect(deferredOrder([pending, answered, later, sooner], NOW).map((d) => d.id)).toEqual([
      'sooner',
      'later',
    ]);
  });

  it('batch threshold is the documented 10', () => {
    expect(BATCH_THRESHOLD).toBe(10);
  });
});

describe('applyDisposition', () => {
  it('answer records the choice and the time', () => {
    const out = applyDisposition(decision(), 'answer', 'B', NOW);
    expect(out.status).toBe('answered');
    expect(out.answer).toBe('B');
    expect(out.answeredAt).toBe(new Date(NOW).toISOString());
  });

  it('dismiss answers with the dismissal sentinel', () => {
    const out = applyDisposition(decision(), 'dismiss', '', NOW);
    expect(out.status).toBe('answered');
    expect(out.answer).toBe(DISMISS_ANSWER);
  });

  it('urgent stays pending, stamps urgentAt, and leaves createdAt alone', () => {
    const before = decision();
    const out = applyDisposition(before, 'urgent', '', NOW);
    expect(out.status).toBe('pending');
    expect(out.urgentAt).toBe(new Date(NOW).toISOString());
    expect(out.createdAt).toBe(before.createdAt);
  });

  it('urgent never touches blocksTask — flagging for attention must not gate the task', () => {
    // The agent's own non-blocking report must survive a human "look at this" swipe.
    const nonBlocking = decision({ blocksTask: false });
    expect(applyDisposition(nonBlocking, 'urgent', '', NOW).blocksTask).toBe(false);

    const unset = decision();
    expect(applyDisposition(unset, 'urgent', '', NOW).blocksTask).toBeUndefined();

    const blocking = decision({ blocksTask: true });
    expect(applyDisposition(blocking, 'urgent', '', NOW).blocksTask).toBe(true);
  });

  it('defer stays pending, pushes 7 days out, and counts up', () => {
    const out = applyDisposition(decision({ deferCount: 2 }), 'defer', '', NOW);
    expect(out.status).toBe('pending');
    expect(out.deferUntil).toBe(new Date(NOW + DEFER_MS).toISOString());
    expect(out.deferCount).toBe(3);
  });

  it('does not mutate its input', () => {
    const before = decision();
    applyDisposition(before, 'answer', 'B', NOW);
    expect(before.status).toBe('pending');
    expect(before.answer).toBeNull();
  });
});

// ─── PATCH /api/decisions (deck dispositions + undo) ─────────────────────────

function patch(body: unknown): Promise<Response> {
  return PATCH(
    new Request('http://localhost/api/decisions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function seed(overrides: Partial<DecisionItem> = {}): Promise<DecisionItem> {
  const d = decision({ createdAt: new Date().toISOString(), ...overrides });
  const data = await getDecisions();
  data.decisions.push(d);
  await saveDecisions(data);
  return d;
}

async function reload(id: string): Promise<DecisionItem | undefined> {
  const data = await getDecisions();
  return data.decisions.find((d) => d.id === id);
}

describe('PATCH /api/decisions — deck dispositions', () => {
  let backups: Record<string, string>;

  beforeAll(async () => {
    backups = await backupDataFiles();
  });

  afterAll(async () => {
    await restoreDataFiles(backups);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a decision and logs one activity event', async () => {
    const seeded = await seed();
    const res = await patch({ id: seeded.id, action: 'answer', answer: 'Option B' });
    expect(res.status).toBe(200);

    const stored = await reload(seeded.id);
    expect(stored?.status).toBe('answered');
    expect(stored?.answer).toBe('Option B');
    expect(stored?.answeredAt).toBeTruthy();

    const log = await getActivityLog();
    expect(log.events.filter((e) => e.details === `decision:${seeded.id}`)).toHaveLength(1);
  });

  it('rejects an answer action with no answer', async () => {
    const seeded = await seed();
    const res = await patch({ id: seeded.id, action: 'answer', answer: '   ' });
    expect(res.status).toBe(400);
    expect((await reload(seeded.id))?.status).toBe('pending');
  });

  it('dismiss records the sentinel answer', async () => {
    const seeded = await seed();
    expect((await patch({ id: seeded.id, action: 'dismiss' })).status).toBe(200);
    expect((await reload(seeded.id))?.answer).toBe(DISMISS_ANSWER);
  });

  it('urgent keeps the decision pending, stamps urgentAt, and logs nothing', async () => {
    const seeded = await seed();
    const before = (await getActivityLog()).events.length;
    expect((await patch({ id: seeded.id, action: 'urgent' })).status).toBe(200);

    const stored = await reload(seeded.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.urgentAt).toBeTruthy();
    expect((await getActivityLog()).events.length).toBe(before);
  });

  it('urgent on a non-blocking decision does not flip it to blocking', async () => {
    // Regression: swiping a card explicitly badged "Non-blocking" for human
    // attention must not stop the daemon from dispatching its linked task.
    const seeded = await seed({ blocksTask: false });
    expect((await patch({ id: seeded.id, action: 'urgent' })).status).toBe(200);

    const stored = await reload(seeded.id);
    expect(stored?.blocksTask).toBe(false);
    expect(stored?.urgentAt).toBeTruthy();
  });

  it('defer sets a ~7 day resurface date and increments the count', async () => {
    const seeded = await seed();
    expect((await patch({ id: seeded.id, action: 'defer' })).status).toBe(200);

    const stored = await reload(seeded.id);
    expect(stored?.deferCount).toBe(1);
    const delta = Date.parse(stored?.deferUntil!) - Date.now();
    expect(delta).toBeGreaterThan(DEFER_MS - 60_000);
    expect(delta).toBeLessThanOrEqual(DEFER_MS);
  });

  it('POST keeps the blocksTask flag its schema accepts, so the deck can front it', async () => {
    const res = await POST(
      new Request('http://localhost/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedBy: 'developer',
          question: 'Does this block?',
          options: ['Yes'],
          context: '',
          blocksTask: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as DecisionItem;
    expect((await reload(created.id))?.blocksTask).toBe(true);
  });

  it('404s an unknown decision and 409s one that is no longer pending', async () => {
    expect((await patch({ id: 'dec_nope', action: 'dismiss' })).status).toBe(404);

    const seeded = await seed({ status: 'answered', answer: 'already' });
    const res = await patch({ id: seeded.id, action: 'dismiss' });
    expect(res.status).toBe(409);
    expect((await reload(seeded.id))?.answer).toBe('already');
  });
});

describe('PATCH /api/decisions — undo window', () => {
  let backups: Record<string, string>;

  beforeAll(async () => {
    backups = await backupDataFiles();
  });

  afterAll(async () => {
    await restoreDataFiles(backups);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the exact previous state inside the window', async () => {
    const seeded = await seed({ deferCount: 1 });
    await patch({ id: seeded.id, action: 'defer' });
    expect((await reload(seeded.id))?.deferCount).toBe(2);

    const res = await patch({ id: seeded.id, action: 'undo' });
    expect(res.status).toBe(200);

    const stored = await reload(seeded.id);
    expect(stored?.deferCount).toBe(1);
    expect(stored?.deferUntil).toBeUndefined();
    expect(stored?.status).toBe('pending');
  });

  it('removes the activity event when an answer is undone', async () => {
    const seeded = await seed();
    await patch({ id: seeded.id, action: 'answer', answer: 'Option A' });
    expect((await getActivityLog()).events.some((e) => e.details === `decision:${seeded.id}`)).toBe(
      true,
    );

    await patch({ id: seeded.id, action: 'undo' });

    const stored = await reload(seeded.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.answer).toBeNull();
    expect(stored?.answeredAt).toBeNull();
    expect((await getActivityLog()).events.some((e) => e.details === `decision:${seeded.id}`)).toBe(
      false,
    );
  });

  it('rejects an undo once the 10s window has passed, leaving the action applied', async () => {
    const seeded = await seed();
    await patch({ id: seeded.id, action: 'dismiss' });

    const later = Date.now() + UNDO_WINDOW_MS + 1_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);

    const res = await patch({ id: seeded.id, action: 'undo' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('expired') });

    vi.restoreAllMocks();
    const stored = await reload(seeded.id);
    expect(stored?.status).toBe('answered');
    expect(stored?.answer).toBe(DISMISS_ANSWER);
  });

  it('404s an undo for a decision that was never disposed of through the deck', async () => {
    const seeded = await seed();
    const res = await patch({ id: seeded.id, action: 'undo' });
    expect(res.status).toBe(404);
  });

  it('only remembers the most recent disposition per decision', async () => {
    const seeded = await seed();
    await patch({ id: seeded.id, action: 'urgent' });
    await patch({ id: seeded.id, action: 'defer' });

    await patch({ id: seeded.id, action: 'undo' });
    const stored = await reload(seeded.id);
    // The defer is rolled back; the urgentAt it was applied on top of stays.
    expect(stored?.deferUntil).toBeUndefined();
    expect(stored?.urgentAt).toBeTruthy();

    expect((await patch({ id: seeded.id, action: 'undo' })).status).toBe(404);
  });
});
