import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Paused-project dispatch gate (F1), against a throwaway data dir. Mostly a
 * pure-helper test: it calls the exported helpers the dispatcher's filters read
 * once per cycle, and only the last case builds a real Dispatcher — the one
 * thing it asserts is that the poll cycle CALLS something.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-dispatcher-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  getPausedProjectIds,
  isDeferred,
  pruneCheckpointsForDoneTasks,
  verificationRosterSize,
  builderSlotCap,
} = await import('./dispatcher');
const { readCheckpointsForTask } = await import('./checkpoints');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('getPausedProjectIds', () => {
  it('returns exactly the paused project ids', () => {
    writeFileSync(
      path.join(dataDir, 'projects.json'),
      JSON.stringify({
        projects: [
          { id: 'proj_active', status: 'active' },
          { id: 'proj_paused', status: 'paused' },
        ],
      }),
      'utf-8',
    );

    const paused = getPausedProjectIds();
    expect(paused).toEqual(new Set(['proj_paused']));
  });

  it('fails open to an empty set when projects.json is missing', () => {
    rmSync(path.join(dataDir, 'projects.json'), { force: true });
    expect(getPausedProjectIds()).toEqual(new Set());
  });

  it('fails open to an empty set when projects.json is corrupt', () => {
    writeFileSync(path.join(dataDir, 'projects.json'), '{not json', 'utf-8');
    expect(getPausedProjectIds()).toEqual(new Set());
  });
});

describe('isDeferred (untouched by the paused-project gate)', () => {
  it('is false with no deferredUntil', () => {
    expect(isDeferred({ deferredUntil: null })).toBe(false);
  });

  it('is true while deferredUntil is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isDeferred({ deferredUntil: future })).toBe(true);
  });

  it('is false once deferredUntil has passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isDeferred({ deferredUntil: past })).toBe(false);
  });
});

/**
 * The poll cycle's checkpoint sweep. Same pure-helper shape as the tests above:
 * the exported function is called directly rather than constructing a Dispatcher.
 */
describe('pruneCheckpointsForDoneTasks', () => {
  const checkpointsFile = path.join(dataDir, 'task-checkpoints.json');

  function seedCheckpoints(taskIds: string[]): void {
    writeFileSync(
      checkpointsFile,
      JSON.stringify({
        checkpoints: taskIds.map((taskId, i) => ({
          taskId,
          agentId: 'developer',
          phase: `phase_${i}`,
          note: 'n',
          createdAt: '2026-08-26T10:00:00.000Z',
        })),
      }),
      'utf-8',
    );
  }

  function seedTasks(tasks: Array<{ id: string; kanban: string }>): void {
    writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks }), 'utf-8');
  }

  it("forgets the checkpoints of done tasks and keeps everyone else's", () => {
    seedTasks([
      { id: 'task_done', kanban: 'done' },
      { id: 'task_running', kanban: 'in-progress' },
      { id: 'task_queued', kanban: 'not-started' },
    ]);
    seedCheckpoints(['task_done', 'task_running', 'task_queued']);

    expect(pruneCheckpointsForDoneTasks()).toBe(1);
    expect(readCheckpointsForTask('task_done')).toEqual([]);
    expect(readCheckpointsForTask('task_running')).toHaveLength(1);
    expect(readCheckpointsForTask('task_queued')).toHaveLength(1);
  });

  it('does nothing when no task is done', () => {
    seedTasks([{ id: 'task_running', kanban: 'in-progress' }]);
    seedCheckpoints(['task_running']);

    expect(pruneCheckpointsForDoneTasks()).toBe(0);
    expect(readCheckpointsForTask('task_running')).toHaveLength(1);
  });

  it('never throws the poll cycle when tasks.json is corrupt', () => {
    writeFileSync(path.join(dataDir, 'tasks.json'), '{not json', 'utf-8');
    expect(pruneCheckpointsForDoneTasks()).toBe(0);
  });
});

/**
 * C2's admission arithmetic. The dispatcher used to gate a ~14-session fan-out on
 * one `canSpawn("judge")`, which reserves nothing — this is the real size of what
 * it is about to start, read off the same `panelTransports`/`transportRoster` the
 * run itself will use, so the two cannot disagree.
 */
