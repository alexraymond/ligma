'use client';

import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import { useCollection, useInvalidate } from '@/providers/collections-provider';
import type { ActiveRun, DecisionItem } from '@ligma/api';
import { useCallback, useMemo, useRef, useState } from 'react';

const POLL_INTERVAL = 3000; // 3 seconds
export const RUNS_KEY = '/api/runs';
const TASKS_KEY = '/api/tasks';

const EMPTY_RUNS: readonly ActiveRun[] = [];

// Last known status per run id. Module-level, not per-mount: the run list is
// one shared collection now, so one fetch must produce one toast however many
// components are reading it (the rail's provider and the Runs page both are).
//
// Keyed on id *and* status, not just id (W6): `/api/runs` keeps a completed
// run's row under the same id it had while running, so a Set of "ids already
// seen" permanently muted every run the moment it was first observed —
// whatever status that happened to be. Tracking the last status per id lets a
// running → completed/failed transition still announce.
const lastStatusById = new Map<string, ActiveRun['status']>();
let seeded = false;

export function announce(runs: ActiveRun[]): void {
  if (!seeded) {
    // Seed with everything already there — existing failures are historical.
    seeded = true;
  } else {
    for (const run of runs) {
      if (lastStatusById.get(run.id) === run.status) continue; // no transition
      if (run.status === 'completed') showSuccess(`Task completed by ${run.agentId}`);
      else if (run.status === 'failed' || run.status === 'timeout') {
        showError(run.error ?? 'Task execution failed');
      }
    }
  }
  lastStatusById.clear();
  for (const run of runs) lastStatusById.set(run.id, run.status);
}

/**
 * `GET /api/runs`, shared. It used to be a raw 3s `setInterval` per mount with
 * no visibility gating — the one poller in the app that kept hitting the daemon
 * from a backgrounded tab forever, and twice over on the Runs page. Through the
 * collection store it is one request per tick, paused while hidden, backing off
 * while the daemon is unreachable.
 */
async function fetchRuns(): Promise<ActiveRun[]> {
  const res = await apiFetch(RUNS_KEY);
  if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
  const data = (await res.json()) as { runs?: ActiveRun[] };
  const runs = data.runs ?? [];
  announce(runs);
  return runs;
}

export function useActiveRuns() {
  const {
    data,
    error,
    refetch: fetchRunsNow,
  } = useCollection<ActiveRun[]>(RUNS_KEY, fetchRuns, POLL_INTERVAL);
  const runs = (data ?? EMPTY_RUNS) as ActiveRun[];
  const invalidate = useInvalidate();

  // Decision dialog state
  const [pendingDecision, setPendingDecision] = useState<DecisionItem | null>(null);
  const [showDecisionDialog, setShowDecisionDialog] = useState(false);
  const pendingTaskIdRef = useRef<string | null>(null);

  // Derived state
  const runningTaskIds = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.taskId)),
    [runs],
  );

  const runningProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of runs) {
      if (run.status === 'running' && run.projectId) {
        ids.add(run.projectId);
      }
    }
    return ids;
  }, [runs]);

  const isTaskRunning = useCallback(
    (taskId: string) => runningTaskIds.has(taskId),
    [runningTaskIds],
  );

  const isProjectRunning = useCallback(
    (projectId: string) => runningProjectIds.has(projectId),
    [runningProjectIds],
  );

  // Actions
  const runTask = useCallback(
    async (taskId: string) => {
      try {
        const res = await apiFetch(`/api/tasks/${taskId}/run`, {
          method: 'POST',
        });
        if (!res.ok) {
          const data = await res.json();

          // Intercept pending decision — open dialog instead of error toast.
          // The daemon's 409 only carries a count (`pendingDecisions`), not the
          // decision itself, so fetch the actual pending decision for this task
          // to populate the dialog.
          if (typeof data.pendingDecisions === 'number' && data.pendingDecisions > 0) {
            try {
              const decisionsRes = await apiFetch('/api/decisions?status=pending');
              if (decisionsRes.ok) {
                const decisionsData = (await decisionsRes.json()) as { decisions?: DecisionItem[] };
                const decision = (decisionsData.decisions ?? []).find((d) => d.taskId === taskId);
                if (decision) {
                  setPendingDecision(decision);
                  pendingTaskIdRef.current = taskId;
                  setShowDecisionDialog(true);
                  return;
                }
              }
            } catch {
              // fall through to the error toast below
            }
          }

          showError(data.error ?? 'Failed to start task');
          return;
        }
        showSuccess('Task execution started');
        // Starting a task changes the runs *and* the task's own state, so both
        // are invalidated — the Board used to wait out its next 15s tick.
        await invalidate(RUNS_KEY, TASKS_KEY);
      } catch {
        showError('Failed to start task');
      }
    },
    [invalidate],
  );

  // After a decision is answered, re-run the task
  const handleDecisionAnswered = useCallback(() => {
    setShowDecisionDialog(false);
    setPendingDecision(null);
    const taskToRun = pendingTaskIdRef.current;
    pendingTaskIdRef.current = null;
    if (taskToRun) {
      runTask(taskToRun);
    }
  }, [runTask]);

  const runProject = useCallback(
    async (projectId: string) => {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/run`, {
          method: 'POST',
        });
        if (!res.ok) {
          const data = await res.json();
          showError(data.error ?? 'Failed to start project');
          return;
        }
        const result = await res.json();
        const count = result.launched?.length ?? 0;
        if (count > 0) {
          showSuccess(`Started ${count} task${count !== 1 ? 's' : ''}`);
        } else {
          showError('No tasks were launched');
        }
        await invalidate(RUNS_KEY, TASKS_KEY);
      } catch {
        showError('Failed to start project tasks');
      }
    },
    [invalidate],
  );

  return {
    runs,
    /** A failed read is reported, not rendered as "no runs". */
    error,
    /** Re-read the run list now — after stopping or deferring one, say. */
    refetch: fetchRunsNow,
    runningTaskIds,
    runningProjectIds,
    isTaskRunning,
    isProjectRunning,
    runTask,
    runProject,
    // Decision dialog state
    pendingDecision,
    showDecisionDialog,
    setShowDecisionDialog,
    handleDecisionAnswered,
  };
}
