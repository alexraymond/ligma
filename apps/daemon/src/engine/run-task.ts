/**
 * run-task.ts — Standalone script to execute a single task via Claude Code.
 *
 * Usage:
 *   node --import tsx src/engine/run-task.ts <taskId> [--source manual|project-run] [--agent-teams]
 *
 * This script:
 *   1. Validates the task (exists, has agent, not done, not already running, not blocked)
 *   2. Writes a "running" entry to active-runs.json
 *   3. Builds the prompt via buildTaskPrompt()
 *   4. Spawns Claude Code via AgentRunner.spawnAgent()
 *   5. Updates active-runs.json with the final status
 *   6. Prunes completed runs older than 1 hour
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RunFailureCause } from '@ligma/api';
import {
  type BuilderOutcome,
  appendActivity,
  handleBuilderCompletion,
  isVerifiable,
  spawnVerificationRun,
} from '../harness/verdict';
import { loadConfig, toolsForRole } from './config';
import { withFileLock, writeJsonAtomic } from './file-lock';
import { logger } from './logger';
import { OutputWriter } from './output-writer';
import {
  buildTaskPrompt,
  getTask,
  hasBlockingPendingDecision,
  isTaskUnblocked,
  recordBuilderReport,
} from './prompt-builder';
import {
  DEFERRED_EXIT_CODE,
  claimSpawn,
  deferralFields,
  recordAvailabilityFailure,
  recordSpawnOutcome,
  recordSuccess,
  refundSpawn,
  resolveRoleBackend,
} from './quota-governor';
import { captureChanges, headSha, writePromptFile } from './run-changes';
import {
  AgentRunner,
  buildBackendChain,
  canBackendHonorRestrictions,
  modelForBackend,
} from './runner';
import { bootGateFailure, builderCwd, reportBootGate } from './task-env';
import type { SpawnResult } from './types';

// ─── Paths ──────────────────────────────────────────────────────────────────

import { DATA_DIR } from '../paths';
const ACTIVE_RUNS_FILE = path.join(DATA_DIR, 'active-runs.json');
import { DAEMON_ROOT, WORKSPACE_ROOT } from '../paths';

// ─── Active Runs File I/O ───────────────────────────────────────────────────

interface ActiveRunEntry {
  id: string;
  taskId: string;
  agentId: string;
  projectId: string | null;
  pid: number;
  /** "deferred" = the quota governor said no; the task was never attempted. */
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'deferred';
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
  outputFile: string | null;
  /** Set at the site that raised the condition — never sniffed out of `error`. */
  causeKind?: RunFailureCause;
  /** Governor deferrals only: when this run may go again. */
  resumesAt?: string;
  /** HEAD of the builder's cwd at spawn. Null when that cwd is not a repo. */
  commitSha?: string | null;
  /** Where the prompt this run was given was persisted. */
  promptFile?: string;
  /** Where the diff this run left behind was captured. */
  changesFile?: string;
}

interface ActiveRunsData {
  runs: ActiveRunEntry[];
}

function readActiveRuns(): ActiveRunsData {
  try {
    if (!existsSync(ACTIVE_RUNS_FILE)) return { runs: [] };
    const raw = readFileSync(ACTIVE_RUNS_FILE, 'utf-8');
    return JSON.parse(raw) as ActiveRunsData;
  } catch {
    return { runs: [] };
  }
}

function writeActiveRuns(data: ActiveRunsData): void {
  writeJsonAtomic(ACTIVE_RUNS_FILE, data);
}

/**
 * Prune completed/failed/timeout runs older than 1 hour.
 */
function pruneOldRuns(data: ActiveRunsData): ActiveRunsData {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  data.runs = data.runs.filter((run) => {
    if (run.status === 'running') return true;
    if (!run.completedAt) return true;
    return now - new Date(run.completedAt).getTime() < ONE_HOUR;
  });

  return data;
}

