/**
 * The spot-check answer path (process audit P9, seam S2).
 *
 * The card's whole purpose is auditing the judge; before this route existed its
 * answer went into one browser's localStorage, so the CLI and every other
 * client could not answer it and the Deck kept re-asking.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../../../http';

/** `Response.json()` is `unknown` under this config; every assertion below reads fields. */
async function json<T = Record<string, string>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const RUN_ID = 'run_spotcheck_1';
let runsDir: string;

beforeAll(() => {
  runsDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-vruns-'));
  mkdirSync(path.join(runsDir, RUN_ID), { recursive: true });
  process.env.VERIFICATION_RUNS_DIR = runsDir;
});

afterAll(() => {
  process.env.VERIFICATION_RUNS_DIR = undefined;
  rmSync(runsDir, { recursive: true, force: true });
});

function post(body: unknown): DaemonRequest {
  return new DaemonRequest('http://internal/api/deck/spot-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/deck/spot-check', () => {
  it('records an answer server-side, where every client can see it', async () => {
    const { POST } = await import('./route');
    const { readSpotCheckReviews, reviewedRunIds } = await import(
      '../../../store/spot-check-reviews'
    );

    const res = await POST(post({ taskId: null, runId: RUN_ID, answer: 'confirmed' }));

    expect(res.status).toBe(201);
    const body = await json<{ runId: string; answer: string; reviewedAt: string }>(res);
    expect(body.runId).toBe(RUN_ID);
    expect(body.answer).toBe('confirmed');
    expect(body.reviewedAt).toEqual(expect.any(String));

    expect(reviewedRunIds().has(RUN_ID)).toBe(true);
    expect(readSpotCheckReviews().filter((r) => r.runId === RUN_ID)).toHaveLength(1);
  });

  it('re-answering replaces rather than accumulating', async () => {
    const { POST } = await import('./route');
    const { readSpotCheckReviews } = await import('../../../store/spot-check-reviews');

    await POST(post({ taskId: null, runId: RUN_ID, answer: 'disputed' }));

    const mine = readSpotCheckReviews().filter((r) => r.runId === RUN_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.answer).toBe('disputed');
  });

  it('rejects an answer outside confirmed|disputed', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ taskId: null, runId: RUN_ID, answer: 'Looks right' }));

    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('Validation failed');
  });

  it('404s a run that does not exist — a review of nothing is not a review', async () => {
    const { POST } = await import('./route');
    expect(
      (await POST(post({ taskId: null, runId: 'run_nope', answer: 'confirmed' }))).status,
    ).toBe(404);
  });

  it('404s a path-shaped run id instead of resolving it', async () => {
    const { POST } = await import('./route');
    expect(
      (await POST(post({ taskId: null, runId: '../../etc', answer: 'confirmed' }))).status,
    ).toBe(404);
  });

  it('404s an answer naming a task that is gone (the post-wipe orphan)', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ taskId: 'task_wiped', runId: RUN_ID, answer: 'confirmed' }));

    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatch(/Task not found/);
  });

  it('GET lists what has been reviewed', async () => {
    const { GET } = await import('./route');
    const body = await json<{ reviews: Array<{ runId: string }> }>(await GET());

    expect(body.reviews.some((r: { runId: string }) => r.runId === RUN_ID)).toBe(true);
  });
});
