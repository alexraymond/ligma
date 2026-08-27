import { getRunDisplayState, quietMinutes } from '@/components/run-status-badge';
import type { ActiveRun } from '@ligma/api';
/**
 * D7 MC-110. The quiet badge used to measure the run's age; a build that had
 * been streaming for an hour read "running (quiet)". It measures silence now —
 * `lastOutputAt`, stamped by GET /api/runs from the output file's mtime.
 */
import { describe, expect, it } from 'vitest';

const HOUR_AGO = new Date(Date.now() - 60 * 60_000).toISOString();

function run(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    agentId: 'developer',
    projectId: null,
    pid: 1234,
    status: 'running',
    startedAt: HOUR_AGO,
    completedAt: null,
    exitCode: null,
    error: null,
    ...overrides,
  } as ActiveRun;
}

describe('getRunDisplayState', () => {
  it('calls an hour-old run that just spoke plainly running', () => {
    const r = run({ lastOutputAt: new Date(Date.now() - 30_000).toISOString() });
    expect(quietMinutes(r)).toBeLessThan(1);
    expect(getRunDisplayState(r)).toBe('running');
  });

  it('calls a run that has been silent for ten minutes quiet', () => {
    const r = run({ lastOutputAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(getRunDisplayState(r)).toBe('working-silently');
  });

  it('calls a run silent past the stall threshold possibly-stalled', () => {
    const r = run({ lastOutputAt: new Date(Date.now() - 45 * 60_000).toISOString() });
    expect(getRunDisplayState(r)).toBe('possibly-stalled');
  });

  it("falls back to the run's age when nothing has been written yet", () => {
    expect(getRunDisplayState(run())).toBe('possibly-stalled');
    expect(getRunDisplayState(run({ startedAt: new Date().toISOString() }))).toBe('running');
  });

  it('passes non-running statuses straight through', () => {
    expect(getRunDisplayState(run({ status: 'completed' }))).toBe('completed');
    expect(getRunDisplayState(run({ status: 'deferred' }))).toBe('deferred');
  });
});
