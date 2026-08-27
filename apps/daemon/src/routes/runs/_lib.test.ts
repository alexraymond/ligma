/**
 * Finished runs are evidence, not drafts (process audit P8).
 *
 * Interrupting an already-failed run returned 200 and rewrote history: the
 * run's real error ("No .ligma/boot.json…") became "Stopped by you" with a
 * fresh `completedAt`, so the only pointer to the boot-gate problem was gone
 * and the row claimed a human had stopped it.
 */

import type { ActiveRun } from '@ligma/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let runs: ActiveRun[] = [];
const killed = vi.fn();

vi.mock('tree-kill', () => ({
  default: (_pid: number, _sig: string, cb: () => void) => {
    killed();
    cb();
  },
}));
vi.mock('../../store/data', () => ({
  mutateActiveRuns: async (fn: (d: { runs: ActiveRun[] }) => Promise<unknown>) => fn({ runs }),
  mutateTasks: async (fn: (d: { tasks: unknown[] }) => Promise<unknown>) => fn({ tasks: [] }),
}));
vi.mock('../../engine/lifecycle', () => ({ interruptSession: async () => false }));

function run(over: Partial<ActiveRun>): ActiveRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    agentId: 'builder',
    projectId: null,
    pid: 0,
    status: 'running',
    startedAt: '2026-08-27T00:00:00.000Z',
    completedAt: null,
    exitCode: null,
    error: null,
    ...over,
  } as ActiveRun;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stopRun', () => {
  it('refuses a run that already completed, and leaves its row untouched', async () => {
    const finished = run({
      status: 'failed',
      completedAt: '2026-08-27T01:00:00.000Z',
      error: 'No .ligma/boot.json in the product repo',
    });
    runs = [finished];
    const { stopRun } = await import('./_lib');

    const outcome = await stopRun('run_1', null);

    expect(outcome).toEqual({ found: false, alreadyFinished: true, taskId: null });
    // The diagnostic evidence survives.
    expect(finished.error).toBe('No .ligma/boot.json in the product repo');
    expect(finished.completedAt).toBe('2026-08-27T01:00:00.000Z');
    expect(finished.status).toBe('failed');
    expect(killed).not.toHaveBeenCalled();
  });

  it('refuses a deferral of a finished run too', async () => {
    runs = [run({ status: 'completed', completedAt: '2026-08-27T01:00:00.000Z' })];
    const { stopRun } = await import('./_lib');

    expect(await stopRun('run_1', '2026-08-27T02:00:00.000Z')).toMatchObject({
      found: false,
      alreadyFinished: true,
    });
  });

  it('still stops a live run', async () => {
    const live = run({});
    runs = [live];
    const { stopRun } = await import('./_lib');

    expect(await stopRun('run_1', null)).toEqual({ found: true, taskId: 'task_1' });
    expect(live.status).toBe('failed');
    expect(live.error).toBe('Stopped by you');
    expect(live.completedAt).toEqual(expect.any(String));
  });

  it('still 404s an id that names nothing', async () => {
    runs = [];
    const { stopRun } = await import('./_lib');

    expect(await stopRun('run_nope', null)).toEqual({
      found: false,
      alreadyFinished: false,
      taskId: null,
    });
  });
});
