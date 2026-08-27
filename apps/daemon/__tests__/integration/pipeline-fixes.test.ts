/**
 * Integration: the autonomous pipeline actually completes.
 *
 * Every case here is a regression that would have caught a bug where the daemon
 * silently stopped making progress — no contract ever compiled, a killed run
 * owning its task forever, a failed task never re-verified, an unbounded
 * respawn loop, a harness crash reported as a product failure, or a backend
 * fallback slipping past the quota governor.
 *
 * No LLM and no ephemeral env: the seams are driven directly.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/engine/config';
import { toolsForRole } from '../../src/engine/config';
import { Dispatcher } from '../../src/engine/dispatcher';
import type { HealthMonitor } from '../../src/engine/health';
import { killSwitchFilePath, ledgerFilePath } from '../../src/engine/quota-governor';
import { type AgentRunner, buildArgs, canBackendHonorRestrictions } from '../../src/engine/runner';
import type { SpawnOptions } from '../../src/engine/types';
import { getLatestContract } from '../../src/harness/contract-store';
import type { VerificationVerdict } from '../../src/harness/types';
import {
  RUNS_DIR,
  applyVerdict,
  handleBuilderCompletion,
  hasRunningVerification,
  isVerifiable,
  maxVerificationAttempts,
  pruneVerificationEvidence,
  sweepStaleVerificationRuns,
} from '../../src/harness/verdict';
import { getActivityLog, getDecisions, getInbox, getTasks, saveTasks } from '../../src/store/data';
import { createTask, findTask } from './test-utils';

import { DATA_DIR as MC_DATA } from '../../src/paths';
const CONTRACTS_DIR = path.join(MC_DATA, 'contracts');
const createdContracts: string[] = [];
const createdRunDirs: string[] = [];

/** A pid that cannot be alive. */
const DEAD_PID = 999_999;

function trackContract(taskId: string): void {
  createdContracts.push(path.join(CONTRACTS_DIR, `${taskId}.jsonl`));
}

function writeRunManifest(runId: string, manifest: Record<string, unknown>): string {
  const dir = path.join(RUNS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  createdRunDirs.push(dir);
  return dir;
}

function readRunManifest(runId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(RUNS_DIR, runId, 'run.json'), 'utf-8')) as Record<
    string,
    unknown
  >;
}