describe('verificationRosterSize', () => {
  it("costs a ui project's browser panel: auditor + naive + saboteur + returning + visual-critic", () => {
    expect(verificationRosterSize('ui', 1)).toBe(5);
  });

  it('drops the visual critic on a headless project — nothing to look at', () => {
    expect(verificationRosterSize('headless', 1)).toBe(4);
  });

  it('counts BOTH transports for a mixed project', () => {
    expect(verificationRosterSize('mixed', 1)).toBe(9);
  });

  it('costs an artifact project two sessions — the auditor and one reader (H5)', () => {
    expect(verificationRosterSize('artifact', 1)).toBe(2);
    // And no amount of naive-user configuration inflates it: there is one reader.
    expect(verificationRosterSize('artifact', 3)).toBe(2);
  });

  it('scales one-for-one with naiveUserRuns', () => {
    expect(verificationRosterSize('ui', 3) - verificationRosterSize('ui', 1)).toBe(2);
    expect(verificationRosterSize('mixed', 2) - verificationRosterSize('mixed', 1)).toBe(2);
  });
});

/** M2 — builders and verification both drew from one pool, builders first. */
describe('builderSlotCap', () => {
  it('leaves the whole pool to builders when nothing is awaiting verification', () => {
    expect(builderSlotCap(4, 0)).toBe(4);
  });

  it('holds one slot back as soon as anything awaits verification', () => {
    expect(builderSlotCap(4, 1)).toBe(3);
    expect(builderSlotCap(4, 7)).toBe(3);
  });

  it('never returns a negative cap', () => {
    expect(builderSlotCap(0, 1)).toBe(0);
  });
});

/**
 * H4 — the park reason's lifecycle, driven through a real poll cycle.
 *
 * `maxParallelAgents: 0` keeps the cycle honest and cheap: the filter (and its
 * park bookkeeping) runs in full, then dispatch returns on "no slots" before
 * anything is spawned.
 */
describe('parkedReason', () => {
  async function poll(retryCount = 0): Promise<void> {
    const { Dispatcher } = await import('./dispatcher');
    const { loadConfig } = await import('./config');
    const { HealthMonitor } = await import('./health');
    const { AgentRunner } = await import('./runner');

    const config = loadConfig();
    config.execution.harness.autoVerify = false;
    config.concurrency.maxParallelAgents = 0;
    const health = {
      getActiveSessions: () => [],
      activeCount: () => 0,
      isTaskRunning: () => false,
      getRetryCount: () => retryCount,
      setLastPollAt: () => {},
    };
    const dispatcher = new Dispatcher(
      config,
      {} as InstanceType<typeof AgentRunner>,
      health as unknown as InstanceType<typeof HealthMonitor>,
    );
    await dispatcher.pollAndDispatch();
  }

  const parkedReason = (): string | null | undefined => {
    const data = JSON.parse(readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8')) as {
      tasks: Array<{ parkedReason?: string | null }>;
    };
    return data.tasks[0].parkedReason;
  };

  function seed(decisionStatus: string, existingReason: string | null = null): void {
    writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [
          {
            id: 'task_parked',
            title: 'A task that keeps asking',
            kanban: 'not-started',
            assignedTo: 'developer',
            blockedBy: [],
            importance: 'important',
            urgency: 'urgent',
            parkedReason: existingReason,
          },
        ],
      }),
      'utf-8',
    );
    writeFileSync(
      path.join(dataDir, 'decisions.json'),
      JSON.stringify({
        decisions: [0, 1, 2].map((i) => ({
          id: `dec_park_${i}`,
          taskId: 'task_parked',
          status: decisionStatus,
          blocksTask: false,
        })),
      }),
      'utf-8',
    );
  }

  it('writes down why the task was skipped, with the count that makes it actionable', async () => {
    seed('pending');
    await poll();
    expect(parkedReason()).toMatch(/3 pending decisions are unanswered/);
    expect(parkedReason()).toContain('(3 pending)');
  });

  it('clears itself when the condition lifts — nothing has to un-set it', async () => {
    seed('answered', '3 pending decisions are unanswered (3 pending)');
    await poll();
    expect(parkedReason()).toBeNull();
  });

  it("parks on the retry limit too, in the daemon's own words", async () => {
    seed('answered');
    await poll(99);
    expect(parkedReason()).toMatch(/attempts used/);
  });
});

/**
 * The poll cycle has to actually CALL the cap-card consumer, or the four options
 * on an "attempts exhausted" card stay decoration. Constructs a real Dispatcher
 * (stub runner/health, autoVerify off so the cycle starts nothing) and drives
 * one cycle over a seeded, already-answered card.
 */
