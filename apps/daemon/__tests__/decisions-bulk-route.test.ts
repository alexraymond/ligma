import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActivityLogFile, DecisionItem, DecisionsFile } from '@ligma/api';
/**
 * PATCH /api/decisions/bulk — atomicity, shared undo journal, idempotency.
 *
 * Runs against a throwaway `LIGMA_DATA_DIR` (same technique as
 * briefs-api.test.ts): decisions.json and activity-log.json are seeded
 * directly, then the route module is imported dynamically so its top-level
 * `DATA_DIR` read happens after the env var is set, not before.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-decisions-bulk-'));
process.env.LIGMA_DATA_DIR = dataDir;

function decision(id: string, overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id,
    requestedBy: 'developer',
    taskId: null,
    question: `Question for ${id}?`,
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SEED_IDS = ['dec_1', 'dec_2', 'dec_3'];

function writeDecisions(decisions: DecisionItem[]): void {
  const file: DecisionsFile = { decisions };
  writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify(file), 'utf-8');
}

mkdirSync(dataDir, { recursive: true });
writeDecisions(SEED_IDS.map((id) => decision(id)));
writeFileSync(
  path.join(dataDir, 'activity-log.json'),
  JSON.stringify({ events: [] } satisfies ActivityLogFile),
  'utf-8',
);

const { PATCH: bulkPatch } = await import('../src/routes/decisions/bulk/route');
const { PATCH: singlePatch } = await import('../src/routes/decisions/route');
const { getDecisions } = await import('../src/store/data');

interface BulkResult {
  results: Array<{
    id: string;
    ok: boolean;
    error?: string;
    undoExpiresAt?: string;
    decision?: DecisionItem;
  }>;
  succeeded: number;
  failed: number;
}

function bulkRequest(items: Array<{ id: string; action: string; answer?: string }>): Request {
  return new Request('http://internal/api/decisions/bulk', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

function singleRequest(body: unknown): Request {
  return new Request('http://internal/api/decisions', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/decisions/bulk', () => {
  beforeAll(() => {
    writeDecisions(SEED_IDS.map((id) => decision(id)));
  });

  it('answers every item in one atomic call, each with its own server-derived undoExpiresAt', async () => {
    const before = Date.now();
    const res = await bulkPatch(
      bulkRequest([
        { id: 'dec_1', action: 'answer', answer: 'Go with A' },
        { id: 'dec_2', action: 'dismiss' },
      ]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BulkResult;
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);

    const dec1 = body.results.find((r) => r.id === 'dec_1')!;
    const dec2 = body.results.find((r) => r.id === 'dec_2')!;
    expect(dec1.ok).toBe(true);
    expect(dec2.ok).toBe(true);
    expect(Date.parse(dec1.undoExpiresAt!)).toBeGreaterThan(before);
    expect(Date.parse(dec2.undoExpiresAt!)).toBeGreaterThan(before);

    // The one item not named in the batch is untouched — a bulk call is not
    // "answer everything pending".
    const data = await getDecisions();
    expect(data.decisions.find((d) => d.id === 'dec_1')?.status).toBe('answered');
    expect(data.decisions.find((d) => d.id === 'dec_1')?.answer).toBe('Go with A');
    expect(data.decisions.find((d) => d.id === 'dec_2')?.status).toBe('answered');
    expect(data.decisions.find((d) => d.id === 'dec_3')?.status).toBe('pending');
  });

  it("shares the single PATCH's undo journal — a bulk-answered decision undoes through the same action", async () => {
    const res = await singlePatch(singleRequest({ id: 'dec_1', action: 'undo' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: DecisionItem };
    expect(body.decision.status).toBe('pending');
    expect(body.decision.answer).toBeNull();

    // Leave it answered again for the next test's "already resolved" case.
    await bulkPatch(bulkRequest([{ id: 'dec_1', action: 'answer', answer: 'Go with A' }]));
  });

  it('is idempotent: replaying the same batch fails each item instead of double-applying', async () => {
    const before = await getDecisions();
    const dec1Before = before.decisions.find((d) => d.id === 'dec_1')!;

    const replay = await bulkPatch(
      bulkRequest([
        { id: 'dec_1', action: 'answer', answer: 'Go with A' },
        { id: 'dec_2', action: 'dismiss' },
      ]),
    );
    const body = (await replay.json()) as BulkResult;
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(2);
    for (const r of body.results) {
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no longer pending/i);
    }

    // Nothing about the already-answered decision changed on the replay.
    const after = await getDecisions();
    const dec1After = after.decisions.find((d) => d.id === 'dec_1')!;
    expect(dec1After).toEqual(dec1Before);
  });

  it('an unknown id fails on its own without blocking the rest of the batch', async () => {
    writeDecisions([decision('dec_solo')]);
    const res = await bulkPatch(
      bulkRequest([
        { id: 'dec_solo', action: 'dismiss' },
        { id: 'dec_missing', action: 'dismiss' },
      ]),
    );
    const body = (await res.json()) as BulkResult;
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r) => r.id === 'dec_missing')?.error).toMatch(/not found/i);
    expect(body.results.find((r) => r.id === 'dec_solo')?.ok).toBe(true);

    const data = await getDecisions();
    expect(data.decisions.find((d) => d.id === 'dec_solo')?.status).toBe('answered');
  });

  it('rejects an empty items array', async () => {
    const res = await bulkPatch(bulkRequest([]));
    expect(res.status).toBe(400);
  });

  it('rejects an answer action with no answer text', async () => {
    writeDecisions([decision('dec_needs_answer')]);
    const res = await bulkPatch(bulkRequest([{ id: 'dec_needs_answer', action: 'answer' }]));
    expect(res.status).toBe(400);
  });
});
