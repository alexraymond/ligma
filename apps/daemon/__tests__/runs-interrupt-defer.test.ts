/**
 * Per-run interrupt and defer (UX spec §6 Runs).
 *
 * Before these routes the only stop was daemon-wide. What matters here is what
 * the two leave behind: an interrupted run is marked as stopped *by a human*
 * (so the UI can decline to draw a malfunction card) and its task goes straight
 * back to the board; a deferred run is calm, carries a real resume time, and the
 * task carries the `deferredUntil` the dispatcher waits for.
 *
 * `pid: 0` throughout: there is no child process in a unit test, and `killTree`
 * short-circuits a non-positive pid rather than shelling out.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActiveRun, Task } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previous: string | undefined;

const task = (over: Partial<Task> = {}): Task => ({
  id: 'task_1',
  title: 'Shorten a URL',
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'in-progress',
  verificationStatus: 'unverified',
  projectId: 'proj_a',
  milestoneId: null,
  assignedTo: 'developer',
  collaborators: [],
  dailyActions: [],
  subtasks: [],
  blockedBy: [],
  estimatedMinutes: null,
  actualMinutes: null,
  acceptanceCriteria: [],
  comments: [],
  tags: [],
  notes: '',
  dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  deletedAt: null,
  ...over,
});

const run = (over: Partial<ActiveRun> = {}): ActiveRun => ({
  id: 'run_1',
  taskId: 'task_1',
  agentId: 'developer',
  projectId: 'proj_a',
  pid: 0,
  status: 'running',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  exitCode: null,
  error: null,
  ...over,
});

function seed(runs: ActiveRun[], tasks: Task[]): void {
  writeFileSync(path.join(dataDir, 'active-runs.json'), JSON.stringify({ runs }), 'utf-8');
  writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks }), 'utf-8');
}

const readRuns = (): ActiveRun[] =>
  (
    JSON.parse(readFileSync(path.join(dataDir, 'active-runs.json'), 'utf-8')) as {
      runs: ActiveRun[];
    }
  ).runs;
const readTasks = (): Task[] =>
  (JSON.parse(readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8')) as { tasks: Task[] }).tasks;

beforeEach(() => {
  previous = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-runs-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  seed([run()], [task()]);
  vi.resetModules();
});

afterEach(() => {
  if (previous === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previous;
  rmSync(dataDir, { recursive: true, force: true });
});

const interrupt = () => import('../src/routes/runs/_id/interrupt/route');
const defer = () => import('../src/routes/runs/_id/defer/route');

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

describe('interrupt', () => {
  it('stops the run and says a human did it, rather than leaving it to look like a crash', async () => {
    const { POST } = await interrupt();
    const res = await POST(post('http://localhost/api/runs/run_1/interrupt'), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(res.status).toBe(200);

    const stopped = readRuns()[0];
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toBe('Stopped by you');
    // The structured field the failure classifier reads to draw no card at all.
    expect(stopped.interruptedAt).toBeTruthy();
    expect(stopped.completedAt).toBeTruthy();
  });

  it('returns the unfinished task to the board', async () => {
    const { POST } = await interrupt();
    await POST(post('http://localhost/api/runs/run_1/interrupt'), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(readTasks()[0].kanban).toBe('not-started');
    expect(readTasks()[0].deferredUntil).toBeNull();
  });

  it('never re-queues a build that already finished', async () => {
    seed([run()], [task({ kanban: 'awaiting-verification' })]);
    const { POST } = await interrupt();
    await POST(post('http://localhost/api/runs/run_1/interrupt'), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(readTasks()[0].kanban).toBe('awaiting-verification');
  });

  it('404s on a run id nothing knows about — a silent success would be a lie', async () => {
    const { POST } = await interrupt();
    const res = await POST(post('http://localhost/api/runs/nope/interrupt'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('defer', () => {
  it('is the calm state: the run reads deferred and carries a real resume time', async () => {
    const { POST } = await defer();
    const res = await POST(post('http://localhost/api/runs/run_1/defer', { minutes: 30 }), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(res.status).toBe(200);

    const deferred = readRuns()[0];
    expect(deferred.status).toBe('deferred');
    expect(deferred.resumesAt).toBeTruthy();
    // Not an interruption: a deferral is normal operation, not a stop.
    expect(deferred.interruptedAt).toBeUndefined();

    const resumesAt = new Date(deferred.resumesAt as string).getTime();
    expect(resumesAt).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(resumesAt).toBeLessThan(Date.now() + 35 * 60_000);
  });

  it('gives the task the deferredUntil the dispatcher waits for', async () => {
    const { POST } = await defer();
    await POST(post('http://localhost/api/runs/run_1/defer', { minutes: 5 }), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    const deferredTask = readTasks()[0];
    expect(deferredTask.kanban).toBe('not-started');
    expect(new Date(deferredTask.deferredUntil as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('takes an empty body as the default wait — it is a one-button action', async () => {
    const { POST } = await defer();
    const res = await POST(post('http://localhost/api/runs/run_1/defer'), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(res.status).toBe(200);
    expect(readRuns()[0].status).toBe('deferred');
  });

  it("refuses a wait longer than the engine's own retry ceiling", async () => {
    const { POST } = await defer();
    const res = await POST(post('http://localhost/api/runs/run_1/defer', { minutes: 999 }), {
      params: Promise.resolve({ id: 'run_1' }),
    });
    expect(res.status).toBe(400);
    expect(readRuns()[0].status).toBe('running');
  });
});
