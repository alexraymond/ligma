import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectShape } from '@ligma/api';
import { panelTransports, transportRoster } from '../harness/panel';
import {
  consumeAnsweredCapCards,
  consumeAnsweredFollowUps,
  handleBuilderCompletion,
  isVerifiable,
  maxVerificationAttempts,
  pruneVerificationEvidence,
  reportVerificationCapReached,
  spawnJourneyRun,
  spawnVerificationRun,
} from '../harness/verdict';
import { pruneCheckpointsForTasks } from './checkpoints';
import { toolsForRole } from './config';
import { withFileLockAsync, writeJsonAtomic } from './file-lock';
import type { HealthMonitor } from './health';
import { logger } from './logger';
import { OutputWriter } from './output-writer';
import {
  buildScheduledPrompt,
  buildTaskPrompt,
  getPendingTasks,
  getTask,
  isTaskUnblocked,
  pendingDecisionBlock,
  recordBuilderReport,
} from './prompt-builder';
import {
  canSpawn,
  claimSpawn,
  recordAvailabilityFailure,
  recordSpawnOutcome,
  recordSuccess,
  refundSpawn,
  remainingForRole,
  resolveRoleBackend,
} from './quota-governor';
import {
  type AgentRunner,
  BACKEND_ROTATION,
  buildBackendChain,
  canBackendHonorRestrictions,
  modelForBackend,
} from './runner';
import { writeSmokeDigest } from './smoke';
import { bootGateFailure, builderCwd, reportBootGate } from './task-env';
import type { Backend, DaemonConfig, GovernorRole, SpawnResult } from './types';

