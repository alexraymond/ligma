/**
 * The defect chain from a live acceptance run: a dispatch that throws before
 * a real spawn happens (skills-library.json missing) burned a governor window
 * slot it never used, and retried the same task every poll tick forever with
 * no backoff.
 *
 * Three things are under test, each the fix for one link in that chain:
 *   - the skills-library loader no longer throws when the file is absent
 *     (prompt-builder.ts's getLinkedSkills, mirroring run-inbox-respond.ts);
 *   - dispatchTask refunds the ledger claim gateBuilder already booked when
 *     dispatch fails before the spawn is attempted;
 *   - a failed dispatch is routed through the existing exponential-backoff
 *     retry queue instead of being retried unconditionally on the next poll.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-dispatch-fail-'));
process.env.LIGMA_DATA_DIR = dataDir;

// Separate ids per scenario: health history (and its retry count) persists
// to daemon-status.json in this shared data dir, so reusing one id across
// tests would leak failure counts between them.
const REFUND_TASK_ID = 'task_boom_refund';
const BACKOFF_TASK_ID = 'task_boom_backoff';
const MISSING_TASK_ID = 'task_missing';
const FAIL_TASK_IDS = new Set([REFUND_TASK_ID, BACKOFF_TASK_ID]);

mkdirSync(dataDir, { recursive: true });
writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify({ projects: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'inbox.json'), JSON.stringify({ messages: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');
writeFileSync(
  path.join(dataDir, 'agents.json'),
  JSON.stringify({
    agents: [
      {
        id: 'dev',
        name: 'Developer',
        description: 'builds',
        instructions: '',
        capabilities: [],
        skillIds: [],
        status: 'active',
      },
    ],
  }),
  'utf-8',
);
const boomTask = (id: string) => ({
  id,
  title: 'Task whose dispatch always throws',
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'not-started',
  assignedTo: 'dev',
  projectId: null,
  collaborators: [],
  subtasks: [],
  acceptanceCriteria: [],
  notes: '',
  estimatedMinutes: null,
});

writeFileSync(
  path.join(dataDir, 'tasks.json'),
  JSON.stringify({ tasks: [boomTask(REFUND_TASK_ID), boomTask(BACKOFF_TASK_ID)] }),
  'utf-8',
);
// Deliberately no skills-library.json — the file the whole chain broke on.

/** What `buildTaskPrompt` does for the real (unmocked) implementation. */
let realBuildTaskPrompt: typeof import('../src/engine/prompt-builder').buildTaskPrompt;

vi.mock('../src/engine/prompt-builder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/prompt-builder')>();
  realBuildTaskPrompt = actual.buildTaskPrompt;
  return {
    ...actual,
    // Simulates the ENOENT the live run hit: a dispatch that throws before
    // any real spawn is attempted.
    buildTaskPrompt: (agentId: string, task: Parameters<typeof actual.buildTaskPrompt>[1]) => {
      if (FAIL_TASK_IDS.has(task.id))
        throw new Error('simulated dispatch failure — no spawn attempted');
      return actual.buildTaskPrompt(agentId, task);
    },
  };
});

const { Dispatcher } = await import('../src/engine/dispatcher');
const { loadConfig } = await import('../src/engine/config');
const { HealthMonitor } = await import('../src/engine/health');
const { claimSpawn, readLedger } = await import('../src/engine/quota-governor');
import type { AgentRunner } from '../src/engine/runner';
import type { Backend } from '../src/engine/types';

const RETRY_QUEUE_FILE = path.join(dataDir, 'daemon-retry-queue.json');

interface DispatcherInternals {
  dispatchTask(taskId: string, agentId: string, backend: Backend): Promise<void>;
  processDueRetries(): Promise<void>;
  retryQueue: Array<{ taskId: string; retryAt: string; attempt: number }>;
}

/**
 * A real HealthMonitor, not a stub: the backoff fix reads its attempt count
 * from `getRetryCount()`, which only means anything against real session
 * history (see dispatcher.ts's dispatchTask — startSession/endSession now
 * bracket the whole attempt, not just the real spawn).
 */
function makeDispatcher(overrides: { retries?: number } = {}): DispatcherInternals {
  const config = loadConfig();
  if (overrides.retries !== undefined) config.execution.retries = overrides.retries;
  const dispatcher = new Dispatcher(config, {} as AgentRunner, new HealthMonitor());
  return dispatcher as unknown as DispatcherInternals;
}

function retryQueueOnDisk(): Array<{ taskId: string; retryAt: string; attempt: number }> {
  if (!existsSync(RETRY_QUEUE_FILE)) return [];
  return JSON.parse(readFileSync(RETRY_QUEUE_FILE, 'utf-8'));
}

afterAll(async () => {
  // OutputWriter opens its file asynchronously and doesn't await it (write
  // evidence isn't the point of these tests) — give the last one a tick to
  // open+close before the directory it writes into disappears.
  await new Promise((r) => setTimeout(r, 50));
  rmSync(dataDir, { recursive: true, force: true });
});

