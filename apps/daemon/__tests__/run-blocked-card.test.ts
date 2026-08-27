import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActiveRun, Task } from '@ligma/api';
/**
 * P13 — a build that never got off the ground now reaches the Deck.
 *
 * A failed boot gate (`causeKind: "env"`) or a crashed backend
 * (`causeKind: "backend"`) used to produce one unread inbox report and an empty
 * Deck: the surface that answers "what needs me?" had nothing to say about the
 * task that had just stopped dead.
 *
 * The card is informational — no options, no answer route — so what has to be
 * pinned is when it appears and, more importantly, when it does NOT: a newer
 * run for the same task, a settled task, a self-resolving cause, a human
 * interrupt. The shape is the contract the web renders against.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-run-blocked-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { blockedRuns } = await import('../src/routes/deck/route');
const { buildDeckCards } = await import('../src/routes/deck/deck-cards');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    title: 'Ship the landing page',
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    verificationStatus: 'unverified',
    projectId: 'proj_1',
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: [],
    comments: [],
    tags: [],
    notes: '',
    dueDate: null,
    deletedAt: null,
    ...over,
  } as Task;
}

function run(over: Partial<ActiveRun> = {}): ActiveRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    agentId: 'developer',
    projectId: 'proj_1',
    pid: 0,
    status: 'failed',
    startedAt: '2026-08-27T09:00:00.000Z',
    completedAt: '2026-08-27T09:01:00.000Z',
    exitCode: 1,
    error: 'No .ligma/boot.json in the product repo',
    causeKind: 'env',
    ...over,
  } as ActiveRun;
}

const EMPTY = { decisions: [], designs: [], staleBriefs: [], adoptionRuns: [], spotChecks: [] };

describe('blockedRuns', () => {
  it('raises a failed env run on a task still waiting to be built', () => {
    const [blocked] = blockedRuns([run()], [task()]);

    expect(blocked).toMatchObject({
      runId: 'run_1',
      taskId: 'task_1',
      taskTitle: 'Ship the landing page',
      causeKind: 'env',
      reason: 'No .ligma/boot.json in the product repo',
      projectId: 'proj_1',
      blockedAt: '2026-08-27T09:01:00.000Z',
    });
  });

  it('raises a crashed backend run too', () => {
    expect(
      blockedRuns([run({ causeKind: 'backend', error: 'Exit code: 127' })], [task()]),
    ).toHaveLength(1);
  });

  it('stays quiet for causes that resolve themselves', () => {
    for (const causeKind of ['rate-limit', 'auth', 'parse', 'harness'] as const) {
      expect(blockedRuns([run({ causeKind })], [task()])).toEqual([]);
    }
    expect(blockedRuns([run({ status: 'deferred', causeKind: undefined })], [task()])).toEqual([]);
    expect(blockedRuns([run({ status: 'running', causeKind: undefined })], [task()])).toEqual([]);
  });

  it('stays quiet when the human stopped the run themselves', () => {
    expect(blockedRuns([run({ interruptedAt: '2026-08-27T09:00:30.000Z' })], [task()])).toEqual([]);
  });

  it('disappears once a NEWER run exists for the same task', () => {
    const newer = run({
      id: 'run_2',
      status: 'running',
      startedAt: '2026-08-27T10:00:00.000Z',
      causeKind: undefined,
    });
    expect(blockedRuns([run(), newer], [task()])).toEqual([]);
  });

  it('disappears once the task settles', () => {
    for (const kanban of ['done', 'awaiting-verification'] as const) {
      expect(blockedRuns([run()], [task({ kanban })])).toEqual([]);
    }
  });

  it('drops a run whose task no longer exists', () => {
    expect(blockedRuns([run()], [])).toEqual([]);
    expect(blockedRuns([run()], [task({ deletedAt: '2026-08-27T09:05:00.000Z' })])).toEqual([]);
  });

  it('names one card per task — the newest failure, not every dead retry', () => {
    const older = run({ id: 'run_0', startedAt: '2026-08-27T08:00:00.000Z' });
    const cards = blockedRuns([older, run()], [task()]);
    expect(cards.map((c) => c.runId)).toEqual(['run_1']);
  });
});

describe('the run-blocked card', () => {
  const [blocked] = blockedRuns([run()], [task()]);

  it('carries the shape the web renders against', () => {
    const [card] = buildDeckCards({ ...EMPTY, runsBlocked: [blocked] });

    expect(card).toMatchObject({
      kind: 'run-blocked',
      id: 'runblocked:run_1',
      taskId: 'task_1',
      taskTitle: 'Ship the landing page',
      causeKind: 'env',
      reason: 'No .ligma/boot.json in the product repo',
      projectId: 'proj_1',
      createdAt: '2026-08-27T09:01:00.000Z',
    });
    expect(card.href).toContain('run_1');
  });

  it('offers nothing to answer — it is a statement, not a question', () => {
    const [card] = buildDeckCards({ ...EMPTY, runsBlocked: [blocked] });
    expect(card.options).toEqual([]);
    expect(card.decision).toBeNull();
    expect(card.opensSheet).toBe(false);
  });

  it('sorts last, behind every card that actually asks something', () => {
    const cards = buildDeckCards({
      ...EMPTY,
      staleBriefs: [
        {
          projectId: 'proj_1',
          projectName: 'Project',
          prompt: 'A landing page.',
          staleFlaggedAt: '2026-08-27T09:00:00.000Z',
        },
      ],
      runsBlocked: [blocked],
    });

    expect(cards.map((c) => c.kind)).toEqual(['stale-brief', 'run-blocked']);
  });

  it('composes nothing when no run is blocked', () => {
    expect(buildDeckCards({ ...EMPTY })).toEqual([]);
    expect(buildDeckCards({ ...EMPTY, runsBlocked: [] })).toEqual([]);
  });
});