describe('pollAndDispatch consumes answered verification-cap cards', () => {
  it("applies the human's answer to the task", async () => {
    const { Dispatcher } = await import('./dispatcher');
    const { loadConfig } = await import('./config');
    const { VERIFICATION_CAP_KIND } = await import('../harness/verdict');
    const { HealthMonitor } = await import('./health');
    const { AgentRunner } = await import('./runner');

    writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [
          {
            id: 'task_capped',
            kanban: 'awaiting-verification',
            verificationStatus: 'unverified',
            verificationAttempts: 3,
          },
        ],
      }),
      'utf-8',
    );
    writeFileSync(
      path.join(dataDir, 'decisions.json'),
      JSON.stringify({
        decisions: [
          {
            id: 'dec_poll_cap',
            taskId: 'task_capped',
            kind: VERIFICATION_CAP_KIND,
            attempts: 3,
            max: 3,
            status: 'answered',
            answer: 'Raise the attempt cap',
          },
        ],
      }),
      'utf-8',
    );

    const config = loadConfig();
    config.execution.harness.autoVerify = false;
    const health = {
      getActiveSessions: () => [],
      activeCount: () => 0,
      isTaskRunning: () => false,
      getRetryCount: () => 0,
      setLastPollAt: () => {},
    };
    const dispatcher = new Dispatcher(
      config,
      {} as InstanceType<typeof AgentRunner>,
      health as unknown as InstanceType<typeof HealthMonitor>,
    );

    await dispatcher.pollAndDispatch();

    const tasks = JSON.parse(readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8')) as {
      tasks: Array<{ id: string; verificationAttempts?: number }>;
    };
    expect(tasks.tasks[0].verificationAttempts).toBe(0);

    const decisions = JSON.parse(readFileSync(path.join(dataDir, 'decisions.json'), 'utf-8')) as {
      decisions: Array<{ consumedAt?: string }>;
    };
    expect(decisions.decisions[0].consumedAt).toBeTruthy();
  });

  /** H8's other half: the consumer only acts if the cycle actually calls it. */
  it('opens the follow-up task an answered judge card promised', async () => {
    const { Dispatcher } = await import('./dispatcher');
    const { loadConfig } = await import('./config');
    const { HealthMonitor } = await import('./health');
    const { AgentRunner } = await import('./runner');

    writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [
          {
            id: 'task_origin',
            title: 'Origin',
            kanban: 'done',
            assignedTo: 'developer',
            importance: 'important',
            urgency: 'urgent',
            blockedBy: [],
          },
        ],
      }),
      'utf-8',
    );
    writeFileSync(
      path.join(dataDir, 'decisions.json'),
      JSON.stringify({
        decisions: [
          {
            id: 'dec_follow',
            taskId: 'task_origin',
            question: 'Saving takes six clicks — accept?',
            context: 'raised in run vrun_9',
            status: 'answered',
            answer: 'Open a follow-up task',
          },
        ],
      }),
      'utf-8',
    );

    const config = loadConfig();
    config.execution.harness.autoVerify = false;
    config.concurrency.maxParallelAgents = 0;
    const health = {
      getActiveSessions: () => [],
      activeCount: () => 0,
      isTaskRunning: () => false,
      getRetryCount: () => 0,
      setLastPollAt: () => {},
    };
    const dispatcher = new Dispatcher(
      config,
      {} as InstanceType<typeof AgentRunner>,
      health as unknown as InstanceType<typeof HealthMonitor>,
    );

    await dispatcher.pollAndDispatch();

    const tasks = JSON.parse(readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8')) as {
      tasks: Array<{ id: string; title: string }>;
    };
    expect(tasks.tasks.map((t) => t.title)).toContain('Saving takes six clicks — accept?');
  });
});

/**
 * M4 — the crash-retry budget is the BUILDER's, and nothing else may spend it.
 *
 * Verification runs are started under the same taskId (`command: "verify"`), so
 * every run the governor denied or the harness broke wrote a "failed" history
 * row that counted against `execution.retries`. With `retries: 1` two denied
 * panels parked a task whose builder had never once failed — the send-back loop
 * eating the crash-retry budget (execution-flow-review M4).
 */
