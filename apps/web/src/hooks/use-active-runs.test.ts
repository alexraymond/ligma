import type { ActiveRun } from '@ligma/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('@/lib/toast', () => ({
  showSuccess: (...args: unknown[]) => showSuccess(...args),
  showError: (...args: unknown[]) => showError(...args),
}));

function run(overrides: Partial<ActiveRun>): ActiveRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    agentId: 'developer',
    projectId: null,
    pid: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    error: null,
    ...overrides,
  };
}

// W6: `/api/runs` keeps a completed run's row under the same id it had while
// running — a Set of "ids already announced" permanently muted every run the
// moment it was first observed, whatever status that was.
describe('announce (use-active-runs)', () => {
  beforeEach(() => {
    vi.resetModules();
    showSuccess.mockClear();
    showError.mockClear();
  });

  it('does not announce the first poll — existing state is historical', async () => {
    const { announce } = await import('./use-active-runs');
    announce([run({ status: 'completed' })]);
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('announces a running -> completed transition on a later poll', async () => {
    const { announce } = await import('./use-active-runs');
    announce([run({ status: 'running' })]);
    announce([run({ status: 'completed' })]);
    expect(showSuccess).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalled();
  });

  it('announces a running -> failed transition', async () => {
    const { announce } = await import('./use-active-runs');
    announce([run({ status: 'running' })]);
    announce([run({ status: 'failed', error: 'boom' })]);
    expect(showError).toHaveBeenCalledWith('boom');
  });

  it('does not re-announce a run that stays completed across polls', async () => {
    const { announce } = await import('./use-active-runs');
    announce([run({ status: 'running' })]);
    announce([run({ status: 'completed' })]);
    announce([run({ status: 'completed' })]);
    expect(showSuccess).toHaveBeenCalledTimes(1);
  });
});
