import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * P2 — what `POST /api/checkpoints/new` leaves behind, and what it says.
 *
 * The wipe already archived the three evidence directories. `spot-check-reviews.json`
 * was not one of them: a flat ledger of "the human already audited run X", keyed
 * by run ids the wipe destroys. Left in place it is a permanent hold on nothing.
 * It is swept out rather than snapshotted in, and CHECKPOINT_SCOPE says so.
 *
 * The engine guard's copy is the other half: `checkpoints/new` shares
 * `restoreBlockedReason` with the restore route, and telling someone about to
 * erase their workspace that we are protecting them from "restoring a
 * checkpoint" names the wrong operation.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-wipe-sweep-'));
process.env.LIGMA_DATA_DIR = dataDir;

mkdirSync(dataDir, { recursive: true });
writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'active-runs.json'), JSON.stringify({ runs: [] }), 'utf-8');

const { POST } = await import('../src/routes/checkpoints/new/route');
const { CHECKPOINT_SCOPE } = await import('../src/routes/checkpoints/route');
const { restoreBlockedReason } = await import('../src/routes/checkpoints/load/route');
const { recordSpotCheckReview, readSpotCheckReviews, spotCheckReviewsPath } = await import(
  '../src/store/spot-check-reviews'
);
const { NextRequest } = await import('../src/http');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function wipeRequest(): InstanceType<typeof NextRequest> {
  return new NextRequest('http://internal/api/checkpoints/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
}

describe('the workspace wipe', () => {
  it('sweeps the spot-check ledger out with the runs it names', async () => {
    recordSpotCheckReview({ taskId: 'task_1', runId: 'vrun_1', answer: 'confirmed' });
    expect(readSpotCheckReviews()).toHaveLength(1);
    // The evidence dirs it has always swept, so the two are asserted together.
    mkdirSync(path.join(dataDir, 'verification-runs', 'vrun_1'), { recursive: true });

    const res = await POST(wipeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { archivedDirs: string[] };

    expect(body.archivedDirs).toContain('spot-check-reviews.json');
    expect(body.archivedDirs).toContain('verification-runs');
    expect(existsSync(spotCheckReviewsPath())).toBe(false);
    // Nothing is deleted — the wipe's own archive still has it.
    expect(readSpotCheckReviews()).toEqual([]);
  });

  it('names itself in CHECKPOINT_SCOPE rather than leaving the human to guess', () => {
    expect(CHECKPOINT_SCOPE.excludes).toContain('verdict spot-check reviews');
    expect(CHECKPOINT_SCOPE.covers).not.toContain('verdict spot-check reviews');
  });
});

describe("the engine guard's copy", () => {
  it('names the wipe when it is a wipe', () => {
    const reason = restoreBlockedReason(true, [], 'erasing the workspace');
    expect(reason).toContain('erasing the workspace');
    expect(reason).not.toContain('restoring a checkpoint');
  });

  it('still names the restore for the restore route', () => {
    expect(restoreBlockedReason(true, [])).toContain('restoring a checkpoint');
    expect(restoreBlockedReason(false, [{ status: 'running' }])).toContain(
      'restoring a checkpoint',
    );
  });
});

describe('what the wipe archived', () => {
  it('keeps the swept ledger readable under data/archive', () => {
    const archive = path.join(dataDir, 'archive');
    const stamps: string[] = existsSync(archive) ? readdirSync(archive) : [];
    const found = stamps
      .map((s: string) => path.join(archive, s, 'spot-check-reviews.json'))
      .filter((p: string) => existsSync(p));
    expect(found).toHaveLength(1);
    expect(JSON.parse(readFileSync(found[0], 'utf-8')).reviews[0].runId).toBe('vrun_1');
  });
});
