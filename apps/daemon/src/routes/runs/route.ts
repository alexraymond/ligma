import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ActiveRun, AdoptionStatus, RunStatus } from '@ligma/api';
import { listAdoptionRuns } from '../../engine/adopt-repo';
import { NextResponse } from '../../http';
import { DATA_DIR } from '../../paths';
import { getActiveRuns, getTasks, mutateActiveRuns } from '../../store/data';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── GET: Read active runs with PID liveness check ──────────────────────────

export async function GET() {
  const data = await getActiveRuns();
  const tasksData = await getTasks();
  const taskProjectById = new Map(tasksData.tasks.map((task) => [task.id, task.projectId ?? null]));

  // PID liveness check: find dead "running" processes
  const hasDeadProcesses = data.runs.some(
    (run) => run.status === 'running' && run.pid > 0 && !isProcessAlive(run.pid),
  );

  // Only acquire the write mutex if we actually need to update
  if (hasDeadProcesses) {
    const updated = await mutateActiveRuns(async (mutableData) => {
      for (const run of mutableData.runs) {
        if (run.status === 'running' && run.pid > 0 && !isProcessAlive(run.pid)) {
          run.status = 'failed';
          run.error = 'Process terminated unexpectedly';
          run.completedAt = new Date().toISOString();
        }
      }
      return mutableData;
    });
    return NextResponse.json({
      runs: mergeDaemonSessions(updated.runs, taskProjectById),
    });
  }

  return NextResponse.json({
    runs: mergeDaemonSessions(data.runs, taskProjectById),
  });
}

const OUTPUT_DIR = path.join(DATA_DIR, 'run-outputs');

/**
 * When this run last actually said something.
 *
 * "Stalled" means silent, not old (D7 MC-110) — the badge used elapsed-since-
 * `startedAt` as a proxy, so a run streaming output for an hour still read
 * "running (quiet)". The run's append-only JSONL is the silence signal the
 * proxy stood in for, and its mtime is one `stat` per running row per poll.
 * Absent (missing/unwritable file) the badge falls back to the old proxy.
 */
function lastOutputAt(run: ActiveRun): string | undefined {
  if (run.status !== 'running') return undefined;
  const safeId = run.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = run.outputFile ?? path.join(OUTPUT_DIR, `${safeId}.jsonl`);
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function withOutputActivity(runs: ActiveRun[]): ActiveRun[] {
  return runs.map((run) => {
    const at = lastOutputAt(run);
    return at ? { ...run, lastOutputAt: at } : run;
  });
}

/** How many adoption runs the listing carries. Newest first, like the rest. */
const ADOPTION_LIMIT = 20;

const ADOPTION_RUN_STATUS: Record<AdoptionStatus, RunStatus> = {
  running: 'running',
  // Awaiting a human is finished work, not a failure: the run did its job and
  // the review sheet is the next move. `applied` is the same run, answered.
  'awaiting-review': 'completed',
  applied: 'completed',
  error: 'failed',
};

/**
 * Adoption runs, as runs (UX spec F2).
 *
 * They were watchable only at their own URL, so a repo that failed to adopt
 * left no trace on the surface the human goes to when something is running.
 * They live in their own store rather than `active-runs.json`, so they are
 * mapped here — additively, behind `kind`, and never stoppable via this route.
 */
function adoptionRows(): ActiveRun[] {
  return listAdoptionRuns()
    .slice(0, ADOPTION_LIMIT)
    .map((run) => ({
      id: run.id,
      taskId: '',
      agentId: 'adopt',
      projectId: run.projectId,
      pid: 0,
      status: ADOPTION_RUN_STATUS[run.status],
      startedAt: run.startedAt,
      completedAt: run.finishedAt,
      exitCode: null,
      error: run.error,
      kind: 'adoption' as const,
      repoPath: run.repoPath,
    }));
}

function mergeDaemonSessions(
  runs: ActiveRun[],
  taskProjectById: Map<string, string | null>,
): ActiveRun[] {
  const merged = [...runs];
  const runningTaskIds = new Set(
    merged.filter((run) => run.status === 'running').map((run) => run.taskId),
  );
  for (const run of readDaemonSessionRuns(taskProjectById)) {
    if (runningTaskIds.has(run.taskId)) continue;
    merged.unshift(run);
  }
  return withOutputActivity([...adoptionRows(), ...merged]);
}

function readDaemonSessionRuns(taskProjectById: Map<string, string | null>): ActiveRun[] {
  try {
    const file = path.join(DATA_DIR, 'daemon-status.json');
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as {
      activeSessions?: Array<{
        id?: string;
        taskId?: string | null;
        agentId?: string;
        pid?: number;
        startedAt?: string;
        status?: string;
      }>;
    };

    const sessions = parsed.activeSessions ?? [];
    return sessions
      .filter((session) => session.status === 'running' && typeof session.taskId === 'string')
      .map(
        (session): ActiveRun => ({
          id: `daemon_${session.id ?? `${session.taskId}_${session.startedAt ?? Date.now()}`}`,
          taskId: session.taskId as string,
          agentId: session.agentId ?? 'unknown',
          projectId: taskProjectById.get(session.taskId as string) ?? null,
          pid: typeof session.pid === 'number' ? session.pid : 0,
          status: 'running',
          startedAt: session.startedAt ?? new Date().toISOString(),
          completedAt: null,
          exitCode: null,
          error: null,
        }),
      );
  } catch {
    return [];
  }
}