/**
 * Lock → read → mutate → write atomically. The ONE way this file touches
 * active-runs.json.
 *
 * Every read-modify-write here used to be unlocked and non-atomic (E5/R1), while
 * the daemon reads the same file in `reconcileStaleInProgressTasks` and the
 * routes write it through `store/data.ts`. A lost update — or a crash mid-write
 * leaving torn JSON, after which `readActiveRuns` answers `{runs: []}` — made
 * the daemon see no external run for an in-progress task, reset it to
 * not-started, and dispatch a SECOND concurrent builder for it.
 *
 * `withFileLock("active-runs", …)` is the same cross-process lock name
 * `store/data.ts` now takes for this store, so the two finally exclude each
 * other. The callback must stay synchronous and short: nothing that spawns,
 * regenerates context or verifies belongs inside a store lock.
 */
function mutateActiveRuns<T>(fn: (data: ActiveRunsData) => T): T {
  return withFileLock('active-runs', () => {
    const data = pruneOldRuns(readActiveRuns());
    const result = fn(data);
    writeActiveRuns(data);
    return result;
  });
}

// ─── Post-Completion Side Effects ───────────────────────────────────────────

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

/**
 * Extract text content from a Claude Code assistant message entry.
 * Assistant entries have: { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
 * Or sometimes: { type: "assistant", content: [{ type: "text", text: "..." }] }
 */
function extractAssistantText(entry: Record<string, unknown>): string | null {
  const msg = entry.message as Record<string, unknown> | undefined;
  const contentSource = msg?.content ?? entry.content;
  if (!Array.isArray(contentSource)) return null;

  const textParts: string[] = [];
  for (const block of contentSource) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        textParts.push(text);
      }
    }
  }
  return textParts.length > 0 ? textParts.join('\n') : null;
}

/**
 * Check if an assistant entry contains only text blocks (no tool_use).
 * Pure text responses are the agent's final answer to the user.
 * Entries with tool_use blocks are mid-work narration before a tool call.
 */
function isPureTextResponse(entry: Record<string, unknown>): boolean {
  const msg = entry.message as Record<string, unknown> | undefined;
  const contentSource = (msg?.content ?? entry.content) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(contentSource)) return false;
  return contentSource.length > 0 && contentSource.every((block) => block.type === 'text');
}

/**
 * Find the best assistant text from a list of conversation entries.
 * Priority: last pure-text assistant message (no tool_use — the actual response).
 * Fallback: last assistant message with any text content.
 */
function findBestAssistantText(entries: Array<Record<string, unknown>>): string | null {
  // First pass: last pure-text assistant message (the definitive response)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === 'assistant' && isPureTextResponse(entry)) {
      const text = extractAssistantText(entry);
      if (text) return text;
    }
  }
  // Fallback: last assistant message with any text
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === 'assistant') {
      const text = extractAssistantText(entry);
      if (text) return text;
    }
  }
  return null;
}

/**
 * Extract a human-readable summary from Claude Code's stdout.
 *
 * `--output-format json` can produce:
 *   A) A single JSON object: {"session_id":"...","result":"..."}
 *   B) A JSON array of messages: [{"type":"system",...},{"type":"assistant",...},{"type":"result","result":"..."}]
 *   C) JSONL (one JSON object per line)
 *
 * We try all formats, with multiple fallback strategies for extracting the result text.
 * For assistant messages, we pick the LONGEST one (short ones are often narration).
 */