describe('getRetryCount — crash retries only', () => {
  async function monitor() {
    const { HealthMonitor } = await import('./health');
    return new HealthMonitor();
  }

  /** End a session as a failure (exit 1 ⇒ status "failed" ⇒ retry-counted). */
  function fail(
    health: {
      startSession: (a: string, t: string | null, c: string, p: number) => string;
      endSession: (s: string, e: number | null, err: string | null, t: boolean) => void;
    },
    taskId: string,
    command: string,
  ): void {
    health.endSession(
      health.startSession('system', taskId, command, 0),
      1,
      `${command} exited 1`,
      false,
    );
  }

  it('counts a builder session that crashed', async () => {
    const health = await monitor();
    fail(health, 'task_m4_a', 'task');
    expect(health.getRetryCount('task_m4_a')).toBe(1);
  });

  it('does not count a verification run that broke or was denied', async () => {
    const health = await monitor();
    fail(health, 'task_m4_b', 'verify');
    fail(health, 'task_m4_b', 'verify');
    expect(health.getRetryCount('task_m4_b')).toBe(0);
  });

  it("still counts the builder's crashes when verification also failed", async () => {
    const health = await monitor();
    fail(health, 'task_m4_c', 'verify');
    fail(health, 'task_m4_c', 'task');
    expect(health.getRetryCount('task_m4_c')).toBe(1);
  });

  it('does not count a builder session that completed', async () => {
    const health = await monitor();
    const id = health.startSession('developer', 'task_m4_d', 'task', 0);
    health.endSession(id, 0, null, false);
    expect(health.getRetryCount('task_m4_d')).toBe(0);
  });

  /**
   * E4 — the count outlives the 50-row history ring.
   *
   * A task parked at the cap ("not being picked up again without a human") had
   * its failure rows evicted by unrelated sessions, `getRetryCount` fell back to
   * 0, and it was quietly retried forever at ~50-session intervals.
   */
  it("still remembers a parked task's failures after the history ring has turned over", async () => {
    const health = await monitor();
    fail(health, 'task_e4_parked', 'task');
    for (let i = 0; i < 60; i++) fail(health, `task_e4_noise_${i}`, 'task');
    expect(health.getRetryCount('task_e4_parked')).toBe(1);
  });

  it('carries the count across a daemon restart', async () => {
    const health = await monitor();
    fail(health, 'task_e4_restart', 'task');
    fail(health, 'task_e4_restart', 'task');
    health.flush();
    // A new process reading the same status file must not hand the task a fresh
    // budget just because it restarted.
    expect((await monitor()).getRetryCount('task_e4_restart')).toBe(2);
  });
});

/**
 * S5/P7 — a retry queued for a failed run must not fire after the task settled.
 *
 * Observed in one tick: a builder retry AND a verification run started for the
 * same task, so a second builder wrote into the repo the harness was
 * snapshotting. Terminal settles happen in two other processes, so the queue is
 * re-checked against the board at FIRE time rather than trusted from when the
 * entry was written.
 */
describe('the retry queue re-checks the board at fire time', () => {
  async function pollWithQueuedRetry(
    kanban: string,
  ): Promise<{ tasks: Array<{ id: string; kanban: string }>; queue: unknown[] }> {
    const { Dispatcher } = await import('./dispatcher');
    const { loadConfig } = await import('./config');
    const { HealthMonitor } = await import('./health');
    const { AgentRunner } = await import('./runner');

    writeFileSync(
      path.join(dataDir, 'tasks.json'),
      JSON.stringify({
        tasks: [
          {
            id: 'task_s5',
            title: 'Settled',
            kanban,
            assignedTo: 'developer',
            importance: 'important',
            urgency: 'urgent',
            blockedBy: [],
            projectId: null,
          },
        ],
      }),
      'utf-8',
    );
    writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');
    // Due one minute ago.
    writeFileSync(
      path.join(dataDir, 'daemon-retry-queue.json'),
      JSON.stringify([
        {
          taskId: 'task_s5',
          agentId: 'developer',
          retryAt: new Date(Date.now() - 60_000).toISOString(),
          attempt: 1,
          failedAt: new Date(Date.now() - 120_000).toISOString(),
          error: 'boot gate',
        },
      ]),
      'utf-8',
    );

    const config = loadConfig();
    config.execution.harness.autoVerify = false;
    const health = {
      getActiveSessions: () => [],
      activeCount: () => 0,
      isTaskRunning: () => false,
      getRetryCount: () => 0,
      setLastPollAt: () => {},
    };
    const dispatcher = new Dispatcher(
      config,
      {} as InstanceType<typeof AgentRunner>,
      health as unknown as InstanceType<typeof HealthMonitor>,
    );
    await dispatcher.pollAndDispatch();

    return {
      tasks: (
        JSON.parse(readFileSync(path.join(dataDir, 'tasks.json'), 'utf-8')) as {
          tasks: Array<{ id: string; kanban: string }>;
        }
      ).tasks,
      queue: JSON.parse(
        readFileSync(path.join(dataDir, 'daemon-retry-queue.json'), 'utf-8'),
      ) as unknown[],
    };
  }

  it('drops a due retry for a task that has since settled', async () => {
    const { tasks, queue } = await pollWithQueuedRetry('awaiting-verification');
    // Never dispatched: a dispatch would have marked it in-progress.
    expect(tasks[0].kanban).toBe('awaiting-verification');
    expect(queue).toEqual([]);
  });

  it('drops a due retry for a task that is already done', async () => {
    const { tasks, queue } = await pollWithQueuedRetry('done');
    expect(tasks[0].kanban).toBe('done');
    expect(queue).toEqual([]);
  });
});
