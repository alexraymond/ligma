/**
 * `aftermathSummary` — the "Stop everything now" aftermath panel's copy,
 * pinned so it never claims more than `stopEngine()` (apps/daemon/src/engine/
 * lifecycle.ts) actually does: every ended session's task is *attempted*
 * back to not-started, with the same done/awaiting-verification exception
 * lifecycle.ts applies — a session snapshot can't know a task's kanban state,
 * so the copy hedges rather than asserting a guaranteed reset.
 */
import { describe, expect, it } from 'vitest';
import { aftermathSummary } from './aftermath';

describe('aftermathSummary', () => {
  it('counts and carries through every session in the snapshot', () => {
    const summary = aftermathSummary([
      { id: 'sess_1', agentId: 'agent_a', taskId: 'task_1' },
      { id: 'sess_2', agentId: 'agent_b', taskId: null },
    ]);
    expect(summary.endedCount).toBe(2);
    expect(summary.sessions).toEqual([
      { id: 'sess_1', agentId: 'agent_a', taskId: 'task_1' },
      { id: 'sess_2', agentId: 'agent_b', taskId: null },
    ]);
  });

  it('hedges the task note rather than asserting a guaranteed reset', () => {
    const summary = aftermathSummary([{ id: 'sess_1', agentId: 'agent_a', taskId: 'task_1' }]);
    expect(summary.taskNote).toMatch(/not started/i);
    expect(summary.taskNote).toMatch(/unless/i);
  });

  it('says plainly when no session had a task to reset', () => {
    const summary = aftermathSummary([{ id: 'sess_1', agentId: 'agent_a', taskId: null }]);
    expect(summary.taskNote).not.toMatch(/not started/i);
  });

  it('handles an empty snapshot (nothing was running)', () => {
    const summary = aftermathSummary([]);
    expect(summary.endedCount).toBe(0);
    expect(summary.sessions).toEqual([]);
  });

  it('always links the three rollback routes', () => {
    const summary = aftermathSummary([]);
    const hrefs = summary.recoveryLinks.map((l) => l.href);
    expect(hrefs).toEqual(['/runs', '/activity', '/settings/checkpoints']);
  });
});