function extractSummary(stdout: string): string {
  // 1. Try parsing the entire stdout as JSON
  try {
    const parsed = JSON.parse(stdout);

    // A) Single object with result field
    if (typeof parsed.result === 'string' && parsed.result.length > 0 && !Array.isArray(parsed)) {
      return parsed.result.slice(0, 2000);
    }
    // Gemini JSON output commonly uses "response"
    if (
      typeof parsed.response === 'string' &&
      parsed.response.length > 0 &&
      !Array.isArray(parsed)
    ) {
      return parsed.response.slice(0, 2000);
    }

    // B) JSON array
    if (Array.isArray(parsed)) {
      // First: look for explicit type:"result" entry
      for (let i = parsed.length - 1; i >= 0; i--) {
        const entry = parsed[i];
        if (
          entry?.type === 'result' &&
          typeof entry.result === 'string' &&
          entry.result.length > 0
        ) {
          return entry.result.slice(0, 2000);
        }
      }

      // Second: find the longest assistant message (most substantive)
      const best = findBestAssistantText(parsed as Array<Record<string, unknown>>);
      if (best) return best.slice(0, 2000);
    }
  } catch {
    // Not a single JSON value — try JSONL below
  }

  // C) JSONL: scan for result entries first
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (
        parsed.type === 'result' &&
        typeof parsed.result === 'string' &&
        parsed.result.length > 0
      ) {
        return parsed.result.slice(0, 2000);
      }
    } catch {
      /* skip */
    }
  }

  // JSONL: collect all entries and find best assistant message
  const allEntries: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      allEntries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }
  const best = findBestAssistantText(allEntries);
  if (best) return best.slice(0, 2000);

  // D) Fall back to last 10 lines of raw text
  const tail = lines.slice(-10).join('\n');
  if (tail.length > 2000) return `${tail.slice(0, 1997)}...`;
  return tail || '(no output)';
}