function verdictFor(taskId: string, outcome: VerificationVerdict['outcome']): VerificationVerdict {
  return {
    runId: `vrun_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    taskId,
    contractId: 'ctr_test',
    contractVersion: 1,
    outcome,
    criterionVerdicts: [
      {
        criterionId: 'crit_1',
        status: 'unknown',
        reasoning: 'the judge never answered',
        evidence: [],
      },
    ],
    humanDecisions: [],
    judgeModel: 'opus',
    createdAt: new Date().toISOString(),
    signature: null,
  };
}

/**
 * The real board may hold awaiting-verification tasks. Park them so a dispatcher
 * call in this suite can never start a real verification run against them.
 */
async function isolateAwaitingVerification(keepTaskId: string): Promise<void> {
  const data = await getTasks();
  for (const t of data.tasks) {
    if (t.id !== keepTaskId && t.kanban === 'awaiting-verification') t.kanban = 'in-progress';
  }
  await saveTasks(data);
}

afterAll(() => {
  for (const file of createdContracts) rmSync(file, { force: true });
  for (const dir of createdRunDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(killSwitchFilePath(), { force: true });
});

describe('builder completion compiles the oracle (D1)', () => {
  it('produces a contract from acceptanceCriteria, so the task becomes verifiable', async () => {
    const task = await createTask({
      title: 'Auto-compile me',
      assignedTo: 'developer',
      kanban: 'in-progress',
      acceptanceCriteria: [
        'The board shows the new task immediately',
        'Reopening the task still shows its notes',
      ],
    });
    trackContract(task.id);

    expect(getLatestContract(task.id)).toBeNull();
    expect(await handleBuilderCompletion(task.id, 'developer', 'built it')).toBe(
      'awaiting-verification',
    );

    const contract = getLatestContract(task.id);
    expect(contract).not.toBeNull();
    expect(contract!.criteria.map((c) => c.text)).toEqual([
      'The board shows the new task immediately',
      'Reopening the task still shows its notes',
    ]);
    // The whole point: without this the task can never leave awaiting-verification.
    expect(isVerifiable(task.id)).toBe(true);

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('awaiting-verification');
    expect(after?.verificationStatus).toBe('unverified');
  });
});

describe('a task with no acceptance criteria (D1)', () => {
  it('lands done + waived and unblocks its dependents', async () => {
    const blocker = await createTask({
      title: 'No criteria here',
      assignedTo: 'developer',
      kanban: 'in-progress',
      acceptanceCriteria: [],
    });
    const dependent = await createTask({ blockedBy: [blocker.id], assignedTo: 'developer' });

    expect(await handleBuilderCompletion(blocker.id, 'developer', 'shipped')).toBe('waived');

    const after = await findTask(blocker.id);
    expect(after?.kanban).toBe('done');
    // Never "passed": nothing was verified, and the UI must be able to tell.
    expect(after?.verificationStatus).toBe('waived');
    expect(after?.completedAt).toBeTruthy();
    // Unblocked by the blocker's status, not by deleting the link: `blockedBy`
    // is the declared dependency and survives the blocker completing (M5).
    expect((await findTask(dependent.id))?.blockedBy).toEqual([blocker.id]);
    expect((await findTask(blocker.id))?.kanban).toBe('done');

    // No oracle exists, so no contract was invented.
    expect(getLatestContract(blocker.id)).toBeNull();

    const message = (await getInbox()).messages.filter((m) => m.taskId === blocker.id).at(-1);
    expect(message?.subject).toBe('Completed without verification: No criteria here');
    expect(message?.body).toContain('no acceptance criteria');
    expect(message?.body).not.toContain('Verified');
  });
});

describe('a new build invalidates the old verdict (D6)', () => {
  it('makes a previously-failed task verifiable again', async () => {
    const task = await createTask({
      title: 'Failed once',
      assignedTo: 'developer',
      kanban: 'awaiting-verification',
      acceptanceCriteria: ['It works'],
    });
    trackContract(task.id);

    await applyVerdict(verdictFor(task.id, 'failed'));
    expect((await findTask(task.id))?.verificationStatus).toBe('failed');

    // Burn the attempts, as three dead runs would have.
    const data = await getTasks();
    data.tasks.find((t) => t.id === task.id)!.verificationAttempts = maxVerificationAttempts();
    await saveTasks(data);

    expect(await handleBuilderCompletion(task.id, 'developer', 'fixed it')).toBe(
      'awaiting-verification',
    );

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('awaiting-verification');
    expect(after?.verificationStatus).toBe('unverified');
    expect(after?.verificationAttempts).toBe(0);
  });
});

describe('a dead verification run does not own its task (D5)', () => {
  it('is reclaimed instead of blocking the task forever', async () => {
    const taskId = 'task_dead_run_test';
    const runId = `vrun_dead_${Date.now()}`;
    writeRunManifest(runId, {
      id: runId,
      taskId,
      status: 'running',
      pid: DEAD_PID,
      startedAt: new Date().toISOString(),
    });

    expect(hasRunningVerification(taskId)).toBe(false);
    const manifest = readRunManifest(runId);
    expect(manifest.status).toBe('error');
    expect(String(manifest.error)).toContain('no longer running');
  });

  it('still believes a run whose process is alive', () => {
    const taskId = 'task_live_run_test';
    const runId = `vrun_live_${Date.now()}`;
    writeRunManifest(runId, {
      id: runId,
      taskId,
      status: 'running',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    expect(hasRunningVerification(taskId)).toBe(true);
    expect(readRunManifest(runId).status).toBe('running');
  });

  it('treats a run started longer ago than 2x the timeout as dead even if the pid is reused', () => {
    const taskId = 'task_ancient_run_test';
    const runId = `vrun_ancient_${Date.now()}`;
    const longAgo = new Date(
      Date.now() - (4 * loadConfig().execution.timeoutMinutes + 1) * 60_000,
    ).toISOString();
    writeRunManifest(runId, {
      id: runId,
      taskId,
      status: 'running',
      pid: process.pid,
      startedAt: longAgo,
    });

    expect(hasRunningVerification(taskId)).toBe(false);
    expect(readRunManifest(runId).status).toBe('error');
  });

  it('sweeps the corpses at daemon start', () => {
    const runId = `vrun_sweep_${Date.now()}`;
    writeRunManifest(runId, {
      id: runId,
      taskId: 'task_sweep_test',
      status: 'running',
      pid: DEAD_PID,
      startedAt: new Date().toISOString(),
    });

    expect(sweepStaleVerificationRuns()).toContain(runId);
    expect(readRunManifest(runId).status).toBe('error');
  });
});

describe('evidence pruning (docs/history/CONTRACTS.md 72h)', () => {
  it('drops screenshots and transcripts but keeps the audit trail', () => {
    const runId = `vrun_prune_${Date.now()}`;
    const dir = writeRunManifest(runId, {
      id: runId,
      taskId: 'task_prune_test',
      status: 'complete',
      pid: null,
    });
    writeFileSync(path.join(dir, 'verdict.json'), '{}', 'utf-8');
    mkdirSync(path.join(dir, 'personas', 'naive-user-1', 'shots'), { recursive: true });
    writeFileSync(path.join(dir, 'personas', 'naive-user-1', 'shots', '01.png'), 'png', 'utf-8');
    writeFileSync(path.join(dir, 'personas', 'naive-user-1', 'report.json'), '{}', 'utf-8');
    writeFileSync(path.join(dir, 'personas', 'naive-user-1', 'transcript.jsonl'), '{}\n', 'utf-8');
    writeFileSync(path.join(dir, 'personas', 'naive-user-1', 'steps.jsonl'), '{}\n', 'utf-8');

    // Not yet old enough: nothing is touched.
    pruneVerificationEvidence();
    expect(existsSync(path.join(dir, 'personas', 'naive-user-1', 'transcript.jsonl'))).toBe(true);

    const old = new Date(Date.now() - 80 * 60 * 60 * 1000);
    utimesSync(dir, old, old);
    pruneVerificationEvidence();

    expect(existsSync(path.join(dir, 'personas', 'naive-user-1', 'shots'))).toBe(false);
    expect(existsSync(path.join(dir, 'personas', 'naive-user-1', 'transcript.jsonl'))).toBe(false);
    expect(existsSync(path.join(dir, 'personas', 'naive-user-1', 'steps.jsonl'))).toBe(false);
    // The audit trail is kept forever.
    expect(existsSync(path.join(dir, 'run.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'verdict.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'personas', 'naive-user-1', 'report.json'))).toBe(true);
  });
});

// ─── Dispatcher seams ────────────────────────────────────────────────────────

interface DispatcherInternals {
  dispatchVerifications(): Promise<void>;
  spawnTaskWithFallback(opts: {
    prompt: string;
    taskId: string;
    sessionId: string;
    initialBackend: 'claude' | 'codex' | 'gemini';
  }): Promise<{ result: { exitCode: number | null }; backend: string; deferred: boolean }>;
}

function makeDispatcher(
  runner: Partial<AgentRunner>,
  health: Partial<HealthMonitor>,
): DispatcherInternals {
  const dispatcher = new Dispatcher(loadConfig(), runner as AgentRunner, health as HealthMonitor);
  return dispatcher as unknown as DispatcherInternals;
}

describe('verification respawn cap (D4)', () => {
  beforeEach(() => {
    rmSync(ledgerFilePath(), { force: true });
    rmSync(killSwitchFilePath(), { force: true });
  });

  it('stops selecting the task, and says so once — not once per poll', async () => {
    const max = maxVerificationAttempts();
    const task = await createTask({
      title: 'Harness cannot verify me',
      assignedTo: 'developer',
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      acceptanceCriteria: ['Something observable'],
      verificationAttempts: max,
    });
    await isolateAwaitingVerification(task.id);

    const started: string[] = [];
    const dispatcher = makeDispatcher({}, {
      activeCount: () => 0,
      startSession: (_a: string, t: string | null) => {
        started.push(t ?? '');
        return 'sess_test';
      },
    } as Partial<HealthMonitor>);

    await dispatcher.dispatchVerifications();
    await dispatcher.dispatchVerifications();

    // No run started for a task that is at its cap.
    expect(started).not.toContain(task.id);

    const blocked = (await getInbox()).messages.filter(
      (m) => m.taskId === task.id && m.subject.startsWith('Blocked:'),
    );
    expect(blocked).toHaveLength(1);
    // The reason must be the real one, not an invented product failure.
    expect(blocked[0].body).toContain('NOT a statement that the work is wrong');

    const cards = (await getDecisions()).decisions.filter((d) => d.taskId === task.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].blocksTask).toBe(false);
    expect(cards[0].context).toContain('verification attempts exhausted');

    // The cap must never be laundered into a verdict.
    expect((await findTask(task.id))?.verificationStatus).toBe('unverified');
  });
});

describe('backend fallback passes the governor (D10)', () => {
  beforeEach(() => {
    rmSync(ledgerFilePath(), { force: true });
    rmSync(killSwitchFilePath(), { force: true });
  });

  it('defers instead of spawning when the governor says no', async () => {
    writeFileSync(killSwitchFilePath(), 'test', 'utf-8');

    let spawns = 0;
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async () => {
          spawns += 1;
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'rate limit exceeded (429)',
            timedOut: false,
            pid: 0,
          };
        },
      } as Partial<AgentRunner>,
      { updateSessionPid: () => undefined } as Partial<HealthMonitor>,
    );

    const exec = await dispatcher.spawnTaskWithFallback({
      prompt: 'p',
      taskId: 'task_fallback_gate',
      sessionId: 'sess_test',
      initialBackend: 'claude',
    });

    // Our own decision, not a fabricated exit code the CLI could also produce.
    expect(exec.deferred).toBe(true);
    expect(spawns).toBe(1);
  });

  it('does fall back when the governor allows it', async () => {
    const backends: string[] = [];
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async (opts: { backend?: string }) => {
          backends.push(opts.backend ?? 'claude');
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'rate limit exceeded (429)',
            timedOut: false,
            pid: 0,
          };
        },
      } as Partial<AgentRunner>,
      { updateSessionPid: () => undefined } as Partial<HealthMonitor>,
    );

    await dispatcher.spawnTaskWithFallback({
      prompt: 'p',
      taskId: 'task_fallback_ok',
      sessionId: 'sess_test',
      initialBackend: 'claude',
    });

    expect(backends.length).toBeGreaterThan(1);
  });
});

/**
 * D7 lives or dies at the CALL SITE. buildArgs does the right thing when it is
 * told the role, and defaults to a loose deny when it is not — so a spawn that
 * forgets `role` hands the builder read access to data/tasks.json, i.e. the whole
 * acceptanceCriteria list including the holdouts. No argv-level test can catch
 * that; only asserting what the dispatcher actually passes can.
 */
describe('spawn roles reach the runner (D7/D9)', () => {
  const TASKS_DENY = `Read(/${path.join(MC_DATA, 'tasks.json')})`;

  it('gives a builder spawn a deny rule covering data/tasks.json', async () => {
    let captured: SpawnOptions | null = null;
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async (o: SpawnOptions) => {
          captured = o;
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, pid: 0 };
        },
      } as Partial<AgentRunner>,
      { updateSessionPid: () => undefined } as Partial<HealthMonitor>,
    );

    await dispatcher.spawnTaskWithFallback({
      prompt: 'p',
      taskId: 'task_role_builder',
      sessionId: 's',
      initialBackend: 'claude',
    });

    expect(captured).not.toBeNull();
    expect(captured!.role).toBe('builder');
    const argv = buildArgs(captured!, 'claude');
    expect(argv).toContain('--disallowedTools');
    expect(argv).toContain(TASKS_DENY);
    // D9: the builder keeps its shell — that is deliberate.
    expect(captured!.allowedTools).toContain('Bash');
    // The build brief's "cheaper models for manual tasks" rule, reaching the
    // actual spawn — not just sitting unused in daemon-config.json.
    expect(captured!.model).toBe(loadConfig().execution.workerModel);
  });

  it('does not deny the task store to a scheduled command, and gives it no shell', async () => {
    let captured: SpawnOptions | null = null;
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async (o: SpawnOptions) => {
          captured = o;
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, pid: 0 };
        },
      } as Partial<AgentRunner>,
      {
        isCommandRunning: () => false,
        activeCount: () => 0,
        startSession: () => 'sess_sched',
        endSession: () => undefined,
      } as Partial<HealthMonitor>,
    );

    await (
      dispatcher as unknown as { runScheduledCommand(c: string): Promise<void> }
    ).runScheduledCommand('standup');

    expect(captured).not.toBeNull();
    expect(captured!.role).toBe('scheduled');
    // /standup legitimately reads the board.
    expect(buildArgs(captured!, 'claude')).not.toContain(TASKS_DENY);
    expect(captured!.allowedTools).not.toContain('Bash');
  });
});

/**
 * P21. Agent I's fail-closed buildArgs throws rather than spawn a backend that
 * cannot express the restriction — so an unsupported backend has to be skipped
 * before it is attempted, or a claude rate limit stops work dead instead of
 * rotating to another CLI.
 */
describe('fallback skips a backend it cannot restrict (D8/P21)', () => {
  beforeEach(() => {
    rmSync(ledgerFilePath(), { force: true });
    rmSync(killSwitchFilePath(), { force: true });
  });

  it('rotates past gemini instead of throwing', async () => {
    const restricted = { allowedTools: toolsForRole('builder'), skipPermissions: false };
    // The premise: gemini genuinely cannot serve this spawn.
    expect(canBackendHonorRestrictions('gemini', restricted)).toBe(false);
    expect(canBackendHonorRestrictions('claude', restricted)).toBe(true);

    const attempted: Array<string | undefined> = [];
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async (o: SpawnOptions) => {
          attempted.push(o.backend);
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, pid: 0 };
        },
      } as Partial<AgentRunner>,
      { updateSessionPid: () => undefined } as Partial<HealthMonitor>,
    );

    const exec = await dispatcher.spawnTaskWithFallback({
      prompt: 'p',
      taskId: 'task_gemini_skip',
      sessionId: 's',
      initialBackend: 'gemini',
    });

    // The point of the test: gemini is skipped rather than attempted-and-thrown,
    // and the work still runs.
    expect(exec.deferred).toBe(false);
    expect(attempted).not.toContain('gemini');
    // E11: the chain is no longer the fixed BACKEND_ROTATION this used to expect
    // (which put claude next). `buildBackendChain` honours
    // `claudeAutoFailoverBackend` — "codex" by default — so the hop after the
    // unusable initial backend is the configured failover target. Ordering is a
    // separate concern from the restriction-skip asserted above.
    expect(loadConfig().execution.claudeAutoFailoverBackend).toBe('codex');
    expect(exec.backend).toBe('codex');
  });

  it('defers rather than spawning unrestricted when the only usable backend is denied', async () => {
    writeFileSync(killSwitchFilePath(), 'test', 'utf-8');

    let spawns = 0;
    const dispatcher = makeDispatcher(
      {
        spawnAgent: async () => {
          spawns += 1;
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, pid: 0 };
        },
      } as Partial<AgentRunner>,
      { updateSessionPid: () => undefined } as Partial<HealthMonitor>,
    );

    const exec = await dispatcher.spawnTaskWithFallback({
      prompt: 'p',
      taskId: 'task_gemini_denied',
      sessionId: 's',
      initialBackend: 'gemini',
    });

    // Queued, not failed — and nothing ran unrestricted.
    expect(exec.deferred).toBe(true);
    expect(spawns).toBe(0);
  });
});

describe('a harness error is not a product failure (D3)', () => {
  it('leaves the task awaiting verification and never bounces it to the builder', async () => {
    const task = await createTask({
      title: 'Judge crashed',
      assignedTo: 'developer',
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      acceptanceCriteria: ['It works'],
    });

    await applyVerdict(verdictFor(task.id, 'error'));

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('awaiting-verification');
    expect(after?.verificationStatus).toBe('unverified');
    expect(after?.completedAt).toBeNull();

    const message = (await getInbox()).messages.filter((m) => m.taskId === task.id).at(-1);
    expect(message?.subject).toBe('Harness error: Judge crashed');
    expect(message?.subject).not.toContain('Verification failed');
    expect(message?.body).toContain('says NOTHING about the work');

    const events = (await getActivityLog()).events.filter((e) => e.taskId === task.id);
    expect(events.some((e) => e.type === 'task_completed')).toBe(false);
  });
});
