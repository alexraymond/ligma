/**
 * checkpoints.ts — durable progress markers, so a dead session costs an attempt
 * rather than the work.
 *
 * When a session dies mid-task, `reconcileStaleInProgressTasks` resets the task
 * to `not-started` and the re-attempt starts cold. That reset is correct — there
 * is nothing trustworthy about a half-finished in-memory session — but it is
 * only cheap if the next attempt can find out what already landed on disk. That
 * is what a checkpoint is: one line saying "this phase is durable, here is what
 * it wrote".
 *
 * The daemon is NOT the writer. Agents append to `data/task-checkpoints.json`
 * themselves, straight from the prompt protocol, exactly as they do for
 * `decisions.json` — so there is no append API here, only the read the prompt
 * builder needs and the prune the dispatcher sweeps with.
 *
 * Reads are fail-soft in both directions: a missing file is a task with no
 * prior progress, and a corrupt one (an agent writing JSON by hand WILL
 * occasionally mangle it) is the same thing. A checkpoint store must never be
 * the reason a task cannot be dispatched.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withFileLock } from './file-lock';
import { logger } from './logger';

import { DATA_DIR } from '../paths';
const LOCK_NAME = 'task-checkpoints';
const CHECKPOINTS_FILE = path.join(DATA_DIR, 'task-checkpoints.json');

/** One durable phase an agent finished, as the agent described it. */
export interface TaskCheckpoint {
  taskId: string;
  agentId: string;
  /** Short name for what is now durable ("schema", "migration written"). */
  phase: string;
  /** What the next attempt should know. Agent-authored — untrusted text. */
  note: string;
  /** Paths written or commit shas. The next attempt must verify these exist. */
  artifacts?: string[];
  createdAt: string;
}

export interface CheckpointStore {
  checkpoints: TaskCheckpoint[];
}

/** Where the store lives — exported so tests and tooling need not re-derive it. */
export function checkpointsFilePath(): string {
  return CHECKPOINTS_FILE;
}

/**
 * A hand-written entry missing its taskId cannot be routed to a task, and one
 * missing its phase has nothing to tell the next attempt. Both are dropped
 * rather than rendered into a prompt as `undefined`.
 */
function isCheckpoint(value: unknown): value is TaskCheckpoint {
  const c = value as Partial<TaskCheckpoint> | null;
  return (
    !!c && typeof c === 'object' && typeof c.taskId === 'string' && typeof c.phase === 'string'
  );
}

/** Tolerant read: a missing or corrupt store is an empty one, never a throw. */
function readAll(): TaskCheckpoint[] {
  try {
    if (!existsSync(CHECKPOINTS_FILE)) return [];
    const parsed = JSON.parse(readFileSync(CHECKPOINTS_FILE, 'utf-8')) as Partial<CheckpointStore>;
    if (!Array.isArray(parsed.checkpoints)) return [];
    return parsed.checkpoints.filter(isCheckpoint);
  } catch {
    logger.warn('checkpoints', 'task-checkpoints.json unreadable — the next attempt starts cold');
    return [];
  }
}

function writeAtomic(checkpoints: TaskCheckpoint[]): void {
  const tmp = `${CHECKPOINTS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ checkpoints }, null, 2), 'utf-8');
  renameSync(tmp, CHECKPOINTS_FILE);
}

/** The durable phases a previous attempt at this task recorded, in write order. */
export function readCheckpointsForTask(taskId: string): TaskCheckpoint[] {
  return readAll().filter((c) => c.taskId === taskId);
}

/**
 * Forget the checkpoints of tasks that have nothing left to resume. One lock for
 * the whole batch — a per-task prune would take the mutex once per done task on
 * every poll cycle to usually delete nothing.
 *
 * Returns how many entries were dropped.
 */
export function pruneCheckpointsForTasks(taskIds: string[]): number {
  if (taskIds.length === 0) return 0;
  const drop = new Set(taskIds);

  // Unlocked pre-check: the common cycle has no checkpoints for any done task,
  // and that case should cost a read, not a mutex and a rewrite.
  if (!readAll().some((c) => drop.has(c.taskId))) return 0;

  return withFileLock(LOCK_NAME, () => {
    const all = readAll();
    const kept = all.filter((c) => !drop.has(c.taskId));
    const removed = all.length - kept.length;
    if (removed > 0) writeAtomic(kept);
    return removed;
  });
}