function isBackendAvailabilityFailure(
  backend: 'claude' | 'codex' | 'gemini',
  text: string,
): boolean {
  const patterns = [
    ...(backend === 'claude'
      ? [/claude binary not found/i, /not found.*claude/i]
      : [
          new RegExp(`${backend}\\s+binary\\s+not\\s+found`, 'i'),
          new RegExp(`not found.*${backend}`, 'i'),
        ]),
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

function isLikelyCliInitFailure(
  backend: 'claude' | 'codex' | 'gemini',
  result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean },
): boolean {
  if (result.timedOut || result.exitCode === 0) return false;
  if (result.stderr.trim().length > 0) return false;
  if (!/"subtype":"init"/.test(result.stdout)) return false;
  return backend === 'claude';
}

/**
 * Post-run side effects: settle the task (awaiting-verification or an honest
 * waiver), then regenerate context and hand off to the harness.
 *
 * A builder process exiting 0 proves only that the builder stopped, not that the
 * work is correct — so verdict.ts decides the ending, and it is the only file
 * that may write kanban "done". Each step is wrapped in its own try/catch — if
 * one fails, the others still execute.
 */
async function handleTaskCompletion(
  taskId: string,
  agentId: string,
  stdout: string,
  runId: string,
  outputLogPath: string,
): Promise<void> {
  // Debug: log stdout structure to help diagnose extraction issues
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      const types = parsed.map((e: Record<string, unknown>) => e.type).filter(Boolean);
      logger.info(
        'run-task',
        `stdout format: JSON array with ${parsed.length} entries, types: [${[...new Set(types)].join(', ')}]`,
      );
    } else {
      logger.info(
        'run-task',
        `stdout format: JSON object with keys: [${Object.keys(parsed).slice(0, 10).join(', ')}]`,
      );
    }
  } catch {
    const lineCount = stdout.trim().split('\n').length;
    logger.info('run-task', `stdout format: raw text, ${lineCount} lines, ${stdout.length} chars`);
  }

  // The structured report the SOP requires, with the CLI's own result text as
  // the fallback and a named log path when there is neither. Persists
  // summary+artifacts beside the run's output for `GET /api/tasks/:id/outcome`.
  const { report, body } = recordBuilderReport({
    runId,
    stdout,
    outputLogPath,
    fallbackSummary: extractSummary(stdout),
  });

  // 1. Settle the task: awaiting-verification (with a compiled contract) or, for
  //    a task with no acceptance criteria, done + "waived". Posts the inbox
  //    report and the activity event with wording that matches whichever it was.
  let outcome: BuilderOutcome = 'unchanged';
  try {
    outcome = await handleBuilderCompletion(taskId, agentId, body, report.completedSubtaskIds);
    logger.info('run-task', `Task ${taskId} settled as ${outcome}`);
  } catch (err) {
    logger.error(
      'run-task',
      `Failed to settle task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Regenerate ai-context.md
  try {
    const missionControlDir = DAEMON_ROOT;
    execSync('npx tsx scripts/generate-context.ts', {
      cwd: missionControlDir,
      timeout: 30_000,
      stdio: 'ignore',
    });
    logger.info('run-task', `Regenerated ai-context.md after task ${taskId}`);
  } catch (err) {
    logger.error(
      'run-task',
      `Failed to regenerate ai-context.md: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Hand the task to the acceptance harness. Detached and unawaited: a
  //    verification takes minutes (env boot + persona panel), and run-task.ts
  //    must not sit on a concurrency slot waiting for it. The daemon poll cycle
  //    would pick this task up anyway; starting here just removes the delay.
  //    A waived task has no oracle and needs no run.
  if (
    outcome === 'awaiting-verification' &&
    loadConfig().execution.harness.autoVerify &&
    isVerifiable(taskId)
  ) {
    try {
      const child = await spawnVerificationRun(taskId, { detached: true });
      child.unref();
      logger.info('run-task', `Started verification run for task ${taskId} (pid ${child.pid})`);
    } catch (err) {
      logger.error(
        'run-task',
        `Failed to start verification for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

function parseArgs(): { taskId: string; source: string; agentTeams: boolean } {
  const args = process.argv.slice(2);
  const taskId = args[0];

  if (!taskId) {
    console.error('Usage: run-task.ts <taskId> [--source manual|project-run] [--agent-teams]');
    process.exit(1);
  }

  let source = 'manual';
  let agentTeams = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      source = args[i + 1];
      i++;
    }
    if (args[i] === '--agent-teams') {
      agentTeams = true;
    }
  }

  return { taskId, source, agentTeams };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { taskId, source, agentTeams } = parseArgs();

  logger.info('run-task', `Starting task ${taskId} (source: ${source}, agentTeams: ${agentTeams})`);

  // 1. Validate task exists
  const task = getTask(taskId);
  if (!task) {
    logger.error('run-task', `Task not found: ${taskId}`);
    process.exit(1);
  }

  // 2. Validate task has an assigned agent
  if (!task.assignedTo || task.assignedTo === 'me') {
    logger.error(
      'run-task',
      `Task ${taskId} has no AI agent assigned (assignedTo: ${task.assignedTo})`,
    );
    process.exit(1);
  }

  // 3. Validate task is not already done or awaiting verification
  if (task.kanban === 'done') {
    logger.error('run-task', `Task ${taskId} is already done`);
    process.exit(1);
  }
  if (task.kanban === 'awaiting-verification') {
    logger.error(
      'run-task',
      `Task ${taskId} is awaiting verification — the acceptance harness owns it, not the builder`,
    );
    process.exit(1);
  }

  // 4. Check not already running. A cheap early-out only — the check that
  //    decides is the locked one at step 8, because this one is check-then-act.
  const alreadyRunning = readActiveRuns().runs.find(
    (r) => r.taskId === taskId && r.status === 'running',
  );
  if (alreadyRunning) {
    logger.error('run-task', `Task ${taskId} is already running (pid: ${alreadyRunning.pid})`);
    process.exit(1);
  }

  // 5. Check if task is blocked
  const taskWithBlocked = task as typeof task & { blockedBy: string[] };
  if (taskWithBlocked.blockedBy && !isTaskUnblocked(taskWithBlocked)) {
    logger.error('run-task', `Task ${taskId} is blocked by unfinished dependencies`);
    process.exit(1);
  }

  // 6. Check for pending decisions that block the whole task
  if (hasBlockingPendingDecision(taskId)) {
    logger.error('run-task', `Task ${taskId} has a blocking pending decision — cannot execute`);
    process.exit(1);
  }

  // 7. Load execution config
  const config = loadConfig();
  const { maxTurns, timeoutMinutes, skipPermissions } = config.execution;
  const useAgentTeams = agentTeams || config.execution.agentTeams;
  const taskTags = new Set((task.tags ?? []).map((t) => t.toLowerCase()));
  const codexTags = (config.execution.codexTaskTags ?? []).map((t) => t.toLowerCase());
  const geminiTags = (config.execution.geminiTaskTags ?? []).map((t) => t.toLowerCase());
  let backend: 'claude' | 'codex' | 'gemini' = 'claude';
  const routedBuilderBackend = resolveRoleBackend('builder');
  if (routedBuilderBackend !== 'claude') {
    // Governor routing wins — the whole point of routing a role off claude is
    // to stop spending the subscription on it.
    backend = routedBuilderBackend;
    logger.info(
      'run-task',
      `Governor roleRouting.builder=${backend} overrides backendMode=${config.execution.backendMode}`,
    );
  } else if (
    config.execution.backendMode === 'codex' ||
    config.execution.backendMode === 'gemini'
  ) {
    backend = config.execution.backendMode;
  } else if (config.execution.backendMode === 'mixed') {
    if (codexTags.some((tag) => taskTags.has(tag))) {
      backend = 'codex';
    } else if (geminiTags.some((tag) => taskTags.has(tag))) {
      backend = 'gemini';
    }
  }

  // 7b. The quota gate. Validations passed and nothing has been spawned or
  //     mutated yet, so a denial is cheap: record a "deferred" run so the board
  //     shows why, leave the task not-started, and exit 3 — the distinct code
  //     that tells callers this was NOT a failure and must not burn a retry.
  // claimSpawn decides and books in one locked write: this process and the
  // daemon cannot both take the last slot.
  const gate = claimSpawn('builder', { backend, ref: taskId });
  if (!gate.allowed) {
    const reason = `quota governor: ${gate.reason} (retry in ${Math.round(gate.retryInMs / 1000)}s)`;
    logger.warn('run-task', `Task ${taskId} deferred — ${reason}`);
    const deferredAt = new Date().toISOString();
    mutateActiveRuns((data) => {
      data.runs.push({
        id: `run_${Date.now()}`,
        taskId,
        agentId: task.assignedTo!,
        projectId: task.projectId ?? null,
        pid: 0,
        status: 'deferred',
        startedAt: deferredAt,
        completedAt: deferredAt,
        exitCode: DEFERRED_EXIT_CODE,
        error: reason,
        outputFile: null,
        ...deferralFields(gate),
      });
    });
    process.exit(DEFERRED_EXIT_CODE);
  }

  // 8. Write "running" entry
  const runId = `run_${Date.now()}`;
  const writer = new OutputWriter(runId);
  // The task's own product repo when it has one; the workspace root is the
  // ligma-self default. Resolved once here because three things need it: the
  // spawn's cwd, the commit this run started from, and the diff it ends with.
  const cwd = builderCwd(task.projectId) || WORKSPACE_ROOT;
  // Read BEFORE the builder touches anything — afterwards it is not the commit
  // the run started from, it is whatever the run happened to leave.
  const spawnSha = headSha(cwd);
  const runEntry: ActiveRunEntry = {
    id: runId,
    taskId,
    agentId: task.assignedTo,
    projectId: task.projectId ?? null,
    pid: 0, // Will be updated after spawn
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    error: null,
    outputFile: writer.filePath,
    commitSha: spawnSha,
  };

  // The "already running" check that actually decides: inside the lock, so two
  // processes racing on the same task cannot both see an empty slot and both
  // spawn a builder into the same repo (E5).
  const raced = mutateActiveRuns((data) => {
    const live = data.runs.find((r) => r.taskId === taskId && r.status === 'running');
    if (live) return live.pid;
    data.runs.push(runEntry);
    return null;
  });
  if (raced !== null) {
    logger.error('run-task', `Task ${taskId} is already running (pid: ${raced})`);
    // Nothing was spawned, so the slot the gate booked above goes back.
    refundSpawn('builder', taskId, backend);
    writer.close();
    process.exit(1);
  }

  logger.info('run-task', `Run ${runId} created for task ${taskId} (agent: ${task.assignedTo})`);

  await appendActivity({
    type: 'run',
    actor: task.assignedTo,
    taskId,
    projectId: task.projectId ?? null,
    summary: `Run started: ${task.title}`,
    details: `run:${runId} on ${cwd}${spawnSha ? ` at ${spawnSha.slice(0, 8)}` : ' (not a repo)'}`,
  });

  // 8.5. Mark task as "in-progress" (daemon handles this instead of the agent)
  try {
    withFileLock('tasks', () => {
      const tasksRaw = readFileSync(TASKS_FILE, 'utf-8');
      const tasksData = JSON.parse(tasksRaw) as { tasks: Array<Record<string, unknown>> };
      const taskToUpdate = tasksData.tasks.find((t) => t.id === taskId);
      if (taskToUpdate && taskToUpdate.kanban !== 'in-progress' && taskToUpdate.kanban !== 'done') {
        taskToUpdate.kanban = 'in-progress';
        taskToUpdate.updatedAt = new Date().toISOString();
        writeJsonAtomic(TASKS_FILE, tasksData);
        logger.info('run-task', `Marked task ${taskId} as in-progress`);
      }
    });
  } catch (err) {
    logger.error(
      'run-task',
      `Failed to mark task ${taskId} as in-progress: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Non-fatal — continue with execution
  }

  // 9. Build prompt, and persist the one actually used. "What was it asked?" is
  //     otherwise unanswerable after the fact: the prompt is assembled from
  //     config, contract and task state that all keep moving.
  const prompt = buildTaskPrompt(task.assignedTo, task);
  const promptFile = writePromptFile(runId, prompt);
  if (promptFile) {
    mutateActiveRuns((data) => {
      const row = data.runs.find((r) => r.id === runId);
      if (row) row.promptFile = promptFile;
    });
  }

  // 10. Spawn Claude Code
  const runner = new AgentRunner(WORKSPACE_ROOT);

  /**
   * Feed the governor from the same signal the failover uses: cooling state, and
   * what the spawn actually cost.
   *
   * Both live here rather than at the call sites because every spawn — the first
   * attempt and each fallback rotation — already routes through this one
   * function. A rotation that forgot to annotate would leave the retried attempt
   * looking free in the ledger.
   */
  const noteBackendOutcome = (b: 'claude' | 'codex' | 'gemini', r: SpawnResult): void => {
    if (r.exitCode === 0 && !r.timedOut) {
      recordSuccess(b);
    } else if (
      isBackendAvailabilityFailure(b, `${r.stderr}\n${r.stdout}`) ||
      isLikelyCliInitFailure(b, r)
    ) {
      recordAvailabilityFailure(b);
    }
    recordSpawnOutcome('builder', taskId, b, {
      durationMs: r.durationMs,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    });
  };

  /** Set when the governor refuses a fallback attempt: exit 3, not a failure. */
  let deferredReason: string | null = null;
  let deferredFields: { causeKind: RunFailureCause; resumesAt?: string } | null = null;

  /**
   * D7: `role` is what selects the deny rules. Without it the runner falls back
   * to its loose default and the builder can read data/tasks.json — the whole
   * acceptanceCriteria list, holdouts included.
   */
  const restriction = { allowedTools: toolsForRole('builder'), skipPermissions };

  const spawn = (b: 'claude' | 'codex' | 'gemini'): ReturnType<AgentRunner['spawnAgent']> =>
    runner.spawnAgent({
      prompt,
      maxTurns,
      timeoutMinutes,
      ...restriction,
      role: 'builder',
      agentTeams: useAgentTeams,
      onStdoutChunk: (chunk) => writer.append('stdout', chunk),
      onStderrChunk: (chunk) => writer.append('stderr', chunk),
      backend: b,
      model: modelForBackend(b, config.execution.workerModel),
      codexModel: config.execution.codexModel,
      geminiModel: config.execution.geminiModel,
      // Deny rules are absolute paths, so they hold whichever repo this is.
      cwd,
    });

  try {
    // D8/P21: skip any backend that cannot express the restriction — it would
    // throw rather than spawn unrestricted, which used to stop a rate-limited
    // task dead instead of rotating it to another CLI.
    const chain = buildBackendChain(backend, {
      enabled: config.execution.claudeAutoFailoverEnabled,
      preferred: config.execution.claudeAutoFailoverBackend,
    }).filter((b) => {
      if (canBackendHonorRestrictions(b, restriction)) return true;
      logger.warn(
        'run-task',
        `Skipping backend ${b}: it cannot honour allowedTools=[${restriction.allowedTools.join(', ')}] with skipPermissions=${skipPermissions}`,
      );
      return false;
    });

    /** Nothing was spawned: record the deferral and exit 3 (queued, not failed). */
    const deferBeforeSpawn = (
      reason: string,
      fields: { causeKind: RunFailureCause; resumesAt?: string },
    ): never => {
      logger.warn('run-task', `Task ${taskId} deferred — ${reason}`);
      writer.close();
      mutateActiveRuns((data) => {
        const run = data.runs.find((r) => r.id === runId);
        if (!run) return;
        run.status = 'deferred';
        run.error = reason;
        run.exitCode = DEFERRED_EXIT_CODE;
        Object.assign(run, fields);
        run.completedAt = new Date().toISOString();
      });
      process.exit(DEFERRED_EXIT_CODE);
    };

    if (chain.length === 0) {
      // Fail closed: queued forever beats one unrestricted spawn. The gate's
      // booking is handed back — it will never be spent (E13).
      refundSpawn('builder', taskId, backend);
      deferBeforeSpawn(
        `no backend can run this task with its restriction intact (allowedTools=[${restriction.allowedTools.join(', ')}], skipPermissions=${skipPermissions})`,
        { causeKind: 'backend' },
      );
    }

    let usedBackend = chain[0];
    if (usedBackend !== backend) {
      // The pre-spawn gate booked `backend`, which the chain filter just dropped:
      // that booking is orphaned and goes back before we book the one we will
      // actually spawn (E13).
      refundSpawn('builder', taskId, backend);
      const swapGate = claimSpawn('builder', { backend: usedBackend, ref: taskId });
      if (!swapGate.allowed) {
        deferBeforeSpawn(
          `quota governor: ${swapGate.reason} (retry in ${Math.round(swapGate.retryInMs / 1000)}s) on ${usedBackend}`,
          deferralFields(swapGate),
        );
      }
    }

    let result = await spawn(usedBackend);
    noteBackendOutcome(usedBackend, result);

    for (let i = 1; i < chain.length; i++) {
      if (result.exitCode === 0 && !result.timedOut) break;
      const combined = `${result.stderr}\n${result.stdout}`;
      if (
        !isBackendAvailabilityFailure(usedBackend, combined) &&
        !isLikelyCliInitFailure(usedBackend, result)
      ) {
        break;
      }

      const nextBackend = chain[i];
      // D10: every spawn passes the governor, fallbacks included.
      const fallbackGate = claimSpawn('builder', { backend: nextBackend, ref: taskId });
      if (!fallbackGate.allowed) {
        deferredReason = `quota governor: ${fallbackGate.reason} (retry in ${Math.round(fallbackGate.retryInMs / 1000)}s)`;
        deferredFields = deferralFields(fallbackGate);
        logger.warn(
          'run-task',
          `Fallback of task ${taskId} to ${nextBackend} deferred — ${deferredReason}`,
        );
        break;
      }

      logger.warn(
        'run-task',
        `Backend ${usedBackend} unavailable; retrying task ${taskId} on ${nextBackend}`,
      );
      usedBackend = nextBackend;
      result = await spawn(usedBackend);
      noteBackendOutcome(usedBackend, result);
    }

    writer.close();

    // What the run left behind, captured BEFORE the completion side effects
    // below: `handleTaskCompletion` starts a detached verification run, and that
    // snapshots the working tree — so a capture after it would be racing the
    // harness for the state it is trying to describe.
    const changesFile = spawnSha ? captureChanges(runId, cwd, spawnSha) : null;

    // The boot gate is read BEFORE the lock: it touches the product repo and
    // files an inbox report, and neither belongs inside the active-runs lock.
    // A product build with no valid `.ligma/boot.json` cannot be verified —
    // reported as the env-preflight failure it is, never settled as
    // awaiting-verification.
    const cleanExit = !deferredReason && !result.timedOut && result.exitCode === 0;
    const bootBlocked = cleanExit ? bootGateFailure(taskId) : null;
    if (bootBlocked) await reportBootGate(taskId, task.title, bootBlocked);

    // Update run entry with PID (already resolved at this point)
    const finalStatus = mutateActiveRuns((data) => {
      const run = data.runs.find((r) => r.id === runId);
      if (!run) return null;
      run.pid = result.pid;
      if (changesFile) run.changesFile = changesFile;

      if (deferredReason) {
        // The chain stopped at the governor, not at a defect: same deferral
        // semantics as the pre-spawn gate — no retry burned, task stays queued.
        run.status = 'deferred';
        run.error = deferredReason;
        run.exitCode = DEFERRED_EXIT_CODE;
        if (deferredFields) Object.assign(run, deferredFields);
      } else if (result.timedOut) {
        run.status = 'timeout';
        run.error = `Timed out after ${timeoutMinutes} minutes`;
      } else if (bootBlocked) {
        run.status = 'failed';
        run.error = bootBlocked.slice(0, 500);
        // The boot gate read `.ligma/boot.json` and found it missing or
        // malformed — an environment problem, known here as a fact.
        run.causeKind = 'env';
      } else if (result.exitCode === 0) {
        run.status = 'completed';
      } else {
        run.status = 'failed';
        // A non-zero exit from the CLI we spawned. What went wrong INSIDE it is
        // not knowable from here without reading its prose, so the class stops
        // at "the backend exited badly" and the UI offers retry/switch.
        run.causeKind = 'backend';
        // Try stderr first, then check stdout for JSON-formatted errors
        let errorMsg = result.stderr?.trim()?.slice(0, 500);
        if (!errorMsg && result.stdout?.trim()) {
          try {
            const parsed = JSON.parse(result.stdout);
            if (parsed.error) errorMsg = String(parsed.error).slice(0, 500);
            else if (parsed.is_error)
              errorMsg = String(parsed.result || 'Unknown error').slice(0, 500);
          } catch {
            // Not JSON — use raw stdout excerpt
            errorMsg = result.stdout.trim().slice(0, 200);
          }
        }
        run.error = errorMsg || `Exit code: ${result.exitCode}`;
      }

      run.completedAt = new Date().toISOString();
      run.exitCode = deferredReason ? DEFERRED_EXIT_CODE : result.exitCode;
      return run.status;
    });

    // Post-completion side effects (settle the task, inbox report, activity log,
    // hand-off to the harness) — outside the lock, because they spawn.
    if (cleanExit && !bootBlocked) {
      await handleTaskCompletion(taskId, task.assignedTo, result.stdout, runId, writer.filePath);
    }

    logger.info(
      'run-task',
      `Run ${runId} finished: status=${finalStatus ?? 'unknown'}, backend=${usedBackend}, exitCode=${result.exitCode}, timedOut=${result.timedOut}`,
    );

    await appendActivity({
      type: 'run',
      actor: task.assignedTo,
      taskId,
      projectId: task.projectId ?? null,
      summary: `Run ${finalStatus ?? 'finished'}: ${task.title}`,
      details: `run:${runId} on ${usedBackend}${result.durationMs === undefined ? '' : `, ${Math.round(result.durationMs / 1000)}s`}${changesFile ? ', changes captured' : ''}`,
    });

    if (deferredReason) process.exit(DEFERRED_EXIT_CODE);
  } catch (err) {
    writer.close();

    // Update run as failed
    mutateActiveRuns((data) => {
      const run = data.runs.find((r) => r.id === runId);
      if (!run) return;
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      // Nothing below classified this, so it is ours: the harness threw.
      run.causeKind = 'harness';
      run.completedAt = new Date().toISOString();
    });

    logger.error(
      'run-task',
      `Run ${runId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('run-task', `Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
