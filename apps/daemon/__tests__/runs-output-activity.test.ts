import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActiveRun } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '../src/routes/runs/route';
import { mutateActiveRuns } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

// D7 parity MC-110: the badge measured elapsed-since-startedAt as a stand-in
// for output silence, so a run streaming constantly still read "running
// (quiet)". The run's own append-only output file carries the real signal.

let backups: Record<string, string>;
let scratch: string;

beforeAll(async () => {
  backups = await backupDataFiles();
  scratch = await mkdtemp(path.join(tmpdir(), 'ligma-run-output-'));
});

afterAll(async () => {
  await restoreDataFiles(backups);
  await rm(scratch, { recursive: true, force: true });
});

async function runsFor(id: string): Promise<ActiveRun | undefined> {
  const res = await GET();
  const body = (await res.json()) as { runs: ActiveRun[] };
  return body.runs.find((r) => r.id === id);
}

async function seedRun(id: string, overrides: Partial<ActiveRun>) {
  await mutateActiveRuns(async (data) => {
    data.runs = data.runs.filter((r) => r.id !== id);
    data.runs.push({
      id,
      taskId: `task_${id}`,
      agentId: 'developer',
      projectId: null,
      // Our own pid: alive, so the route's dead-PID sweep leaves the row alone.
      pid: process.pid,
      status: 'running',
      startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      completedAt: null,
      exitCode: null,
      error: null,
      ...overrides,
    } as ActiveRun);
  });
}

describe('GET /api/runs — output-activity signal', () => {
  it("reports the output file's mtime, not the run's age", async () => {
    const id = `run_activity_${Date.now()}`;
    const file = path.join(scratch, `${id}.jsonl`);
    await writeFile(file, '{"ts":"now","stream":"stdout","text":"hi"}\n');
    const wroteAt = new Date(Date.now() - 30_000);
    await utimes(file, wroteAt, wroteAt);

    await seedRun(id, { outputFile: file });

    const run = await runsFor(id);
    expect(run?.lastOutputAt).toBeDefined();
    // The run started an hour ago; it spoke 30s ago. The badge must see 30s.
    const quietMs = Date.now() - new Date(run!.lastOutputAt as string).getTime();
    expect(quietMs).toBeLessThan(5 * 60_000);
    expect(Date.now() - new Date(run!.startedAt).getTime()).toBeGreaterThan(50 * 60_000);
  });

  it('omits the field when the run has written nothing yet', async () => {
    const id = `run_silent_${Date.now()}`;
    await seedRun(id, { outputFile: path.join(scratch, 'never-written.jsonl') });

    const run = await runsFor(id);
    expect(run?.lastOutputAt).toBeUndefined();
  });

  it('never stamps it on a finished run', async () => {
    const id = `run_done_${Date.now()}`;
    const file = path.join(scratch, `${id}.jsonl`);
    await writeFile(file, '{}\n');
    await seedRun(id, {
      outputFile: file,
      status: 'completed',
      completedAt: new Date().toISOString(),
      exitCode: 0,
    });

    const run = await runsFor(id);
    expect(run?.status).toBe('completed');
    expect(run?.lastOutputAt).toBeUndefined();
  });
});
