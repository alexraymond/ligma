/**
 * Stopping one run.
 *
 * Two things called "a run" show up on the Runs surface, and both have to be
 * stoppable or the button is a lie: rows in `active-runs.json` (spawned by the
 * task/project run routes) and the engine's own live sessions, which `GET
 * /api/runs` synthesizes as `daemon_<sessionId>` rows out of the health
 * registry's status file.
 *
 * The engine session path goes through `interruptSession`, which is `stopEngine`'s
 * per-session recipe — kill the tree, return the task to the board, close the
 * session. When the engine is in another process there is no registry to ask, so
 * the fallback is the pid the status file already published.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ActiveRun } from '@ligma/api';
import treeKill from 'tree-kill';
import { interruptSession } from '../../engine/lifecycle';
import { DATA_DIR } from '../../paths';
import { mutateActiveRuns, mutateTasks } from '../../store/data';

const DAEMON_SESSION_PREFIX = 'daemon_';
const STATUS_FILE = path.join(DATA_DIR, 'daemon-status.json');

/** SIGTERM the whole process tree. Resolves either way — a dead pid is done. */
export function killTree(pid: number): Promise<void> {
  if (pid <= 0) return Promise.resolve();
  return new Promise((resolve) => treeKill(pid, 'SIGTERM', () => resolve()));
}

function sessionPid(sessionId: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as {
      activeSessions?: Array<{ id?: string; pid?: number }>;
    };
    const session = parsed.activeSessions?.find((s) => s.id === sessionId);
    return typeof session?.pid === 'number' ? session.pid : null;
  } catch {
    return null;
  }
}

export interface StopOutcome {
  /** False when nothing by that id was running — a 404, not a silent success. */
  found: boolean;
  /**
   * True when the row exists but already carries a `completedAt` — a 409, not a
   * stop. Interrupting a finished run used to overwrite its `error` with
   * "Stopped by you" and bump `completedAt`, so a run that failed at the boot
   * gate ended up claiming a human stopped it and the only pointer to the real
   * cause was gone (process audit P8). Run history is evidence: once a run has
   * completed, nothing rewrites it.
   */
  alreadyFinished?: boolean;
  taskId: string | null;
}

/**
 * Stop the run `runId` names, whichever kind it is.
 *
 * `deferredUntil` turns the stop into a deferral: the run row reads `deferred`
 * (the calm state, §7) with a real resume time, and the task carries the time
 * the dispatcher will wait for. Without it the run reads as interrupted, which
 * the failure-class classifier renders as no card at all — a run the human
 * stopped is not a malfunction.
 */
export async function stopRun(runId: string, deferredUntil: string | null): Promise<StopOutcome> {
  const now = new Date().toISOString();
  const reason = deferredUntil ? 'Deferred by you' : 'Stopped by you';

  if (runId.startsWith(DAEMON_SESSION_PREFIX)) {
    const sessionId = runId.slice(DAEMON_SESSION_PREFIX.length);
    const taskId = await taskOfSession(sessionId);
    const handled = await interruptSession(sessionId, reason);
    if (!handled) {
      const pid = sessionPid(sessionId);
      if (pid === null) return { found: false, taskId: null };
      await killTree(pid);
    }
    if (deferredUntil && taskId) await deferTask(taskId, deferredUntil);
    return { found: true, taskId };
  }

  let finished = false;
  const run = await mutateActiveRuns(async (data): Promise<ActiveRun | null> => {
    const found = data.runs.find((r) => r.id === runId);
    if (!found) return null;
    // Finished is finished — see StopOutcome.alreadyFinished.
    if (found.completedAt) {
      finished = true;
      return null;
    }
    found.status = deferredUntil ? 'deferred' : 'failed';
    found.completedAt = now;
    found.error = reason;
    if (deferredUntil) found.resumesAt = deferredUntil;
    else found.interruptedAt = now;
    return found;
  });
  if (!run) return { found: false, alreadyFinished: finished, taskId: null };

  await killTree(run.pid);
  if (deferredUntil) await deferTask(run.taskId, deferredUntil);
  else await requeueTask(run.taskId);
  return { found: true, taskId: run.taskId };
}

async function taskOfSession(sessionId: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as {
      activeSessions?: Array<{ id?: string; taskId?: string | null }>;
    };
    return parsed.activeSessions?.find((s) => s.id === sessionId)?.taskId ?? null;
  } catch {
    return null;
  }
}

/** Back to the board, waiting until `until`. The dispatcher honours the field. */
async function deferTask(taskId: string | null, until: string): Promise<void> {
  if (!taskId) return;
  await mutateTasks(async (data) => {
    const task = data.tasks.find((t) => t.id === taskId);
    // A finished build is not re-queued by a deferral — same rule the shutdown
    // path uses: awaiting-verification means the builder is already done.
    if (!task || task.kanban === 'done' || task.kanban === 'awaiting-verification') return;
    task.kanban = 'not-started';
    task.deferredUntil = until;
    task.updatedAt = new Date().toISOString();
  });
}

/** Back to the board immediately — an interrupted task is unfinished work. */
async function requeueTask(taskId: string | null): Promise<void> {
  if (!taskId) return;
  await mutateTasks(async (data) => {
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task || task.kanban === 'done' || task.kanban === 'awaiting-verification') return;
    task.kanban = 'not-started';
    task.deferredUntil = null;
    task.updatedAt = new Date().toISOString();
  });
}
