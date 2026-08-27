import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * GET /api/runs/:id/changes, against a throwaway data dir.
 *
 * The distinction under test throughout: absent ≠ empty. A run with no capture
 * answers null; a run that genuinely changed nothing answers "".
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-run-changes-route-'));
process.env.LIGMA_DATA_DIR = dataDir;
delete process.env.MC_RUN_OUTPUTS_DIR;

const outputs = path.join(dataDir, 'run-outputs');
mkdirSync(outputs, { recursive: true });

const SHA = 'a'.repeat(40);

writeFileSync(
  path.join(outputs, 'run_captured.changes.json'),
  JSON.stringify({
    commitSha: SHA,
    capturedAt: '2026-08-14T10:00:00.000Z',
    stat: ' src/button.tsx | 4 ++--\n 1 file changed',
    diff: 'diff --git a/src/button.tsx b/src/button.tsx\n+wired\n',
    status: ' M src/button.tsx',
    truncated: false,
  }),
  'utf-8',
);
writeFileSync(
  path.join(outputs, 'run_nocapture.jsonl'),
  '{"ts":"2026-01-01T00:00:00.000Z","stream":"stdout","text":"hi"}\n',
  'utf-8',
);
writeFileSync(path.join(outputs, 'run_corrupt.changes.json'), '{ this is not json', 'utf-8');

// Deliberately mixed: one row carrying Phase 2 fields, one written before they
// existed. Both must serve.
writeFileSync(
  path.join(dataDir, 'active-runs.json'),
  JSON.stringify({
    runs: [
      {
        id: 'run_captured',
        taskId: 'task_1',
        agentId: 'developer',
        projectId: 'proj_1',
        pid: 1,
        status: 'completed',
        startedAt: '2026-08-14T09:00:00.000Z',
        completedAt: '2026-08-14T10:00:00.000Z',
        exitCode: 0,
        error: null,
        outputFile: null,
        commitSha: SHA,
      },
      {
        id: 'run_sha_only',
        taskId: 'task_2',
        agentId: 'developer',
        projectId: null,
        pid: 2,
        status: 'failed',
        startedAt: '2026-08-14T09:00:00.000Z',
        completedAt: '2026-08-14T09:30:00.000Z',
        exitCode: 1,
        error: 'boom',
        outputFile: null,
        commitSha: 'b'.repeat(40),
      },
      {
        id: 'run_old',
        taskId: 'task_3',
        agentId: 'developer',
        projectId: null,
        pid: 3,
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:10:00.000Z',
        exitCode: 0,
        error: null,
        outputFile: null,
      },
      {
        id: 'run_corrupt',
        taskId: 'task_4',
        agentId: 'developer',
        projectId: null,
        pid: 4,
        status: 'completed',
        startedAt: '2026-08-14T09:00:00.000Z',
        completedAt: '2026-08-14T09:10:00.000Z',
        exitCode: 0,
        error: null,
        outputFile: null,
      },
    ],
  }),
  'utf-8',
);

const { GET } = await import('./route');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

interface ChangesBody {
  commitSha: string | null;
  capturedAt: string | null;
  stat: string | null;
  diff: string | null;
  status?: string | null;
  truncated?: boolean;
  error?: string;
}

const get = async (id: string): Promise<{ status: number; body: ChangesBody }> => {
  const res = await GET(new Request(`http://x/api/runs/${id}/changes`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: (await res.json()) as ChangesBody };
};

describe('GET /api/runs/:id/changes', () => {
  it('serves a captured diff with its commit and capture time', async () => {
    const { status, body } = await get('run_captured');
    expect(status).toBe(200);
    expect(body.commitSha).toBe(SHA);
    expect(body.capturedAt).toBe('2026-08-14T10:00:00.000Z');
    expect(body.stat).toContain('src/button.tsx');
    expect(body.diff).toContain('+wired');
    expect(body.truncated).toBe(false);
  });

  it("falls back to the run row's spawn commit when no capture happened", async () => {
    // The run knows what it started from even when the capture failed — that is
    // still a true and useful answer, so it is not withheld.
    const { status, body } = await get('run_sha_only');
    expect(status).toBe(200);
    expect(body.commitSha).toBe('b'.repeat(40));
    expect(body.capturedAt).toBeNull();
    expect(body.diff).toBeNull();
    expect(body.stat).toBeNull();
  });

  it('answers all-null for a pre-Phase-2 run row rather than 404ing it', async () => {
    // Migration tolerance: a row with no commitSha, no promptFile, no
    // changesFile still serves. "We have no record" is the honest answer;
    // "no such run" would be a false one.
    const { status, body } = await get('run_old');
    expect(status).toBe(200);
    expect(body.commitSha).toBeNull();
    expect(body.capturedAt).toBeNull();
    expect(body.stat).toBeNull();
    expect(body.diff).toBeNull();
  });

  it('treats a half-written capture as no capture', async () => {
    const { status, body } = await get('run_corrupt');
    expect(status).toBe(200);
    expect(body.diff).toBeNull();
  });

  it('serves a run pruned from active-runs.json but still holding output', async () => {
    // The output file is the third witness. Runs are pruned an hour after they
    // finish, and their evidence outlives the row.
    const { status, body } = await get('run_nocapture');
    expect(status).toBe(200);
    expect(body.commitSha).toBeNull();
  });

  it('404s only when the id is unknown everywhere', async () => {
    const { status, body } = await get('run_never_existed');
    expect(status).toBe(404);
    expect(body.error).toBe('Run not found');
  });

  it('distinguishes a run that changed nothing from one with no record', async () => {
    writeFileSync(
      path.join(outputs, 'run_empty.changes.json'),
      JSON.stringify({
        commitSha: SHA,
        capturedAt: '2026-08-14T11:00:00.000Z',
        stat: '',
        diff: '',
        status: '',
        truncated: false,
      }),
      'utf-8',
    );
    const empty = await get('run_empty');
    const missing = await get('run_old');
    // The whole contract in two lines: "" is a measurement, null is its absence.
    expect(empty.body.diff).toBe('');
    expect(missing.body.diff).toBeNull();
  });

  it('cannot be walked out of the outputs directory', async () => {
    const { status } = await get('../../../../etc/passwd');
    expect(status).toBe(404);
  });
});