describe('the skills-library loader tolerates a missing file', () => {
  it('buildTaskPrompt does not throw when skills-library.json is absent', () => {
    const task = {
      id: 'task_prompt_ok',
      title: 'T',
      description: '',
      importance: 'important',
      urgency: 'urgent',
      kanban: 'not-started',
      assignedTo: 'dev',
      projectId: null,
      collaborators: [],
      subtasks: [],
      acceptanceCriteria: [],
      notes: '',
      estimatedMinutes: null,
    };
    expect(() => realBuildTaskPrompt('dev', task)).not.toThrow();
  });
});

describe('a dispatch that never spawns refunds its governor slot', () => {
  it('removes the ledger entry when the task has disappeared before dispatch', async () => {
    const dispatcher = makeDispatcher();
    claimSpawn('builder', { backend: 'claude', ref: MISSING_TASK_ID });
    expect(readLedger().spawns.some((s) => s.ref === MISSING_TASK_ID)).toBe(true);

    await dispatcher.dispatchTask(MISSING_TASK_ID, 'dev', 'claude');

    expect(readLedger().spawns.some((s) => s.ref === MISSING_TASK_ID)).toBe(false);
  });

  it('removes the ledger entry when the dispatch throws before spawning', async () => {
    const dispatcher = makeDispatcher();
    claimSpawn('builder', { backend: 'claude', ref: REFUND_TASK_ID });
    expect(readLedger().spawns.some((s) => s.ref === REFUND_TASK_ID)).toBe(true);

    await dispatcher.dispatchTask(REFUND_TASK_ID, 'dev', 'claude');

    expect(readLedger().spawns.some((s) => s.ref === REFUND_TASK_ID)).toBe(false);
  });
});

describe('a dispatch failure backs off instead of retrying every tick', () => {
  it('queues a retry with a future retryAt on the first failure, and a longer one on the next', async () => {
    // Enough retries budget that the second failure is still worth queuing —
    // what's under test here is the backoff growing, not the eventual cutoff
    // (already covered by the existing retries-exhausted behaviour).
    const dispatcher = makeDispatcher({ retries: 5 });

    const before1 = Date.now();
    claimSpawn('builder', { backend: 'claude', ref: BACKOFF_TASK_ID });
    await dispatcher.dispatchTask(BACKOFF_TASK_ID, 'dev', 'claude');

    const queued = retryQueueOnDisk();
    expect(queued).toHaveLength(1);
    expect(queued[0].taskId).toBe(BACKOFF_TASK_ID);
    const firstAttempt = queued[0].attempt;
    const firstDelayMs = new Date(queued[0].retryAt).getTime() - before1;
    // Comfortably more than a single poll tick — the whole point of the backoff.
    expect(firstDelayMs).toBeGreaterThan(60_000);

    // Force the queued retry due, then let the dispatcher's own retry path
    // pick it back up — the same path a live poll tick uses.
    dispatcher.retryQueue[0].retryAt = new Date(Date.now() - 1000).toISOString();
    await dispatcher.processDueRetries();

    // processDueRetries dispatches without awaiting (retries run in parallel),
    // and the failure path is async now that it takes the store lock with
    // `withFileLockAsync` — so the re-queue lands a few ticks after the call.
    await vi.waitFor(() => expect(retryQueueOnDisk()).toHaveLength(1));
    const requeued = retryQueueOnDisk();
    expect(requeued).toHaveLength(1);
    expect(requeued[0].attempt).toBeGreaterThan(firstAttempt);
    const secondDelayMs = new Date(requeued[0].retryAt).getTime() - Date.now();
    // Exponential: the second wait is comfortably longer than the first.
    expect(secondDelayMs).toBeGreaterThan(firstDelayMs * 1.5);

    // Both failed dispatches booked and then refunded their claim — the
    // ledger carries no leftover entries for this task.
    expect(readLedger().spawns.some((s) => s.ref === BACKOFF_TASK_ID)).toBe(false);
  });

  it('gives up instead of retrying forever once the retry budget is exhausted', async () => {
    // retries:0 means no budget at all — the very first failure must exhaust
    // it, so the task is never re-queued. This is the fix for the reported
    // "retried every 5-minute tick forever": eventually it must stop.
    const dispatcher = makeDispatcher({ retries: 0 });
    const taskId = 'task_boom_give_up';
    writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [boomTask(REFUND_TASK_ID), boomTask(BACKOFF_TASK_ID), boomTask(taskId)],
      }),
      'utf-8',
    );
    FAIL_TASK_IDS.add(taskId);

    claimSpawn('builder', { backend: 'claude', ref: taskId });
    await dispatcher.dispatchTask(taskId, 'dev', 'claude');

    expect(retryQueueOnDisk().some((r) => r.taskId === taskId)).toBe(false);
    // The claim this failed dispatch booked is still refunded even on the
    // no-more-retries path.
    expect(readLedger().spawns.some((s) => s.ref === taskId)).toBe(false);
  });
});