import { DATA_DIR } from '../paths';
const RETRY_QUEUE_FILE = path.join(DATA_DIR, 'daemon-retry-queue.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
const ACTIVE_RUNS_FILE = path.join(DATA_DIR, 'active-runs.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const MAX_RETRY_DELAY_MINUTES = 60;

/**
 * Projects the human paused in the UI. Read once per poll cycle, not once per
 * task — a broken projects.json must not stop all dispatch and this check must
 * never crash the poll loop, so unreadable/missing/corrupt content fails open
 * to an empty set rather than blocking (or pausing) everything.
 */
export function getPausedProjectIds(): Set<string> {
  try {
    const raw = readFileSync(PROJECTS_FILE, 'utf-8');
    const data = JSON.parse(raw) as { projects?: Array<{ id?: string; status?: string }> };
    const paused = new Set<string>();
    for (const p of data.projects ?? []) {
      if (p && p.status === 'paused' && typeof p.id === 'string') paused.add(p.id);
    }
    return paused;
  } catch {
    return new Set();
  }
}

/**
 * id → shape, for the verification admission arithmetic. Same fail-open rule as
 * `getPausedProjectIds`, and the same default `taskShape` uses in the run itself:
 * an unknown project is costed as "ui", the most expensive panel, so a missing
 * shape can never make a run look cheaper than it is.
 */
export function getProjectShapes(): Map<string, ProjectShape> {
  try {
    const data = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8')) as {
      projects?: Array<{ id?: string; shape?: ProjectShape }>;
    };
    const shapes = new Map<string, ProjectShape>();
    for (const p of data.projects ?? []) {
      if (p && typeof p.id === 'string' && p.shape) shapes.set(p.id, p.shape);
    }
    return shapes;
  } catch {
    return new Map();
  }
}

/**
 * How many persona sessions one verification run of this shape will spawn.
 *
 * Read off the very functions the run uses (`panelTransports`, `transportRoster`)
 * rather than a constant, so the door's arithmetic cannot drift from the roster
 * behind it. `servesHttp` is passed as true and does not matter: it picks WHICH
 * headless transport a run gets, never how many personas staff it, so the count
 * is identical either way and no boot recipe has to be read here.
 *
 * The judge is NOT included — callers add it, because the judge is the one slot
 * the dispatcher claims up front.
 */
export function verificationRosterSize(shape: ProjectShape, naiveRuns: number): number {
  return panelTransports(shape, [], true).reduce(
    (n, transport) =>
      n + transportRoster(transport, { smoke: false, naiveRuns, kind: 'acceptance' }).length,
    0,
  );
}

/**
 * How many of the parallel-agent slots builders may take.
 *
 * Builders and verifications drew from the same pool with builders going first,
 * so a full board of builds structurally starved the thing that finishes builds
 * (execution-flow-review M2: 19 cycles of "awaiting verification but no slots").
 * One slot is held back the moment anything is waiting to be verified.
 */
export function builderSlotCap(maxParallelAgents: number, awaitingVerification: number): number {
  return Math.max(0, awaitingVerification > 0 ? maxParallelAgents - 1 : maxParallelAgents);
}

/**
 * Forget the durable-phase notes of tasks that have nothing left to resume.
 *
 * Swept once per poll cycle rather than hooked onto a transition, because there
 * is no single transition to hook: a task reaches `done` in two places, both in
 * harness/verdict.ts — `handleBuilderCompletion` waives a task with no criteria
 * (in this process), and `applyVerdict` marks a passed one done inside the
 * spawned verification child (another process entirely). One sweep here catches
 * both, plus anything a human moved by hand, and costs a read when there is
 * nothing to drop. Same shape and the same call site as
 * `pruneVerificationEvidence`.
 *
 * Never throws: a poll cycle must not die over housekeeping.
 */
export function pruneCheckpointsForDoneTasks(): number {
  // A fresh install has no tasks.json, so there is nothing done to prune for —
  // reading it anyway is one of the WARN lines a healthy empty install used to
  // greet its owner with on the first poll (P22).
  if (!existsSync(TASKS_FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
      tasks: Array<{ id: string; kanban: string }>;
    };
    return pruneCheckpointsForTasks(data.tasks.filter((t) => t.kanban === 'done').map((t) => t.id));
  } catch (err) {
    logger.warn(
      'dispatcher',
      `Could not prune checkpoints for done tasks: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * Apply answered decision cards NOW, outside the poll cycle (S6, fixes P16).
 *
 * `consumeAnsweredCapCards` only ever ran on the dispatcher's poll tick, so
 * answering "Send back to the builder" and then watching the task showed 4½
 * minutes of "answered, and nothing moved". The answer route calls this straight
 * after the answer is written; the poll cycle stays the backstop, so an answer
 * written by anything else (CLI, MCP, a second process) still lands.
 *
 * Never throws: an answer that is already recorded must not 500 on the caller
 * because the follow-up work stumbled.
 */
export async function consumeAnsweredCapCardsNow(): Promise<{
  capCards: number;
  followUps: number;
}> {
  let capCards = 0;
  let followUps = 0;
  try {
    capCards = await consumeAnsweredCapCards();
    followUps = await consumeAnsweredFollowUps();
    if (capCards > 0 || followUps > 0) {
      logger.info(
        'dispatcher',
        `Applied ${capCards} answered cap card(s) and ${followUps} follow-up(s) on answer`,
      );
    }
  } catch (err) {
    logger.error(
      'dispatcher',
      `Failed to apply answered decisions: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { capCards, followUps };
}

// ─── Retry Queue ────────────────────────────────────────────────────────────

interface RetryEntry {
  taskId: string;
  agentId: string;
  retryAt: string; // ISO timestamp — when this retry becomes eligible
  attempt: number; // 1-based attempt number (1 = first retry)
  failedAt: string; // ISO timestamp — when the failure occurred
  error: string | null;
}

/**
 * A task the human deferred from the Runs surface is not dispatchable until its
 * time passes. Past the time it simply becomes normal work again — the field is
 * a wait, not a state, so nothing has to un-set it for the task to run.
 */
export function isDeferred(
  task: { deferredUntil?: string | null },
  now: number = Date.now(),
): boolean {
  if (!task.deferredUntil) return false;
  const at = new Date(task.deferredUntil).getTime();
  // An unparseable value must not strand the task forever.
  return !Number.isNaN(at) && at > now;
}

interface ActiveRunsData {
  runs?: Array<{
    taskId?: string | null;
    status?: string;
  }>;
}

// ─── Task Dispatcher ─────────────────────────────────────────────────────────

export class Dispatcher {
  private config: DaemonConfig;
  private runner: AgentRunner;
  private health: HealthMonitor;
  private retryQueue: RetryEntry[] = [];
  /** A poll cycle is running right now. */
  private polling = false;
  /** One trigger arrived mid-cycle and is owed a cycle when this one ends. */
  private pollQueued = false;
  /** Consecutive availability failures for the currently effective backend. */
  private backendFailureStreak = 0;
  /** The backend currently used for claude-mode work. Rotates on persistent failures. */
  private effectiveClaudeBackend: 'claude' | 'codex' | 'gemini' = 'claude';

  constructor(config: DaemonConfig, runner: AgentRunner, health: HealthMonitor) {
    this.config = config;
    this.runner = runner;
    this.health = health;
    this.loadRetryQueue();
  }

  updateConfig(config: DaemonConfig): void {
    this.config = config;
    if (!this.config.execution.claudeAutoFailoverEnabled) {
      this.backendFailureStreak = 0;
      this.effectiveClaudeBackend = 'claude';
    }
  }

  // ─── Retry Queue Persistence ────────────────────────────────────────────

  private loadRetryQueue(): void {
    try {
      if (!existsSync(RETRY_QUEUE_FILE)) return;
      const raw = readFileSync(RETRY_QUEUE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.retryQueue = data;
        logger.info('dispatcher', `Loaded ${data.length} pending retry(ies) from disk`);
      }
    } catch {
      logger.warn('dispatcher', 'Failed to load retry queue — starting fresh');
      this.retryQueue = [];
    }
  }

  private saveRetryQueue(): void {
    try {
      writeJsonAtomic(RETRY_QUEUE_FILE, this.retryQueue);
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to persist retry queue: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Forget every pending retry for a task that has settled.
   *
   * A retry queued when a build failed used to fire even after a LATER run had
   * completed the task: observed starting a builder retry and a verification run
   * for the same task in the same tick — a second builder writing into the repo
   * the harness was snapshotting (P7/S5). Terminal settles happen in three
   * places and two processes (`handleBuilderCompletion` here, `applyVerdict` in
   * the verification child, `run-task.ts` standalone), so this is called on the
   * settle we can see, and `processDueRetries` re-checks the board at fire time
   * for the ones we cannot.
   */
  private dropRetries(taskId: string, why: string): void {
    if (!this.retryQueue.some((r) => r.taskId === taskId)) return;
    this.retryQueue = this.retryQueue.filter((r) => r.taskId !== taskId);
    this.saveRetryQueue();
    logger.info('dispatcher', `Dropped pending retry(ies) for ${taskId} — ${why}`);
  }

  /**
   * Calculate retry delay with exponential backoff.
   * delay = retryDelayMinutes * 2^(attempt-1), capped at MAX_RETRY_DELAY_MINUTES
   */
  private getRetryDelayMinutes(attempt: number): number {
    const base = this.config.execution.retryDelayMinutes;
    return Math.min(base * 2 ** (attempt - 1), MAX_RETRY_DELAY_MINUTES);
  }

  private isClaudeAvailabilityFailure(text: string): boolean {
    const patterns = [
      /claude binary not found/i,
      /not found.*claude/i,
      /rate limit/i,
      /\b429\b/,
      /quota/i,
      /credit/i,
      /service unavailable/i,
      /temporarily unavailable/i,
      /overloaded|overload/i,
      /authentication failed/i,
      /unauthorized/i,
      /invalid api key/i,
      /invalid.*token/i,
      /api key/i,
      /failed to connect|connection refused|network error/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isBackendAvailabilityFailure(
    backend: 'claude' | 'codex' | 'gemini',
    text: string,
  ): boolean {
    if (backend === 'claude') return this.isClaudeAvailabilityFailure(text);
    const patterns = [
      new RegExp(`${backend}\\s+binary\\s+not\\s+found`, 'i'),
      new RegExp(`not\\s+found.*${backend}`, 'i'),
      /rate limit/i,
      /\b429\b/,
      /quota/i,
      /credit/i,
      /service unavailable/i,
      /temporarily unavailable/i,
      /overloaded|overload/i,
      /authentication failed/i,
      /unauthorized/i,
      /invalid api key/i,
      /invalid.*token/i,
      /api key/i,
      /failed to connect|connection refused|network error/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private isLikelyCliInitFailure(
    backend: 'claude' | 'codex' | 'gemini',
    result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean },
  ): boolean {
    if (result.timedOut || result.exitCode === 0) return false;
    if (result.stderr.trim().length > 0) return false;
    if (!/"subtype":"init"/.test(result.stdout)) return false;
    // Claude frequently fails this way when account/capacity is unavailable:
    // init event appears, then process exits with code 1 and no diagnostic stderr.
    return backend === 'claude';
  }

  private async spawnTaskWithFallback(opts: {
    prompt: string;
    taskId: string;
    sessionId: string;
    /** The task's project repo, or "" for ligma-self (the runner's own default). */
    cwd: string;
    initialBackend: 'claude' | 'codex' | 'gemini';
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
  }): Promise<{
    result: Awaited<ReturnType<AgentRunner['spawnAgent']>>;
    backend: 'claude' | 'codex' | 'gemini';
    /**
     * True only when WE stopped the chain because the governor said no. The
     * spawned CLI's own exit code can never mean this — a claude/codex/gemini
     * process exiting 3 for a usage or auth error is a failure, not a deferral.
     */
    deferred: boolean;
  }> {
    // D7: `role` is what selects the deny rules. Without it the runner uses its
    // loose default and the builder can read data/tasks.json — the whole
    // acceptanceCriteria list, holdouts included.
    const restriction = {
      allowedTools: toolsForRole('builder'),
      skipPermissions: this.config.execution.skipPermissions,
    };

    const spawn = (backend: Backend): ReturnType<AgentRunner['spawnAgent']> =>
      this.runner.spawnAgent({
        prompt: opts.prompt,
        maxTurns: this.config.execution.maxTurns,
        timeoutMinutes: this.config.execution.timeoutMinutes,
        ...restriction,
        role: 'builder',
        onSpawnPid: (pid) => this.health.updateSessionPid(opts.sessionId, pid),
        onStdoutChunk: opts.onStdoutChunk,
        onStderrChunk: opts.onStderrChunk,
        backend,
        model: modelForBackend(backend, this.config.execution.workerModel),
        codexModel: this.config.execution.codexModel,
        geminiModel: this.config.execution.geminiModel,
        // The product's own repo when the task has one; "" is the ligma-self
        // default. The deny set above is absolute paths into data/, so it is
        // enforced identically whichever tree the builder is standing in.
        cwd: opts.cwd,
      });

    // D8/P21: a backend that cannot express the restriction throws rather than
    // spawn unrestricted, so it must be SKIPPED here, not attempted. Before this,
    // a claude rate limit with claudeAutoFailoverBackend "gemini" stopped work
    // dead instead of rotating.
    const chain = buildBackendChain(opts.initialBackend, {
      enabled: this.config.execution.claudeAutoFailoverEnabled,
      preferred: this.config.execution.claudeAutoFailoverBackend,
    }).filter((b) => {
      if (canBackendHonorRestrictions(b, restriction)) return true;
      logger.warn(
        'dispatcher',
        `Skipping backend ${b} for task ${opts.taskId}: it cannot honour allowedTools=[${restriction.allowedTools.join(', ')}] with skipPermissions=${restriction.skipPermissions}`,
      );
      return false;
    });

    const unrun = { exitCode: null, stdout: '', stderr: '', timedOut: false, pid: 0 };

    if (chain.length === 0) {
      // Fail closed and stay queued: never a failure the builder gets blamed for,
      // and never an unrestricted spawn. The gate's booking is handed back — it
      // will never be spent (E13).
      refundSpawn('builder', opts.taskId, opts.initialBackend);
      await this.reportNoUsableBackend(opts.taskId, restriction);
      return { result: unrun, backend: opts.initialBackend, deferred: true };
    }

    let backend = chain[0];
    if (backend !== opts.initialBackend) {
      // The caller's gate booked the backend it chose, and that backend was just
      // filtered out of the chain — the booking is orphaned and must go back
      // before we book the one we will actually spawn, or every such dispatch
      // leaves a phantom entry in the ledger (E13).
      refundSpawn('builder', opts.taskId, opts.initialBackend);
      const gate = claimSpawn('builder', { backend, ref: opts.taskId });
      if (!gate.allowed) {
        this.logGovernorDeferral(
          `task ${opts.taskId} on ${backend} (its chosen backend cannot be restricted)`,
          gate,
        );
        return { result: unrun, backend, deferred: true };
      }
    }

    let result = await spawn(backend);
    if (result.pid > 0) {
      this.health.updateSessionPid(opts.sessionId, result.pid);
    }
    this.recordBackendOutcome(backend, result, { role: 'builder', ref: opts.taskId });

    for (let i = 1; i < chain.length; i++) {
      if (result.exitCode === 0 && !result.timedOut) break;
      const combined = `${result.stderr}\n${result.stdout}`;
      if (
        !this.isBackendAvailabilityFailure(backend, combined) &&
        !this.isLikelyCliInitFailure(backend, result)
      ) {
        break;
      }

      const nextBackend = chain[i];
      // D10: a fallback is another spawn, so it passes the governor like any
      // other. On denial the chain stops and the task defers — re-queued without
      // counting a failure.
      const gate = claimSpawn('builder', { backend: nextBackend, ref: opts.taskId });
      if (!gate.allowed) {
        this.logGovernorDeferral(`fallback of task ${opts.taskId} to ${nextBackend}`, gate);
        return { result, backend, deferred: true };
      }

      logger.warn(
        'dispatcher',
        `Backend ${backend} unavailable; retrying task ${opts.taskId} on ${nextBackend}`,
      );
      backend = nextBackend;
      result = await spawn(backend);
      if (result.pid > 0) {
        this.health.updateSessionPid(opts.sessionId, result.pid);
      }
      this.recordBackendOutcome(backend, result, { role: 'builder', ref: opts.taskId });
    }

    return { result, backend, deferred: false };
  }

  /**
   * No configured backend can run this task with its restriction intact. Unlike a
   * quota deferral this never resolves on its own — it needs a config change — so
   * it is said out loud once, not merely logged into a rotating file.
   */
  private async reportNoUsableBackend(
    taskId: string,
    restriction: { allowedTools: string[]; skipPermissions: boolean },
  ): Promise<void> {
    const marker = 'no backend can run this task with its restriction intact';
    const body = `${marker}: allowedTools=[${restriction.allowedTools.join(', ')}], skipPermissions=${restriction.skipPermissions}.\n\nThe task is queued, NOT failed, and nothing was spawned unrestricted. Route the builder to claude (execution.governor.roleRouting.builder), or change the tool grant.`;
    logger.error('dispatcher', `Task ${taskId} deferred — ${marker}`);

    try {
      await withFileLockAsync('inbox', async () => {
        const raw = existsSync(INBOX_FILE) ? readFileSync(INBOX_FILE, 'utf-8') : '{"messages":[]}';
        const data = JSON.parse(raw) as { messages: Array<Record<string, unknown>> };
        // Once per task, not once per poll cycle.
        if (
          data.messages.some(
            (m) => m.taskId === taskId && typeof m.body === 'string' && m.body.includes(marker),
          )
        )
          return;
        data.messages.push({
          id: `msg_${Date.now()}`,
          from: 'system',
          to: 'me',
          type: 'report',
          taskId,
          subject: `Blocked: ${getTask(taskId)?.title ?? taskId}`,
          body,
          status: 'unread',
          createdAt: new Date().toISOString(),
          readAt: null,
        });
        writeJsonAtomic(INBOX_FILE, data);
      });
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to report unusable backends for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Track backend availability outcomes and rotate to the next backend
   * when consecutive failures exceed the configured threshold.
   * Rotation cycle: claude → gemini → codex → claude → ...
   *
   * Also the single place real 429s reach the quota governor's cooling state —
   * that happens regardless of the rotation setting, because a rate-limited
   * backend is rate-limited whether or not we failover away from it.
   *
   * And the single place the ledger learns what a daemon-dispatched spawn cost.
   * `recordSpawnOutcome` used to be called only from `run-task.ts`, so every
   * builder the DAEMON dispatched left a blank duration/token entry behind (E20).
   * `booking` is required rather than optional for that reason: a new spawn site
   * cannot forget to annotate the slot it claimed.
   */
  private recordBackendOutcome(
    backend: 'claude' | 'codex' | 'gemini',
    result: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    } & Partial<Pick<SpawnResult, 'durationMs' | 'tokensIn' | 'tokensOut'>>,
    booking: { role: GovernorRole; ref: string },
  ): void {
    recordSpawnOutcome(booking.role, booking.ref, backend, {
      durationMs: result.durationMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    const clean = result.exitCode === 0 && !result.timedOut;
    const availability =
      !clean &&
      (this.isBackendAvailabilityFailure(backend, `${result.stderr}\n${result.stdout}`) ||
        this.isLikelyCliInitFailure(backend, result));

    if (clean) recordSuccess(backend);
    else if (availability) recordAvailabilityFailure(backend);

    if (!this.config.execution.claudeAutoFailoverEnabled) return;

    // Only track the currently effective backend — per-task fallbacks don't affect rotation
    if (backend !== this.effectiveClaudeBackend) return;

    if (clean || !availability) {
      // Clean run, or a task-level failure that says nothing about availability.
      this.backendFailureStreak = 0;
      return;
    }

    this.backendFailureStreak += 1;
    const threshold = this.config.execution.claudeAutoFailoverThreshold;
    logger.warn(
      'dispatcher',
      `Backend ${backend} availability failure (${this.backendFailureStreak}/${threshold})`,
    );

    if (this.backendFailureStreak >= threshold) {
      const rotation = BACKEND_ROTATION;
      const currentIdx = rotation.indexOf(this.effectiveClaudeBackend);
      const nextIdx = (currentIdx + 1) % rotation.length;
      const next = rotation[nextIdx];
      logger.warn('dispatcher', `Backend rotation: ${this.effectiveClaudeBackend} → ${next}`);
      this.effectiveClaudeBackend = next;
      this.backendFailureStreak = 0;
    }
  }

  private resolveBackendForTask(taskTags: string[] | undefined): 'claude' | 'codex' | 'gemini' {
    // Governor routing wins when it points somewhere other than claude: the
    // point of routing a role off claude is to stop spending the subscription.
    const routed = resolveRoleBackend('builder');
    if (routed !== 'claude') {
      logger.info(
        'dispatcher',
        `Governor roleRouting.builder=${routed} overrides backendMode=${this.config.execution.backendMode}`,
      );
      return routed;
    }

    const mode = this.config.execution.backendMode;
    if (mode === 'codex' || mode === 'gemini') return mode;
    if (mode === 'claude') return this.effectiveClaudeBackend;

    // Mixed mode — check task tags first, then fall back to effective backend
    const normalizedTaskTags = new Set((taskTags ?? []).map((t) => t.toLowerCase()));
    const codexTags = this.config.execution.codexTaskTags ?? [];
    const geminiTags = this.config.execution.geminiTaskTags ?? [];

    if (codexTags.some((tag) => normalizedTaskTags.has(tag.toLowerCase()))) return 'codex';
    if (geminiTags.some((tag) => normalizedTaskTags.has(tag.toLowerCase()))) return 'gemini';
    return this.effectiveClaudeBackend;
  }

  private resolveBackendForNonTask(): 'claude' | 'codex' | 'gemini' {
    const routed = resolveRoleBackend('scheduled');
    if (routed !== 'claude') return routed;
    const mode = this.config.execution.backendMode;
    if (mode === 'codex' || mode === 'gemini') return mode;
    return this.effectiveClaudeBackend;
  }

  /**
   * The quota gate for one builder spawn. Records the spawn when allowed, so the
   * ledger is written in the same tick as the decision — two tasks in one cycle
   * cannot both see the last free slot.
   */
  private gateBuilder(
    taskId: string,
    tags: string[] | undefined,
  ): {
    decision: ReturnType<typeof canSpawn>;
    backend: Backend;
  } {
    const backend = this.resolveBackendForTask(tags);
    // claimSpawn decides and books atomically — two processes cannot both take
    // the last slot.
    const decision = claimSpawn('builder', { backend, ref: taskId });
    return { decision, backend };
  }

  private logGovernorDeferral(what: string, decision: ReturnType<typeof canSpawn>): void {
    if (decision.allowed) return;
    logger.warn(
      'dispatcher',
      `Quota governor deferred ${what}: ${decision.reason} — retry in ${Math.round(decision.retryInMs / 1000)}s (work stays queued)`,
    );
  }

  /**
   * Reset stale in-progress tasks that have no matching live session/run.
   * This prevents dependency chains from getting stuck forever after crashes/restarts.
   */
  private async reconcileStaleInProgressTasks(): Promise<void> {
    // A fresh install has no tasks.json until the first write, and there is
    // nothing to reconcile. Reading it anyway is how a healthy empty install
    // announced itself with two ERROR lines on its very first poll (P22).
    if (!existsSync(TASKS_FILE)) return;

    try {
      const runningTaskIds = new Set<string>();
      const sessions = this.health.getActiveSessions();
      for (const s of sessions) {
        if (s.taskId) runningTaskIds.add(s.taskId);
      }

      if (existsSync(ACTIVE_RUNS_FILE)) {
        try {
          const activeRuns = JSON.parse(readFileSync(ACTIVE_RUNS_FILE, 'utf-8')) as ActiveRunsData;
          for (const run of activeRuns.runs ?? []) {
            if (
              run.status === 'running' &&
              typeof run.taskId === 'string' &&
              run.taskId.length > 0
            ) {
              runningTaskIds.add(run.taskId);
            }
          }
        } catch {
          // Ignore malformed active-runs file; session map is still authoritative.
        }
      }

      let resetCount = 0;
      await withFileLockAsync('tasks', async () => {
        const tasksRaw = readFileSync(TASKS_FILE, 'utf-8');
        const tasksData = JSON.parse(tasksRaw) as {
          tasks: Array<{
            id: string;
            kanban: string;
            assignedTo?: string | null;
            updatedAt?: string;
          }>;
        };

        for (const task of tasksData.tasks) {
          if (task.kanban !== 'in-progress') continue;
          if (!task.assignedTo || task.assignedTo === 'me') continue;
          if (runningTaskIds.has(task.id)) continue;

          task.kanban = 'not-started';
          task.updatedAt = new Date().toISOString();
          resetCount += 1;
        }

        if (resetCount > 0) {
          writeJsonAtomic(TASKS_FILE, tasksData);
        }
      });

      if (resetCount > 0) {
        logger.warn(
          'dispatcher',
          `Reset ${resetCount} stale in-progress task(s) with no active session/run`,
        );
      }
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed stale in-progress reconciliation: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────────

  /**
   * Poll for pending tasks and dispatch them to agents.
   * Also processes due retries from the persistent queue.
   * Called on each polling interval — and, since M6, immediately on a session
   * exit, so a dependency chain does not idle out the whole interval at every
   * handover.
   *
   * Not reentrant: the whole body is check-then-act over tasks.json and the
   * governor ledger, so two overlapping cycles could both see the same free slot.
   * A poll that arrives during one is remembered (once — a queue of triggers for
   * the same state is still one trigger) and run after.
   */
  async pollAndDispatch(): Promise<void> {
    if (this.polling) {
      this.pollQueued = true;
      return;
    }
    this.polling = true;
    logger.info('dispatcher', 'Polling for pending tasks...');
    this.health.setLastPollAt(new Date().toISOString());

    try {
      // 0. Repair stale task status before dispatch decisions.
      await this.reconcileStaleInProgressTasks();

      // 0b. Apply whatever the human answered on "attempts exhausted" cards.
      //     Before dispatch, not after: an answer that re-queues a task or grants
      //     it a fresh round should take effect in THIS cycle, not the next one.
      const consumed = await consumeAnsweredCapCards();
      if (consumed > 0)
        logger.info('dispatcher', `Applied ${consumed} answered verification-cap card(s)`);

      // 0c. And the other answer that promises something: "Open a follow-up
      //     task" was offered on every judge card and handled nowhere (H8).
      const followUps = await consumeAnsweredFollowUps();
      if (followUps > 0)
        logger.info(
          'dispatcher',
          `Opened follow-up task(s) from ${followUps} answered decision(s)`,
        );

      // Read once per cycle, not once per task/retry — a project paused mid-cycle
      // takes effect next cycle, not mid-decision.
      const pausedProjectIds = getPausedProjectIds();

      // 1. Process due retries first (they have higher priority — already started once)
      await this.processDueRetries(pausedProjectIds);

      // 2. Dispatch builders for pending work.
      await this.dispatchPendingTasks(pausedProjectIds);

      // 3. Then pick up whatever the builders have already finished. Runs even
      //    when there was no pending work — an awaiting-verification task must
      //    not wait for an unrelated task to appear.
      await this.dispatchVerifications(pausedProjectIds);

      // Prune old output files and bulk verification evidence (72 hours)
      OutputWriter.prune(72 * 60 * 60 * 1000);
      pruneVerificationEvidence();
      pruneCheckpointsForDoneTasks();
    } catch (err) {
      logger.error('dispatcher', `Poll error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.polling = false;
      if (this.pollQueued) {
        this.pollQueued = false;
        void this.pollAndDispatch();
      }
    }
  }

  /**
   * Write down why each task is parked — or that it no longer is.
   *
   * The reason was already being computed and thrown away: the ≥3-pending-decision
   * park produced 413 log lines and not one pixel (execution-flow-review H4).
   * One locked pass for the whole cycle, and only when something actually
   * changed, so a steady state costs a read.
   */
  private async persistParkedReasons(reasons: Map<string, string | null>): Promise<void> {
    if (reasons.size === 0) return;
    try {
      await withFileLockAsync('tasks', async () => {
        const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
          tasks: Array<{ id: string; parkedReason?: string | null; updatedAt?: string }>;
        };
        let changed = 0;
        for (const task of data.tasks) {
          if (!reasons.has(task.id)) continue;
          const next = reasons.get(task.id) ?? null;
          if ((task.parkedReason ?? null) === next) continue;
          task.parkedReason = next;
          task.updatedAt = new Date().toISOString();
          changed += 1;
        }
        if (changed > 0) writeJsonAtomic(TASKS_FILE, data);
      });
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to persist park reasons: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** How many tasks are sitting in awaiting-verification right now (M2's reserve). */
  private awaitingVerificationCount(): number {
    try {
      const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
        tasks: Array<{ kanban: string; verificationStatus?: string }>;
      };
      return data.tasks.filter(
        (t) =>
          t.kanban === 'awaiting-verification' &&
          (t.verificationStatus ?? 'unverified') === 'unverified',
      ).length;
    } catch {
      // Unreadable ⇒ reserve nothing. Failing open here costs at most one builder
      // slot's worth of contention; failing closed would stop dispatch entirely.
      return 0;
    }
  }

  /** Dispatch builder sessions for not-started tasks, up to the concurrency limit. */
  private async dispatchPendingTasks(pausedProjectIds: Set<string>): Promise<void> {
    {
      // Get pending tasks sorted by Eisenhower priority
      const pendingTasks = getPendingTasks();

      if (pendingTasks.length === 0) {
        logger.debug('dispatcher', 'No pending tasks to dispatch');
        return;
      }

      logger.info('dispatcher', `Found ${pendingTasks.length} pending task(s)`);

      // What each task is parked ON, recorded as the filter decides it. Written
      // once at the end of the pass; null means "no longer parked", which is how
      // a lifted condition clears the field without anything having to un-set it.
      const parked = new Map<string, string | null>();

      // 3. Filter to dispatchable tasks
      const dispatchable = pendingTasks.filter((task) => {
        parked.set(task.id, null);
        // Already running?
        if (this.health.isTaskRunning(task.id)) {
          logger.debug('dispatcher', `Skipping ${task.id} — already running`);
          return false;
        }

        // Already in retry queue?
        if (this.retryQueue.some((r) => r.taskId === task.id)) {
          logger.debug('dispatcher', `Skipping ${task.id} — in retry queue`);
          return false;
        }

        // Deferred by the human from the Runs surface. The same "wait, then
        // pick it up" rule the retry queue enforces, carried on the task itself
        // so a deferral survives a restart and is visible where the work is.
        if (isDeferred(task as typeof task & { deferredUntil?: string | null })) {
          logger.debug('dispatcher', `Skipping ${task.id} — deferred`);
          return false;
        }

        // Project paused by the human in the UI? Running agents keep running —
        // this only gates new dispatch.
        if (task.projectId && pausedProjectIds.has(task.projectId)) {
          logger.debug('dispatcher', `Skipping ${task.id} — project ${task.projectId} is paused`);
          return false;
        }

        // Blocked by dependencies?
        const taskWithBlockedBy = task as typeof task & { blockedBy: string[] };
        if (!isTaskUnblocked(taskWithBlockedBy)) {
          logger.debug('dispatcher', `Skipping ${task.id} — blocked by dependencies`);
          return false;
        }

        // Has a decision pending that blocks the whole task? The reason is kept,
        // not just logged — it is the sentence the task panel shows (H4).
        const block = pendingDecisionBlock(task.id);
        if (block) {
          parked.set(task.id, `${block.reason} (${block.pending} pending)`);
          logger.debug('dispatcher', `Skipping ${task.id} — waiting for decision`);
          return false;
        }

        // Exceeded retry limit?
        const retryCount = this.health.getRetryCount(task.id);
        const maxAttempts = this.config.execution.retries + 1;
        if (retryCount >= maxAttempts) {
          parked.set(
            task.id,
            `${retryCount} of ${maxAttempts} attempts used — not being picked up again without a human`,
          );
          logger.warn(
            'dispatcher',
            `Skipping ${task.id} — exceeded retry limit (${retryCount} attempts)`,
          );
          return false;
        }

        return true;
      });

      await this.persistParkedReasons(parked);

      if (dispatchable.length === 0) {
        logger.debug(
          'dispatcher',
          'No dispatchable tasks (all blocked, running, or at retry limit)',
        );
        return;
      }

      // 4. Dispatch up to concurrency limit, minus the slot held back for
      //    verification whenever something is waiting to be verified (M2).
      const cap = builderSlotCap(
        this.config.concurrency.maxParallelAgents,
        this.awaitingVerificationCount(),
      );
      const availableSlots = cap - this.health.activeCount();
      if (availableSlots <= 0) {
        logger.info(
          'dispatcher',
          `No available builder slots (${this.health.activeCount()}/${cap} of ${this.config.concurrency.maxParallelAgents} agents running${cap < this.config.concurrency.maxParallelAgents ? ', one reserved for verification' : ''})`,
        );
        return;
      }

      const toDispatch = dispatchable.slice(0, availableSlots);

      // The governor gate. A denial is a queue, not a failure: the task keeps its
      // not-started status and the next poll cycle picks it up. Logged once per
      // cycle rather than once per task — six queued tasks are one fact.
      for (const task of toDispatch) {
        const { decision } = this.gateBuilder(task.id, task.tags);
        if (!decision.allowed) {
          this.logGovernorDeferral(
            `${toDispatch.length - toDispatch.indexOf(task)} pending task(s)`,
            decision,
          );
          break;
        }
        this.dispatchTask(task.id, task.assignedTo!, decision.backend);
      }
    }
  }

  // ─── Verification pickup ────────────────────────────────────────────────

  /**
   * Start acceptance runs for tasks the builder has finished.
   *
   * A verification occupies ONE concurrency slot even though it fans out into
   * several persona spawns internally — those respect harness.maxParallelPersonas
   * on their own. Counting them individually here would let one verification
   * starve the whole daemon.
   *
   * The QUOTA question is the opposite one, and C2 is where it was got wrong: a
   * run is a whole panel plus a judge, so admission is all-or-nothing against the
   * window's remaining autonomous budget. A run we cannot finish is worse than a
   * run we never start — it spends real sessions and retains no verdict.
   */
  private async dispatchVerifications(pausedProjectIds: Set<string>): Promise<void> {
    if (!this.config.execution.harness.autoVerify) return;
    // Nothing is awaiting verification before the first task exists. Same P22
    // guard as `reconcileStaleInProgressTasks` — this was the other half of the
    // pair of errors a clean install logged on its very first poll.
    if (!existsSync(TASKS_FILE)) return;

    let candidates: Array<{ id: string; projectId: string | null }> = [];
    try {
      const tasksData = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
        tasks: Array<{
          id: string;
          kanban: string;
          projectId?: string | null;
          verificationStatus?: string;
          verificationAttempts?: number;
          deferredUntil?: string | null;
        }>;
      };
      const max = maxVerificationAttempts();
      const awaiting = tasksData.tasks.filter(
        (t) =>
          t.kanban === 'awaiting-verification' &&
          (t.verificationStatus ?? 'unverified') === 'unverified',
      );

      // D4: past the cap a task stops being selected — otherwise a task the
      // harness cannot verify is respawned every poll cycle, forever.
      for (const t of awaiting.filter((t) => (t.verificationAttempts ?? 0) >= max)) {
        if (await reportVerificationCapReached(t.id, t.verificationAttempts ?? 0, max)) {
          logger.warn(
            'dispatcher',
            `Task ${t.id} hit the verification attempt cap (${t.verificationAttempts}/${max}) — reported and parked`,
          );
        }
      }

      candidates = awaiting
        .filter((t) => (t.verificationAttempts ?? 0) < max)
        .filter((t) => {
          // M1: verification is the expensive half of the pipeline, and it used
          // to ignore both of the builder side's own skips — so pausing a
          // project did not stop its quota burn, and a deferred task was
          // verified anyway.
          if (t.projectId && pausedProjectIds.has(t.projectId)) {
            logger.debug(
              'dispatcher',
              `Skipping verification of ${t.id} — project ${t.projectId} is paused`,
            );
            return false;
          }
          if (isDeferred(t)) {
            logger.debug('dispatcher', `Skipping verification of ${t.id} — deferred`);
            return false;
          }
          return true;
        })
        .map((t) => ({ id: t.id, projectId: t.projectId ?? null }));
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to scan for verifiable tasks: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (candidates.length === 0) return;

    const slots = this.config.concurrency.maxParallelAgents - this.health.activeCount();
    if (slots <= 0) {
      logger.info(
        'dispatcher',
        `${candidates.length} task(s) awaiting verification but no concurrency slots`,
      );
      return;
    }

    const shapes = getProjectShapes();
    const naiveRuns = this.config.execution.harness.naiveUserRuns;
    // What the window will still lend the autonomous side. Infinity when the
    // governor is off or the judge is routed off the metered backend.
    const budget = remainingForRole('judge');
    // Sessions this cycle has already committed the window to.
    let admitted = 0;

    let started = 0;
    for (const task of candidates) {
      if (started >= slots) break;
      // No contract ⇒ no oracle ⇒ nothing to verify against.
      if (!isVerifiable(task.id)) continue;

      // The whole run: every persona the shape's roster staffs, plus the judge.
      const cost = verificationRosterSize(shapes.get(task.projectId ?? '') ?? 'ui', naiveRuns) + 1;
      if (admitted + cost > budget) {
        // Exactly the existing governor deferral: logged, consuming nothing, the
        // task keeps its awaiting-verification status for the next cycle.
        const held = candidates.length - candidates.indexOf(task);
        logger.warn(
          'dispatcher',
          `Quota governor deferred ${held} task(s) awaiting verification: one run of this shape needs ${cost} session(s) ` +
            `and the window has ${budget - admitted} left for autonomy (work stays queued)`,
        );
        break;
      }

      // The judge's slot, claimed before the panel exists and threaded into the
      // child. Claiming it last is how one run spent 13 persona sessions over 50
      // minutes and then starved on the judge, retaining no verdict at all.
      const judge = claimSpawn('judge', { ref: task.id });
      if (!judge.allowed) {
        this.logGovernorDeferral(
          `${candidates.length - candidates.indexOf(task)} task(s) awaiting verification`,
          judge,
        );
        break;
      }
      admitted += cost;

      const sessionId = this.health.startSession('system', task.id, 'verify', 0);
      logger.info(
        'dispatcher',
        `Starting verification run for ${task.id} (${cost} session(s) admitted)`,
      );
      const child = await spawnVerificationRun(task.id, { judgeSlot: judge.backend });
      // Without the real pid, shutdown's kill loop and the stale-session sweep
      // both skip this session, orphaning its worktree, dev server and browser.
      if (child.pid && child.pid > 0) this.health.updateSessionPid(sessionId, child.pid);
      started += 1;

      child.on('exit', (code) => {
        this.health.endSession(
          sessionId,
          code,
          code === 0 ? null : `verification exited ${code}`,
          false,
        );
        logger.info('dispatcher', `Verification run for ${task.id} exited ${code}`);
        // M6: a chain transition used to wait out the full poll interval — ~16
        // minutes of dead time on an 8-task chain. The guard in pollAndDispatch
        // keeps this to one pending trigger, never a reentrant poll.
        void this.pollAndDispatch();
      });
      child.on('error', (err) => {
        this.health.endSession(sessionId, 1, err.message, false);
        // The child never started, so nothing in it can hand the judge slot back.
        refundSpawn('judge', task.id, judge.backend);
        logger.error(
          'dispatcher',
          `Verification run for ${task.id} failed to start: ${err.message}`,
        );
      });
    }
  }

  /**
   * Process retry entries that are due (retryAt <= now).
   */
  private async processDueRetries(pausedProjectIds: Set<string>): Promise<void> {
    if (this.retryQueue.length === 0) return;

    const now = new Date();
    const dueRetries: RetryEntry[] = [];
    const remaining: RetryEntry[] = [];

    for (const entry of this.retryQueue) {
      if (new Date(entry.retryAt) <= now) {
        dueRetries.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    if (dueRetries.length === 0) return;

    // A paused project's retry stays in the queue untouched — still due, it
    // runs once the project unpauses.
    const pausedRetries: RetryEntry[] = [];
    const readyRetries: RetryEntry[] = [];
    for (const entry of dueRetries) {
      const task = getTask(entry.taskId);
      // S5/P7: the board is re-read HERE, at fire time, not trusted from when
      // the entry was queued. A task that has since been deleted, completed, or
      // is already running/awaiting verification must not get a second builder;
      // the entry is simply dropped (it is already out of `this.retryQueue`).
      if (!task) {
        logger.info('dispatcher', `Dropping retry of ${entry.taskId} — the task no longer exists`);
        continue;
      }
      if (task.kanban !== 'not-started') {
        logger.info(
          'dispatcher',
          `Dropping retry of ${entry.taskId} — it has since settled (${task.kanban})`,
        );
        continue;
      }
      const projectId = task.projectId;
      if (projectId && pausedProjectIds.has(projectId)) {
        logger.debug(
          'dispatcher',
          `Skipping retry of ${entry.taskId} — project ${projectId} is paused`,
        );
        pausedRetries.push(entry);
      } else {
        readyRetries.push(entry);
      }
    }

    // Check available concurrency slots
    const availableSlots = this.config.concurrency.maxParallelAgents - this.health.activeCount();
    const toRetry = readyRetries.slice(0, Math.max(0, availableSlots));
    const deferred = readyRetries.slice(Math.max(0, availableSlots));

    // Update queue: remove retries we're about to dispatch. Paused-project
    // entries go back untouched, alongside the not-yet-due ones.
    this.retryQueue = [...remaining, ...pausedRetries, ...deferred];
    this.saveRetryQueue();

    for (const entry of toRetry) {
      const { decision } = this.gateBuilder(entry.taskId, getTask(entry.taskId)?.tags);
      if (!decision.allowed) {
        // Put the untried retries back — a governor denial must not consume an attempt.
        const idx = toRetry.indexOf(entry);
        this.retryQueue = [...this.retryQueue, ...toRetry.slice(idx)];
        this.saveRetryQueue();
        this.logGovernorDeferral(`${toRetry.length - idx} due retry(ies)`, decision);
        break;
      }
      logger.info(
        'dispatcher',
        `Retrying task ${entry.taskId} (attempt ${entry.attempt + 1}, agent=${entry.agentId})`,
      );
      this.dispatchTask(entry.taskId, entry.agentId, decision.backend);
    }

    if (deferred.length > 0) {
      logger.info(
        'dispatcher',
        `${deferred.length} due retry(ies) deferred — no concurrency slots available`,
      );
    }
  }

  /**
   * Dispatch a single task to its assigned agent.
   */
  private async dispatchTask(taskId: string, agentId: string, backend: Backend): Promise<void> {
    const runId = `run_${Date.now()}_${taskId}`;
    const writer = new OutputWriter(runId);
    // gateBuilder already booked this slot in the ledger before dispatchTask was
    // even called. Everything up to the real spawn can still fail (a bad prompt
    // build, a missing task) — flip this once the spawn is actually attempted so
    // the catch below knows whether the booked slot was ever spent.
    let spawnAttempted = false;
    // Started as soon as we have a task, not after the prompt is built, so a
    // failure while building the prompt still lands in health history — the
    // retry queue's backoff (getRetryCount) reads its attempt count from there.
    let sessionId: string | null = null;

    try {
      logger.info('dispatcher', `Dispatching task ${taskId} to agent "${agentId}"`);

      // Build task data for prompt (re-read to get fresh state)
      const task = getTask(taskId);
      if (!task) {
        logger.error('dispatcher', `Task ${taskId} not found`);
        writer.close();
        refundSpawn('builder', taskId, backend);
        return;
      }

      sessionId = this.health.startSession(agentId, taskId, 'task', 0);

      const prompt = buildTaskPrompt(agentId, task);
      await this.markTaskInProgress(taskId);

      const cwd = builderCwd(task.projectId);
      if (cwd) logger.info('dispatcher', `Task ${taskId} builds in ${cwd}`);

      spawnAttempted = true;
      const exec = await this.spawnTaskWithFallback({
        prompt,
        taskId,
        sessionId,
        cwd,
        initialBackend: backend,
        onStdoutChunk: (chunk) => writer.append('stdout', chunk),
        onStderrChunk: (chunk) => writer.append('stderr', chunk),
      });

      writer.close();

      // Gated by the governor, not broken: no retry counted, no failed status,
      // task goes back on the queue. Read from our own decision — never from the
      // spawned CLI's exit code, which has no such convention.
      if (exec.deferred) {
        this.health.deferSession(sessionId, `governor deferred task ${taskId}`);
        await this.markTaskNotStarted(taskId);
        logger.warn('dispatcher', `Task ${taskId} deferred by the quota governor — left queued`);
        return;
      }

      this.health.endSession(
        sessionId,
        exec.result.exitCode,
        exec.result.stderr || null,
        exec.result.timedOut,
      );

      if (exec.result.exitCode === 0 && !exec.result.timedOut) {
        // A product build that wrote no boot recipe cannot be verified — the
        // consumer panel has no way in. Report it in the env-preflight failure
        // class and re-queue the builder rather than parking an unverifiable
        // task in awaiting-verification.
        const blocked = bootGateFailure(taskId);
        if (blocked) {
          await reportBootGate(taskId, task.title, blocked);
          await this.handleFailure(taskId, agentId, { ...exec.result, stderr: blocked });
          return;
        }

        // One shared ending for both dispatch paths (here and run-task.ts):
        // awaiting-verification with a compiled contract, or an honest waiver.
        // The summary used to be hardcoded "" here — every task dispatched by the
        // daemon reported nothing, however much the builder had actually done.
        const { report, body } = recordBuilderReport({
          runId,
          stdout: exec.result.stdout,
          outputLogPath: writer.filePath,
        });
        const outcome = await handleBuilderCompletion(
          taskId,
          agentId,
          body,
          report.completedSubtaskIds,
        );
        // The task just settled (awaiting-verification, or waived done). Any
        // retry still queued from an earlier failure would now be a second
        // builder on finished work (S5).
        this.dropRetries(taskId, `builder settled it as ${outcome}`);
        logger.info(
          'dispatcher',
          `Task ${taskId} builder finished (${outcome}) by ${agentId} via ${exec.backend}`,
        );
      } else {
        await this.handleFailure(taskId, agentId, exec.result);
      }
    } catch (err) {
      writer.close();
      const message = err instanceof Error ? err.message : String(err);
      logger.error('dispatcher', `Failed to dispatch task ${taskId}: ${message}`);
      if (!spawnAttempted) {
        // Nothing was actually spawned — hand the booked slot back rather than
        // burn it on a dispatch that never left the ground.
        refundSpawn('builder', taskId, backend);
      }
      if (sessionId) {
        // Closes the session this failure opened so it counts toward
        // getRetryCount() (below) and does not linger as "running" forever.
        this.health.endSession(sessionId, null, message, false);
      }
      // Routes through the same exponential-backoff retry queue a failed
      // build uses, so a dispatch that fails every tick (e.g. a bad prompt
      // build) backs off and eventually stops instead of retrying forever.
      await this.handleFailure(taskId, agentId, {
        exitCode: null,
        stderr: message,
        timedOut: false,
      });
    }
  }

  /**
   * Mark task as in-progress immediately when daemon dispatches it.
   * Keeps UI status in sync even when run-task.ts is not used.
   */
  private async markTaskInProgress(taskId: string): Promise<void> {
    try {
      await withFileLockAsync('tasks', async () => {
        const tasksRaw = readFileSync(TASKS_FILE, 'utf-8');
        const tasksData = JSON.parse(tasksRaw) as {
          tasks: Array<{ id: string; kanban: string; updatedAt?: string }>;
        };
        const task = tasksData.tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.kanban === 'in-progress' || task.kanban === 'done') return;

        task.kanban = 'in-progress';
        task.updatedAt = new Date().toISOString();
        writeJsonAtomic(TASKS_FILE, tasksData);
        logger.info('dispatcher', `Marked task ${taskId} as in-progress`);
      });
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to mark task ${taskId} as in-progress: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Reset task back to not-started after a failed/aborted run.
   * Keeps board state accurate instead of leaving stale in-progress tasks.
   */
  private async markTaskNotStarted(taskId: string): Promise<void> {
    try {
      await withFileLockAsync('tasks', async () => {
        const tasksRaw = readFileSync(TASKS_FILE, 'utf-8');
        const tasksData = JSON.parse(tasksRaw) as {
          tasks: Array<{
            id: string;
            kanban: string;
            updatedAt?: string;
          }>;
        };
        const task = tasksData.tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.kanban === 'done' || task.kanban === 'not-started') return;

        task.kanban = 'not-started';
        task.updatedAt = new Date().toISOString();
        writeJsonAtomic(TASKS_FILE, tasksData);
        logger.info('dispatcher', `Reset task ${taskId} to not-started after failed/aborted run`);
      });
    } catch (err) {
      logger.error(
        'dispatcher',
        `Failed to reset task ${taskId} to not-started: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Handle a failed task execution.
   * Pushes to the persistent retry queue with exponential backoff instead of setTimeout.
   */
  private async handleFailure(
    taskId: string,
    agentId: string,
    result: { exitCode: number | null; stderr: string; timedOut: boolean },
  ): Promise<void> {
    await this.markTaskNotStarted(taskId);
    const retryCount = this.health.getRetryCount(taskId);

    if (retryCount < this.config.execution.retries) {
      const attempt = retryCount + 1;
      const delayMinutes = this.getRetryDelayMinutes(attempt);
      const retryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

      logger.warn(
        'dispatcher',
        `Task ${taskId} failed (attempt ${attempt}/${this.config.execution.retries + 1}), scheduling retry at ${retryAt} (${delayMinutes} min delay)`,
      );

      // Remove any existing entry for this task (shouldn't happen, but be safe)
      this.retryQueue = this.retryQueue.filter((r) => r.taskId !== taskId);

      this.retryQueue.push({
        taskId,
        agentId,
        retryAt,
        attempt,
        failedAt: new Date().toISOString(),
        error: result.stderr?.slice(0, 500) || null,
      });

      this.saveRetryQueue();
    } else {
      logger.error(
        'dispatcher',
        `Task ${taskId} permanently failed after ${retryCount + 1} attempts`,
      );

      // Clean up any stale retry entries for this task
      const hadEntry = this.retryQueue.some((r) => r.taskId === taskId);
      if (hadEntry) {
        this.retryQueue = this.retryQueue.filter((r) => r.taskId !== taskId);
        this.saveRetryQueue();
      }
    }
  }

  /**
   * One firing of a journey's smoke schedule.
   *
   * The same gate the task-verification pickup uses, for the same reason: a
   * journey run fans out into a persona panel plus a judge, so it is peeked at
   * on the `judge` role and the run's own spawns book their slots. A denial
   * skips this firing and logs it as a deferral — the next cron tick tries
   * again, and nothing is marked failed, because nothing failed.
   */
  runJourneySmoke(projectId: string, journeyId: string): void {
    const slots = this.config.concurrency.maxParallelAgents - this.health.activeCount();
    if (slots <= 0) {
      logger.info(
        'dispatcher',
        `Smoke run for ${projectId}/${journeyId} skipped — no concurrency slots`,
      );
      return;
    }

    const gate = canSpawn('judge');
    if (!gate.allowed) {
      this.logGovernorDeferral(`smoke run of journey ${journeyId} (${projectId})`, gate);
      return;
    }

    const sessionId = this.health.startSession('system', null, `smoke:${journeyId}`, 0);
    logger.info('dispatcher', `Starting smoke run for journey ${journeyId} (${projectId})`);
    const child = spawnJourneyRun(projectId, journeyId, { smoke: true });
    if (child.pid && child.pid > 0) this.health.updateSessionPid(sessionId, child.pid);

    child.on('exit', (code) => {
      this.health.endSession(
        sessionId,
        code,
        code === 0 ? null : `smoke run exited ${code}`,
        false,
      );
      logger.info('dispatcher', `Smoke run for ${journeyId} exited ${code}`);
    });
    child.on('error', (err) => {
      this.health.endSession(sessionId, 1, err.message, false);
      logger.error('dispatcher', `Smoke run for ${journeyId} failed to start: ${err.message}`);
    });
  }

  /**
   * File the morning smoke digest. No agent, no spawn, no governor: this reads
   * verdicts already on disk and writes one Inbox message.
   */
  async runSmokeDigest(): Promise<void> {
    try {
      await writeSmokeDigest();
    } catch (err) {
      logger.error(
        'dispatcher',
        `Smoke digest failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Run a scheduled command (daily-plan, standup, etc.)
   */
  async runScheduledCommand(command: string): Promise<void> {
    if (this.health.isCommandRunning(command)) {
      logger.info('dispatcher', `Scheduled command "/${command}" already running, skipping`);
      return;
    }

    const availableSlots = this.config.concurrency.maxParallelAgents - this.health.activeCount();
    if (availableSlots <= 0) {
      logger.info('dispatcher', `No slots available for scheduled command "/${command}"`);
      return;
    }

    const backend = this.resolveBackendForNonTask();
    const gate = claimSpawn('scheduled', { backend, ref: command });
    if (!gate.allowed) {
      this.logGovernorDeferral(`scheduled command "/${command}"`, gate);
      return;
    }

    logger.info('dispatcher', `Running scheduled command: /${command}`);

    const prompt = buildScheduledPrompt(command);
    const runId = `sched_${Date.now()}_${command}`;
    const writer = new OutputWriter(runId);

    const sessionId = this.health.startSession('system', null, command, 0);

    try {
      const result = await this.runner.spawnAgent({
        prompt,
        maxTurns: this.config.execution.maxTurns,
        timeoutMinutes: this.config.execution.timeoutMinutes,
        skipPermissions: this.config.execution.skipPermissions,
        // D9: scheduled commands read and write files; they have no need of a shell.
        allowedTools: toolsForRole('scheduled'),
        role: 'scheduled',
        onStdoutChunk: (chunk) => writer.append('stdout', chunk),
        onStderrChunk: (chunk) => writer.append('stderr', chunk),
        backend,
        model: modelForBackend(backend, this.config.execution.workerModel),
        codexModel: this.config.execution.codexModel,
        geminiModel: this.config.execution.geminiModel,
        cwd: '',
      });

      writer.close();
      this.health.endSession(sessionId, result.exitCode, result.stderr || null, result.timedOut);
      this.recordBackendOutcome(backend, result, { role: 'scheduled', ref: command });

      if (result.exitCode === 0) {
        logger.info('dispatcher', `Scheduled command "/${command}" completed successfully`);
      } else {
        logger.error(
          'dispatcher',
          `Scheduled command "/${command}" failed (exit=${result.exitCode})`,
        );
      }
    } catch (err) {
      writer.close();
      this.health.endSession(sessionId, 1, err instanceof Error ? err.message : String(err), false);
      logger.error(
        'dispatcher',
        `Scheduled command "/${command}" error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
