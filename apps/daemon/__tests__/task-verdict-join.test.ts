/**
 * What the board and the portfolio read.
 *
 * `GET /api/tasks` joins each task to its latest verification run, and
 * `GET /api/dashboard` joins each project to its health, both server-side. The
 * point of both joins is the same: a card cannot open a run directory, so a
 * surface that has to show verification state either gets it on the wire or
 * does without — and doing without is how the board ended up as the one place
 * the product's status vocabulary was missing.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Task } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDeferred } from '../src/engine/dispatcher';

let dataDir: string;
let previous: string | undefined;

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: over.id,
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'done',
  verificationStatus: 'unverified',
  projectId: 'proj_a',
  milestoneId: null,
  assignedTo: null,
  collaborators: [],
  dailyActions: [],
  subtasks: [],
  blockedBy: [],
  estimatedMinutes: null,
  actualMinutes: null,
  acceptanceCriteria: ['it works'],
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

function writeRun(id: string, taskId: string, finishedAt: string, mtimeSeconds: number): void {
  const dir = path.join(dataDir, 'verification-runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, taskId, finishedAt }), 'utf-8');
  utimesSync(dir, mtimeSeconds, mtimeSeconds);
}

function seed(tasks: Task[]): void {
  writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks }), 'utf-8');
}

beforeEach(() => {
  previous = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-join-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  seed([task({ id: 'task_1' })]);
  vi.resetModules();
});

afterEach(() => {
  if (previous === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previous;
  rmSync(dataDir, { recursive: true, force: true });
});

async function listTasks(): Promise<
  Array<Task & { lastVerificationRunId: string | null; lastVerifiedAt: string | null }>
> {
  const { GET } = await import('../src/routes/tasks/route');
  const res = await GET(new Request('http://localhost/api/tasks'));
  return (
    (await res.json()) as {
      tasks: Array<Task & { lastVerificationRunId: string | null; lastVerifiedAt: string | null }>;
    }
  ).tasks;
}

describe("the tasks list carries each task's latest verdict", () => {
  it('names the run and when it finished, so a card can link its verdict', async () => {
    writeRun('vrun_1', 'task_1', '2026-02-01T00:00:00.000Z', 1_000);
    const [row] = await listTasks();
    expect(row.lastVerificationRunId).toBe('vrun_1');
    expect(row.lastVerifiedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('prefers the newest run when a task has been verified more than once', async () => {
    writeRun('vrun_old', 'task_1', '2026-01-01T00:00:00.000Z', 1_000);
    writeRun('vrun_new', 'task_1', '2026-03-01T00:00:00.000Z', 2_000);
    expect((await listTasks())[0].lastVerificationRunId).toBe('vrun_new');
  });

  it('is null for a task nothing has verified — never a link to nowhere', async () => {
    const [row] = await listTasks();
    expect(row.lastVerificationRunId).toBeNull();
    expect(row.lastVerifiedAt).toBeNull();
  });
});

describe('the dashboard carries per-project health', () => {
  it('reports verified-over-verifiable per project, with the newest verdict behind it', async () => {
    seed([
      task({ id: 'task_1', verificationStatus: 'passed' }),
      task({ id: 'task_2', verificationStatus: 'failed' }),
      task({ id: 'task_3', projectId: 'proj_b', verificationStatus: 'passed' }),
    ]);
    writeRun('vrun_1', 'task_1', '2026-02-01T00:00:00.000Z', 1_000);
    seedDashboardStores();

    const { GET } = await import('../src/routes/dashboard/route');
    const body = (await (await GET()).json()) as {
      projectHealth: Array<{ projectId: string; percent: number; lastVerifiedAt: string | null }>;
    };
    const a = body.projectHealth.find((h) => h.projectId === 'proj_a');
    expect(a?.percent).toBe(50);
    expect(a?.lastVerifiedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(body.projectHealth.find((h) => h.projectId === 'proj_b')?.percent).toBe(100);
  });
});

const project = (id: string) => ({
  id,
  name: id,
  description: '',
  status: 'active',
  color: '#fff',
  teamMembers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  deletedAt: null,
});

/** The dashboard reads seven stores; only projects and tasks matter here. */
function seedDashboardStores(): void {
  const stores: Record<string, unknown> = {
    'projects.json': { projects: [project('proj_a'), project('proj_b')] },
    'goals.json': { goals: [] },
    'brain-dump.json': { entries: [] },
    'inbox.json': { messages: [] },
    'decisions.json': { decisions: [] },
    'activity-log.json': { events: [] },
  };
  for (const [file, body] of Object.entries(stores)) {
    writeFileSync(path.join(dataDir, file), JSON.stringify(body), 'utf-8');
  }
}

describe('a human deferral is a wait the dispatcher honours', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');

  it('skips a task whose deferral has not passed', () => {
    expect(isDeferred({ deferredUntil: '2026-06-01T13:00:00.000Z' }, now)).toBe(true);
  });

  it('picks it up again once the time passes — the field is a wait, not a state', () => {
    expect(isDeferred({ deferredUntil: '2026-06-01T11:00:00.000Z' }, now)).toBe(false);
  });

  it('never strands a task on a missing or unreadable value', () => {
    expect(isDeferred({}, now)).toBe(false);
    expect(isDeferred({ deferredUntil: null }, now)).toBe(false);
    expect(isDeferred({ deferredUntil: 'soon' }, now)).toBe(false);
  });
});
