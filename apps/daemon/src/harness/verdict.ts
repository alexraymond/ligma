/**
 * verdict.ts — the ONLY file allowed to write kanban "done".
 *
 * Phase 0 removed `done` from the builder's completion handlers; this is where
 * it went. Dependency release moved here with it, because "this task is
 * finished" and "its dependents are unblocked" are the same fact and must not be
 * able to disagree — which is why blockedness is DERIVED from that one fact and
 * `blockedBy` is never rewritten (M5).
 *
 * There are exactly two doors to "done", and neither can be opened elsewhere:
 *   - applyVerdict() on outcome "passed"  → verificationStatus "passed"
 *   - handleBuilderCompletion() for a task with NO acceptance criteria, where no
 *     oracle can exist → verificationStatus "waived" (D1). Never "passed".
 *
 * On a failed verdict the task goes back to `not-started` with
 * verificationStatus "failed", which re-queues the builder — and
 * prompt-builder.ts feeds the failure reasons back into the next attempt.
 * On outcome "error" the harness malfunctioned: the task is left exactly where
 * the builder left it and nothing is claimed about the product (D3).
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { cachedConfig } from '../engine/config-cache';
import { withFileLockAsync, writeJsonAtomic } from '../engine/file-lock';
import type { Backend } from '../engine/types';
import { isPidAlive } from '../env/manifest';
import { generateId } from '../store/ids';
import { compileDeterministicContract } from './compile-contract';
import { getContract, getLatestContract } from './contract-store';
import type { AcceptanceContract, VerificationVerdict } from './types';

import { notifyDesktop } from '../notify';
import { DAEMON_ROOT, DATA_DIR } from '../paths';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
const ACTIVITY_LOG_FILE = path.join(DATA_DIR, 'activity-log.json');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
export const RUNS_DIR = path.join(DATA_DIR, 'verification-runs');

/**
 * D4 fallback, used only when a hand-edited config omits the key —
 * `execution.harness.maxVerificationAttempts` is a real setting (config.ts
 * defaults it to 3 and validates 1..10, and the UI schema round-trips it).
 */
const DEFAULT_MAX_VERIFICATION_ATTEMPTS = 3;

/** Prose kept on every cap card, and the ONLY way to recognise a legacy one. */
const CAP_MARKER = 'verification attempts exhausted';

/**
 * Structured identity of the "attempts exhausted" card. Deduping and the
 * consumer below both key on this and on `attempts` — never on the prose, which
 * is there for the human.
 */
export const VERIFICATION_CAP_KIND = 'verification-cap';

/**
 * Why a verification run ended, as a class rather than a sentence.
 *
 * "governor-denied" is written by run-verification.ts at the site that knows —
 * a `GovernorAbort` raised before a single persona started — and is what
 * `refundVerificationAttempt` keys on. Nothing here parses an error message.
 */
export type RunErrorKind = 'governor-denied';

interface TaskRow {
  id: string;
  title?: string;
  kanban: string;
  subtasks?: Array<{ id: string; title?: string; done?: boolean }>;
  verificationStatus?: string;
  assignedTo?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
  blockedBy?: string[];
  acceptanceCriteria?: string[];
  verificationAttempts?: number;
  projectId?: string | null;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Every store write in this file goes through here, so every one of them is a
 * temp-file + rename rather than a truncate-and-write (R3): the verification
 * child can be killed at any moment, and a torn tasks.json reads back as an
 * empty board to the daemon that then re-dispatches everything.
 */
function writeJson(file: string, data: unknown): void {
  writeJsonAtomic(file, data);
}

/** The cap on verification runs per build. See DEFAULT_MAX_VERIFICATION_ATTEMPTS. */
export function maxVerificationAttempts(): number {
  const harness = cachedConfig().execution.harness as { maxVerificationAttempts?: number };
  const configured = harness.maxVerificationAttempts;
  return typeof configured === 'number' && configured > 0
    ? configured
    : DEFAULT_MAX_VERIFICATION_ATTEMPTS;
}

async function appendInbox(message: Record<string, unknown>): Promise<void> {
  await withFileLockAsync('inbox', async () => {
    const data = readJson<{ messages: Array<Record<string, unknown>> }>(INBOX_FILE, {
      messages: [],
    });
    data.messages.push({
      id: `msg_${Date.now()}`,
      from: 'system',
      to: 'me',
      status: 'unread',
      readAt: null,
      ...message,
    });
    writeJson(INBOX_FILE, data);
  });
}

/**
 * Append one activity event under the cross-process file lock.
 *
 * Exported because `run-task.ts` runs in its OWN process: the async
 * `mutateActivityLog` in store/data.ts guards the file with an in-process mutex,
 * which is exactly no protection between the daemon and a detached run. Anything
 * outside the daemon process must come through here.
 */
export async function appendActivity(event: Record<string, unknown>): Promise<void> {
  await withFileLockAsync('activity-log', async () => {
    const data = readJson<{ events: Array<Record<string, unknown>> }>(ACTIVITY_LOG_FILE, {
      events: [],
    });
    data.events.push({
      id: `evt_${Date.now()}`,
      actor: 'system',
      timestamp: new Date().toISOString(),
      ...event,
    });
    writeJson(ACTIVITY_LOG_FILE, data);
  });
}

/**
 * Say which tasks this completion just released — every blocker of theirs is now
 * done, where "done" means a passed verdict or an honest waiver.
 *
 * It used to PRUNE the ids it found out of `blockedBy`, which destroyed the only
 * record of the declared dependency: a blocker that is later reopened leaves its
 * dependent looking unblocked forever, and nothing can ever redraw the chain
 * (execution-flow-review M5). Nothing needed the prune — `isTaskUnblocked`, the
 * dispatcher and the web board all compute blockedness from blocker STATUS — so
 * this reads and reports, and writes nothing at all.
 * Caller must already hold the tasks lock.
 */
function releasedDependents(tasks: TaskRow[]): string[] {
  const doneIds = new Set(tasks.filter((t) => t.kanban === 'done').map((t) => t.id));
  return tasks
    .filter(
      (t) =>
        t.kanban !== 'done' &&
        Array.isArray(t.blockedBy) &&
        t.blockedBy.length > 0 &&
        t.blockedBy.every((depId) => doneIds.has(depId)),
    )
    .map((t) => t.id);
}

/** Log what a completion released. Same call sites the prune had, no writes. */
function noteReleasedDependents(tasks: TaskRow[]): void {
  const released = releasedDependents(tasks);
  if (released.length > 0)
    console.log(`[harness/verdict] dependents now unblocked: ${released.join(', ')}`);
}

// ─── Contract compilation (D1) ───────────────────────────────────────────────

/**
 * Guarantee an oracle exists for a task that has acceptance criteria.
 *
 * Nothing else compiles contracts on the autonomous path, so without this every
 * ordinary task parks in awaiting-verification forever. Deterministic and
 * in-process: one criterion per acceptanceCriteria string, no LLM, no spawn.
 * Returns null when the task has no criteria (nothing to compile).
 */
export function ensureContract(taskId: string): AcceptanceContract | null {
  return getLatestContract(taskId) ?? compileDeterministicContract(taskId);
}

// ─── Builder completion (D1 + D6) ────────────────────────────────────────────

export type BuilderOutcome = 'waived' | 'awaiting-verification' | 'unchanged';

/**
 * The builder exited 0. That proves the builder stopped, not that the work is
 * correct — so this decides which of the two honest endings applies:
 *
 *   has acceptanceCriteria ⇒ awaiting-verification, previous verdict invalidated
 *                            (D6: unverified + attempts 0), contract compiled if
 *                            missing so the harness can actually run.
 *   no acceptanceCriteria  ⇒ there is no oracle and never will be. Parking it
 *                            forever is the lie; done + "waived" is the truth
 *                            (D1), and its dependents unblock.
 */
export async function handleBuilderCompletion(
  taskId: string,
  actor: string,
  summary = '',
  /**
   * Subtask ids the builder reported finishing, already parsed by the caller
   * (prompt-builder owns the parsing; taking ids rather than raw stdout keeps
   * this module free of an import cycle with it). Ids that do not belong to the
   * task are ignored here.
   */
  completedSubtaskIds: string[] = [],
): Promise<BuilderOutcome> {
  const now = new Date().toISOString();
  let outcome: BuilderOutcome = 'unchanged';
  let title = taskId;
  let projectId: string | null = null;
  // The builder can no longer write tasks.json (the oracle lives there), so it
  // reports finished subtasks as structured output instead and we apply them.
  const reportedSubtaskIds = new Set(completedSubtaskIds);

  await withFileLockAsync('tasks', async () => {
    const data = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    title = task.title ?? taskId;
    projectId = task.projectId ?? null;

    // Only ids that belong to this task; never create one, never un-tick one.
    let ticked = 0;
    if (reportedSubtaskIds.size > 0) {
      for (const sub of task.subtasks ?? []) {
        if (!sub.done && reportedSubtaskIds.has(sub.id)) {
          sub.done = true;
          ticked += 1;
        }
      }
    }

    if (task.kanban === 'done') {
      // Subtask progress still lands on an already-done task, but a report that
      // changed nothing must not rewrite the file or move updatedAt.
      if (ticked > 0) {
        task.updatedAt = now;
        writeJson(TASKS_FILE, data);
      }
      return;
    }

    if ((task.acceptanceCriteria ?? []).length > 0) {
      task.kanban = 'awaiting-verification';
      task.verificationStatus = 'unverified';
      // D4/D6: attempts reset when a NEW BUILD completes. The old verdict is
      // about code that no longer exists, so the attempts spent proving it wrong
      // are spent too — without this a task that fails verification once can
      // never be re-verified after the fix, whatever the builder does.
      //
      // P7's hazard (a STALE retry settling a task the harness had already moved
      // on, zeroing the cap accounting) is now prevented where it originates,
      // per P7's own Direction: dispatcher.ts drops a task's pending retry
      // entries on settle (`dropRetries`, :272/:1219) AND re-reads the board at
      // fire time, dropping any retry whose task is no longer `not-started`
      // (`processDueRetries`, :1078-1088). A stale retry therefore cannot reach
      // a builder spawn at all, so every settle that lands here belongs to the
      // task's current, freshly-dispatched run — a genuine new build.
      task.verificationAttempts = 0;
      task.completedAt = null;
      outcome = 'awaiting-verification';
    } else {
      task.kanban = 'done';
      task.verificationStatus = 'waived';
      task.verificationAttempts = 0;
      task.completedAt = task.completedAt ?? now;
      outcome = 'waived';
    }

    task.updatedAt = now;
    noteReleasedDependents(data.tasks);
    writeJson(TASKS_FILE, data);
  });

  if (outcome === 'unchanged') return outcome;

  const body = summary.trim() || '(the builder produced no summary)';

  if (outcome === 'waived') {
    const caveat =
      '\n\n— Completed WITHOUT verification. This task carries no acceptance criteria, ' +
      'so there was no oracle to test it against and nothing was checked. ' +
      'Its verification status is "waived", not "passed".';
    await appendInbox({
      from: actor,
      type: 'report',
      taskId,
      subject: `Completed without verification: ${title}`,
      body: body + caveat,
      createdAt: now,
    });
    await appendActivity({
      type: 'task_completed',
      actor,
      taskId,
      projectId,
      summary: `Completed without verification (no acceptance criteria): ${title}`,
      details: body + caveat,
      timestamp: now,
    });
    return outcome;
  }

  try {
    const contract = ensureContract(taskId);
    if (contract)
      console.log(
        `[harness/verdict] contract ${contract.id} v${contract.version} ready for ${taskId}`,
      );
  } catch (err) {
    // A missing contract only delays verification; it must not lose the build.
    console.error(
      `[harness/verdict] could not compile a contract for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await appendInbox({
    from: actor,
    type: 'report',
    taskId,
    subject: `Ready for verification: ${title}`,
    body,
    createdAt: now,
  });
  await appendActivity({
    type: 'task_updated',
    actor,
    taskId,
    projectId,
    summary: `Task awaiting verification: ${title}`,
    details: body,
    timestamp: now,
  });
  return outcome;
}

// ─── Verdict → report text ───────────────────────────────────────────────────

/** Per-criterion failure lines with the evidence paths that back them. */
function failureLines(verdict: VerificationVerdict): string[] {
  // A journey run has no task scope; its contract is scoped to the project.
  const scope = verdict.taskId ?? verdict.projectId ?? null;
  const contract = scope ? getContract(scope, verdict.contractVersion) : null;
  const textFor = (id: string): string => contract?.criteria.find((c) => c.id === id)?.text ?? id;

  return verdict.criterionVerdicts
    .filter((v) => v.status !== 'met')
    .map((v) => {
      const evidence =
        v.evidence.length > 0 ? `\n  Evidence: ${v.evidence.join(', ')}` : '\n  Evidence: none';
      return `- [${v.status}] ${textFor(v.criterionId)} (${v.criterionId})\n  ${v.reasoning}${evidence}`;
    });
}

function buildReportBody(verdict: VerificationVerdict): string {
  const met = verdict.criterionVerdicts.filter((v) => v.status === 'met').length;
  const lines = [
    `Verification run ${verdict.runId} — ${verdict.outcome === 'error' ? 'HARNESS ERROR' : verdict.outcome.toUpperCase()}`,
    `Contract ${verdict.contractId} v${verdict.contractVersion}; judge ${verdict.judgeModel}`,
    `${met}/${verdict.criterionVerdicts.length} criteria met.`,
  ];

  if (verdict.outcome === 'error') {
    lines.push(
      '',
      'The HARNESS malfunctioned — the judge crashed, timed out, or produced nothing usable.',
      'This says NOTHING about the work: no defect was found and none is claimed.',
      'The task is unchanged and still awaiting verification.',
      '',
      `Evidence: data/verification-runs/${verdict.runId}/`,
    );
    return lines.join('\n');
  }

  if (verdict.outcome !== 'passed') {
    lines.push('', 'Not met:', ...failureLines(verdict));
    lines.push('', `Evidence: data/verification-runs/${verdict.runId}/`);
  }

  if (verdict.humanDecisions.length > 0) {
    lines.push(
      '',
      'Raised for your judgement:',
      ...verdict.humanDecisions.map((d) => `- ${d.question}`),
    );
  }

  return lines.join('\n');
}

// ─── The choke point ─────────────────────────────────────────────────────────

/**
 * Apply a verdict to the task board. The only writer of kanban "done" on the
 * verification path, and only for outcome "passed".
 *
 * passed ⇒ done + verificationStatus passed + completedAt + dependents unblocked
 *           + a `task_completed` activity event.
 * failed ⇒ not-started + verificationStatus failed + completedAt cleared, so the
 *           daemon picks the task up again with the failure feedback attached.
 * error  ⇒ nothing about the product is known (D3). The task stays
 *           awaiting-verification / unverified, the builder is NOT re-queued,
 *           and the human is told the harness broke — not that the work failed.
 */
export async function applyVerdict(verdict: VerificationVerdict): Promise<void> {
  // A journey run validates the product, not a ticket: there is no task to move,
  // no dependent to unblock, and nothing to re-queue (twin-primitives §4). The
  // verdict is still written, signed and reachable — it just ends here.
  if (verdict.taskId === null) return;
  const passed = verdict.outcome === 'passed';
  const harnessError = verdict.outcome === 'error';
  const now = new Date().toISOString();
  let title = verdict.taskId;
  let assignedTo: string | null = null;
  // The task's project, not the verdict's: `verdict.projectId` is only set on a
  // journey run, and a journey run never reaches here (it returned above).
  let projectId: string | null = null;
  // Set only once the task is confirmed to exist — a `return` inside the lock
  // callback below only exits that callback, not this function, so without
  // this flag a vanished task would still fall through to the inbox/activity
  // writes below using the raw id (never found a title) as if it were one.
  let taskFound = false;

  await withFileLockAsync('tasks', async () => {
    const data = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
    const task = data.tasks.find((t) => t.id === verdict.taskId);
    if (!task) {
      console.error(
        `[harness/verdict] task ${verdict.taskId} no longer exists — verdict recorded but not applied`,
      );
      return;
    }
    taskFound = true;
    title = task.title ?? task.id;
    assignedTo = task.assignedTo ?? null;
    projectId = task.projectId ?? null;

    if (passed) {
      task.kanban = 'done';
      task.verificationStatus = 'passed';
      task.completedAt = task.completedAt ?? now;
    } else if (harnessError) {
      // Leave the build exactly where it was. A broken judge is not a defect.
      if (task.kanban !== 'done') {
        task.kanban = 'awaiting-verification';
        task.verificationStatus = 'unverified';
      }
    } else {
      // Back to the queue, not "in-progress": the builder gets a fresh attempt.
      task.kanban = 'not-started';
      task.verificationStatus = 'failed';
      task.completedAt = null;
    }
    task.updatedAt = now;

    // Dependency clearing lives with the done-writing, so the two cannot disagree.
    noteReleasedDependents(data.tasks);
    writeJson(TASKS_FILE, data);
  });

  // The task the verdict is about no longer exists — the verdict itself is
  // already recorded (this function only applies it to the board), so there
  // is nothing true left to tell a human: skip the report, notification and
  // activity event rather than name them after a raw id.
  if (!taskFound) return;

  const body = buildReportBody(verdict);
  const subject = harnessError ? 'Harness error' : passed ? 'Verified' : 'Verification failed';

  await appendInbox({
    type: 'report',
    taskId: verdict.taskId,
    subject: `${subject}: ${title}`,
    body,
    createdAt: now,
  });
  notifyDesktop(subject, title);

  await appendActivity({
    // task_completed is emitted ONLY for a real pass.
    type: passed ? 'task_completed' : 'task_updated',
    actor: passed ? (assignedTo ?? 'system') : 'system',
    taskId: verdict.taskId,
    projectId,
    summary: harnessError
      ? `Harness error during verification: ${title}`
      : passed
        ? `Verification passed: ${title}`
        : `Verification failed: ${title}`,
    details: body,
    timestamp: now,
  });

  // The board move above and the verdict itself are two different facts. The
  // event above says what happened to the TASK; this one says a verdict was
  // signed, and carries the ids needed to go read it — so the timeline can link
  // to evidence instead of paraphrasing it.
  await appendActivity({
    type: 'verdict',
    actor: 'system',
    taskId: verdict.taskId,
    projectId,
    summary: `Verdict ${verdict.outcome}: ${title}`,
    details: `verdict:${verdict.runId} contract:${verdict.contractId} v${verdict.contractVersion}${verdict.commitSha ? ` at ${verdict.commitSha.slice(0, 8)}` : ''}`,
    timestamp: now,
  });
}

/**
 * The identity of a question, so the same one asked twice is recognisable as the
 * same fact: sha256 over normalized text, truncated (harvest.md:126 primitive).
 *
 * Normalization strips what varies between two askings of one question — case,
 * uuids, hex ids, every digit (timestamps, counts, ports, line numbers) and all
 * punctuation. This is NOT extraction: nothing is read OUT of the text, it is
 * only reduced to a hash of its identity, which is what the repo's
 * no-regex-parsing rule leaves room for. The judge-declared `duplicateOf`
 * (H6a, judge.ts) is the honest layer; this is the safety net under it.
 */
export function questionFingerprint(question: string): string {
  const normalized = question
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ' ') // uuids
    .replace(/\b[0-9a-f]{7,}\b/g, ' ') // hex ids, shas
    .replace(/\d+/g, ' ') // digits — timestamps, counts, ports
    .replace(/[^a-z]+/g, ' ') // punctuation and whitespace
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * The judgement calls already open on a task, for the judge to see before it
 * raises more (H6a). Pending only: an answered card is settled, and re-showing
 * it would invite the judge to re-litigate what the human already decided.
 */
export function openDecisionsForTask(
  taskId: string | null,
): Array<{ id: string; question: string }> {
  if (!taskId) return [];
  return readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] })
    .decisions.filter(
      (d) => d.taskId === taskId && d.status === 'pending' && typeof d.question === 'string',
    )
    .map((d) => ({ id: String(d.id), question: String(d.question) }));
}

/**
 * Turn the judge's `humanDecisions` into decision cards. `blocksTask: false` —
 * these are judgement calls, not gates: the task's fate is already decided.
 *
 * Deduped two ways, because this used to push unconditionally and one task
 * collected 11 near-identical pending cards from two runs 84 seconds apart —
 * enough to trip the ≥3-pending park and stop the task by talking (H6):
 *   - the judge declared the question a duplicate of one it was shown; or
 *   - its fingerprint matches a card this task already carries, pending OR
 *     answered. An answered duplicate is dropped silently: the human ruled on
 *     that question once and must not be asked again.
 * Returns how many cards were actually raised.
 */
export async function appendHumanDecisions(verdict: VerificationVerdict): Promise<number> {
  if (verdict.humanDecisions.length === 0) return 0;

  return withFileLockAsync('decisions', async () => {
    const data = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] });
    // Cards written before the fingerprint existed are fingerprinted on read, so
    // the dedupe works against the backlog too.
    const seen = new Set(
      data.decisions
        .filter((d) => d.taskId === verdict.taskId && typeof d.question === 'string')
        .map((d) => d.questionFingerprint ?? questionFingerprint(String(d.question))),
    );

    let suppressed = 0;
    let raised = 0;
    for (const [i, d] of verdict.humanDecisions.entries()) {
      if (d.duplicateOf) {
        suppressed += 1;
        continue;
      }
      const fingerprint = questionFingerprint(d.question);
      // `seen` grows as we go, so two duplicates inside ONE verdict collapse too.
      if (seen.has(fingerprint)) {
        suppressed += 1;
        continue;
      }
      seen.add(fingerprint);
      data.decisions.push({
        id: `dec_${Date.now()}_${i}`,
        requestedBy: 'system',
        taskId: verdict.taskId,
        question: d.question,
        options: ['Accept as is', 'Open a follow-up task', 'Reject — needs rework'],
        context: `${d.context}\n\nRaised by the acceptance panel in run ${verdict.runId}.`,
        questionFingerprint: fingerprint,
        status: 'pending',
        answer: null,
        answeredAt: null,
        createdAt: new Date().toISOString(),
        blocksTask: false,
      });
      raised += 1;
    }

    if (suppressed > 0) {
      // ponytail: logged, not persisted — a VerificationVerdict is signed, so a
      // count added after the fact would sit outside the signature, and no
      // unsigned record of the run has a field for it.
      console.log(
        `[harness/verdict] ${suppressed} judge question(s) already open on ${verdict.taskId} — not asked again`,
      );
    }
    if (raised > 0) writeJson(DECISIONS_FILE, data);
    return raised;
  });
}

// ─── Reading verdicts back ───────────────────────────────────────────────────

/**
 * The newest verdict for a task, or null. Used by the feedback loop and by the
 * dispatcher to avoid re-verifying something already in flight.
 */
export function getLatestVerdict(taskId: string): VerificationVerdict | null {
  // Newest first, first match wins: normally one or two files read, not every
  // verdict ever written on every poll cycle.
  for (const name of runDirsNewestFirst()) {
    const verdict = readJson<VerificationVerdict | null>(
      path.join(RUNS_DIR, name, 'verdict.json'),
      null,
    );
    if (verdict && verdict.taskId === taskId) return verdict;
  }
  return null;
}

/**
 * Every verdict this task has on disk, OLDEST FIRST — its attempt history.
 *
 * Deliberately NOT what `getLatestVerdict` uses: that one stops at the first
 * match on every poll cycle, and this one reads every run dir. Called once per
 * builder dispatch, to tell attempt N+1 what attempts 1..N already tried (H7).
 */
export function verdictsForTask(taskId: string): VerificationVerdict[] {
  const out: VerificationVerdict[] = [];
  for (const name of runDirsNewestFirst()) {
    const verdict = readJson<VerificationVerdict | null>(
      path.join(RUNS_DIR, name, 'verdict.json'),
      null,
    );
    if (verdict && verdict.taskId === taskId) out.push(verdict);
  }
  // By the verdict's OWN timestamp, not the run dir's mtime: evidence written
  // after the verdict (or a dir touched by the prune) must not reorder history.
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * The newest verdict for a task IF it failed. A later pass suppresses the
 * feedback, so a rebuilt task is never told about a failure it already fixed.
 */
export function getLatestFailedVerdict(taskId: string): VerificationVerdict | null {
  const latest = getLatestVerdict(taskId);
  return latest && latest.outcome === 'failed' ? latest : null;
}

// ─── In-flight runs (D5) ─────────────────────────────────────────────────────

interface RunManifestRow {
  taskId?: string;
  status?: string;
  pid?: number | null;
  startedAt?: string;
}

/**
 * Run directories, NEWEST FIRST — so every lookup below stops at the first match
 * instead of re-parsing every manifest ever written on every poll cycle.
 *
 * Ordered by mtime (one stat per dir, no parse) rather than by name: it survives
 * fixture dirs whose ids are not timestamps, and two runs started in the same
 * millisecond still order by when they were actually written.
 *
 * Exported for the smoke digest and the journey health scan, which need the same
 * "walk backwards and stop early" order over the same directory.
 */
export function runDirsNewestFirst(): string[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path.join(RUNS_DIR, e.name)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { name: e.name, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map((e) => e.name);
}

function eachRunDir(): Array<{ dir: string; manifest: RunManifestRow }> {
  const out: Array<{ dir: string; manifest: RunManifestRow }> = [];
  for (const name of runDirsNewestFirst()) {
    const dir = path.join(RUNS_DIR, name);
    const manifest = readJson<RunManifestRow | null>(path.join(dir, 'run.json'), null);
    if (manifest) out.push({ dir, manifest });
  }
  return out;
}

/**
 * A `"running"` manifest is believed only while its process is alive AND the run
 * is inside 2× the execution timeout. Trusting the string alone means one killed
 * run blocks its task from ever being verified again — so a corpse is rewritten
 * to `"error"` here and the task proceeds.
 */
function isRunLive(dir: string, manifest: RunManifestRow): boolean {
  const reason = ((): string | null => {
    const pid = manifest.pid;
    if (typeof pid !== 'number' || pid <= 0) return 'the run recorded no pid';
    if (!isPidAlive(pid)) return `pid ${pid} is no longer running`;
    const started = Date.parse(manifest.startedAt ?? '');
    const limitMinutes = 2 * cachedConfig().execution.timeoutMinutes;
    if (Number.isFinite(started) && Date.now() - started > limitMinutes * 60_000) {
      return `it has been running longer than 2× the ${limitMinutes / 2}min timeout`;
    }
    return null;
  })();

  if (reason === null) return true;

  const file = path.join(dir, 'run.json');
  const raw = readJson<Record<string, unknown>>(file, {});
  writeJson(file, {
    ...raw,
    status: 'error',
    error: `verification run died: ${reason}`,
    finishedAt: new Date().toISOString(),
  });
  console.error(`[harness/verdict] stale run ${path.basename(dir)} reclaimed — ${reason}`);
  return false;
}

/**
 * True if a verification run for this task is genuinely still in flight.
 *
 * The task's NEWEST run decides, and the scan stops there: an older run cannot
 * legitimately still be in flight once a later one exists, and the daemon-start
 * sweep reclaims any such corpse.
 */
export function hasRunningVerification(taskId: string): boolean {
  for (const name of runDirsNewestFirst()) {
    const dir = path.join(RUNS_DIR, name);
    const manifest = readJson<RunManifestRow | null>(path.join(dir, 'run.json'), null);
    if (!manifest || manifest.taskId !== taskId) continue;
    if (manifest.status !== 'running') return false;
    return isRunLive(dir, manifest);
  }
  return false;
}

/** Rewrite every dead "running" manifest to error. Called at daemon start (D5). */
export function sweepStaleVerificationRuns(): string[] {
  return eachRunDir()
    .filter(({ dir, manifest }) => manifest.status === 'running' && !isRunLive(dir, manifest))
    .map(({ dir }) => path.basename(dir));
}

/**
 * Whether it is worth starting a run: there must be a compiled contract (the
 * oracle) and no run already in flight. Without a contract run-verification
 * exits 2, so checking here saves the daemon from respawning it every poll.
 */
export function isVerifiable(taskId: string): boolean {
  return getLatestContract(taskId) !== null && !hasRunningVerification(taskId);
}

/** D4: an attempt is counted when a run is STARTED, so a run that dies still counts. */
async function countVerificationAttempt(taskId: string): Promise<void> {
  await withFileLockAsync('tasks', async () => {
    const data = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.verificationAttempts = (task.verificationAttempts ?? 0) + 1;
    task.updatedAt = new Date().toISOString();
    writeJson(TASKS_FILE, data);
  });
}

/**
 * Give back the attempt `countVerificationAttempt` claimed at spawn, when the
 * run turned out never to have started a panel.
 *
 * The claim is deliberately made BEFORE the spawn so a run killed early still
 * counts (D4) — but a run the governor denied never tested anything, and
 * charging it an attempt is how a task reached the cap on quota alone, with no
 * persona ever having run. Keyed on the run's own structured `errorKind`, set at
 * the site that raised the denial; the message is never parsed.
 */
export async function refundVerificationAttempt(
  taskId: string,
  errorKind: RunErrorKind | null,
): Promise<void> {
  // ponytail: a hand-started run (which never claimed an attempt) refunds one it
  // did not spend, leaving the task one attempt richer. Errs toward verifying
  // more, and needs a spawn-time "this attempt was claimed" flag to fix — add
  // that only if manual runs ever become routine.
  if (errorKind !== 'governor-denied') return;
  await withFileLockAsync('tasks', async () => {
    const data = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.verificationAttempts = Math.max(0, (task.verificationAttempts ?? 0) - 1);
    task.updatedAt = new Date().toISOString();
    writeJson(TASKS_FILE, data);
  });
}

/** A decision card as it sits on disk — the cap card's fields, plus whatever else. */
interface DecisionRow {
  id?: string;
  taskId?: string | null;
  status?: string;
  answer?: string | null;
  context?: string;
  question?: string;
  kind?: string;
  attempts?: number;
  consumedAt?: string | null;
  consequenceTaskIds?: string[];
  /** sha256 of the normalized question — how a re-asked question is recognised. */
  questionFingerprint?: string;
  [key: string]: unknown;
}

/**
 * Tell the human a task has used up its verification attempts, once per
 * exhausted round — not once per poll cycle, and not again when the card is
 * answered. Honest by construction: the task is NOT marked failed, because
 * "the harness never produced a verdict" is not "the work is wrong" (D4).
 * Returns true when it actually reported (false = already reported).
 */
export async function reportVerificationCapReached(
  taskId: string,
  attempts: number,
  max: number,
): Promise<boolean> {
  const tasks = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
  const title = tasks.tasks.find((t) => t.id === taskId)?.title ?? taskId;
  const now = new Date().toISOString();

  // Status is deliberately NOT consulted: answering a card used to make the next
  // poll write a fresh one, which is how one task collected eight of them. Only a
  // DIFFERENT attempt count is a new fact — that means a fresh round was granted
  // and burned too.
  const alreadyRaised = (d: DecisionRow): boolean => {
    if (d.taskId !== taskId) return false;
    if (d.kind === VERIFICATION_CAP_KIND) return d.attempts === attempts;
    // One-time concession to cards written before the structured fields existed:
    // reading old records only, never how a new card is matched.
    return typeof d.context === 'string' && d.context.includes(CAP_MARKER);
  };

  const raised = await withFileLockAsync('decisions', async () => {
    const data = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] });
    if (data.decisions.some(alreadyRaised)) return false;
    data.decisions.push({
      id: `dec_${Date.now()}`,
      requestedBy: 'system',
      taskId,
      question: `"${title}" used all ${max} verification attempts without a verdict. How should it be resolved?`,
      options: [
        'Investigate the harness',
        'Send back to the builder',
        'Accept as is (unverified)',
        'Raise the attempt cap',
      ],
      context: `${CAP_MARKER}: ${attempts}/${max} runs started, none produced a passing verdict.`,
      // What the dedupe above and consumeAnsweredCapCards() below actually read.
      kind: VERIFICATION_CAP_KIND,
      attempts,
      max,
      status: 'pending',
      answer: null,
      answeredAt: null,
      createdAt: now,
      // The task's fate is a human call, but the board must not pretend to be gated on it.
      blocksTask: false,
    });
    writeJson(DECISIONS_FILE, data);
    return true;
  });

  if (!raised) return false;

  const body = `${attempts} verification run(s) were started for this task and the cap is ${max}. It is no longer being picked up for verification.\n\nThis is NOT a statement that the work is wrong — no verdict said so. What is true is that the harness never reached a passing verdict, which usually means the harness itself is failing (env boot, judge, or evidence), not the build.\n\nEvidence: data/verification-runs/`;

  await appendInbox({ type: 'report', taskId, subject: `Blocked: ${title}`, body, createdAt: now });
  await appendActivity({
    type: 'task_updated',
    taskId,
    summary: `Verification attempts exhausted (${attempts}/${max}): ${title}`,
    details: body,
    timestamp: now,
  });

  return true;
}

/**
 * Apply the answers humans gave on cap cards, once each.
 *
 * Without this the four options were decoration: the card flipped to "answered"
 * and the task sat in awaiting-verification forever, at its cap, promised a
 * transition nobody ever made. Called once per dispatcher poll cycle.
 *
 * Lives here rather than in the dispatcher because one of the transitions writes
 * kanban "done", and this file is the only one allowed to (see the header) —
 * which is also how the accepted task's dependents get unblocked for free.
 * A task the human has already moved is consumed without being touched.
 * Returns how many cards were consumed. Never throws: the poll cycle must not
 * die over housekeeping.
 */
export async function consumeAnsweredCapCards(): Promise<number> {
  try {
    const all = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] }).decisions;
    const answered = all.filter(
      (d) => d.kind === VERIFICATION_CAP_KIND && d.status === 'answered' && !d.consumedAt,
    );
    if (answered.length === 0) return 0;

    const now = new Date().toISOString();
    const changedTasks = new Map<string, string>(); // decision id → task id it moved

    await withFileLockAsync('tasks', async () => {
      const data = readJson<{ tasks: TaskRow[] }>(TASKS_FILE, { tasks: [] });
      for (const card of answered) {
        const task = data.tasks.find((t) => t.id === card.taskId);
        // Gone, or already moved by a human: the answer is stale, consume it as-is.
        if (!task || task.kanban !== 'awaiting-verification') continue;

        switch (card.answer) {
          case 'Accept as is (unverified)':
            task.kanban = 'done';
            task.verificationStatus = 'waived';
            task.completedAt = now;
            break;
          case 'Send back to the builder':
            task.kanban = 'not-started';
            task.verificationStatus = 'unverified';
            task.verificationAttempts = 0;
            break;
          case 'Raise the attempt cap':
            // A fresh round under the same cap — the cap itself is config.
            task.verificationAttempts = 0;
            break;
          case 'Investigate the harness':
            continue; // the human is looking at it; the task stays put
          default:
            console.log(
              `[harness/verdict] cap card ${card.id} answered "${card.answer}" — no transition for that, consumed unchanged`,
            );
            continue;
        }
        task.updatedAt = now;
        changedTasks.set(String(card.id), task.id);
      }

      if (changedTasks.size > 0) {
        noteReleasedDependents(data.tasks);
        writeJson(TASKS_FILE, data);
      }
    });

    const consumedIds = new Set(answered.map((d) => String(d.id)));
    await withFileLockAsync('decisions', async () => {
      const data = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] });
      for (const d of data.decisions) {
        if (!consumedIds.has(String(d.id))) continue;
        d.consumedAt = now;
        // The convention DecisionItem.consequenceTaskIds documents: written from
        // the ids this actually touched, never parsed out of the answer.
        const moved = changedTasks.get(String(d.id));
        d.consequenceTaskIds = moved ? [moved] : [];
      }
      writeJson(DECISIONS_FILE, data);
    });

    return consumedIds.size;
  } catch (err) {
    console.error(
      `[harness/verdict] could not consume answered cap cards: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/** The answer that promises a task. Written by us into `options`, so it is a value, not prose. */
const FOLLOW_UP_ANSWER = 'Open a follow-up task';
/** A title is a line, not a paragraph; the whole question survives in the description. */
const TITLE_CHARS = 120;

/**
 * Open the task "Open a follow-up task" has been promising.
 *
 * It was offered on every judge decision card and handled nowhere: the card
 * flipped to answered, `consequenceTaskIds` stayed unwritten, and the thing the
 * human asked for never existed (H8). The sibling pass of
 * `consumeAnsweredCapCards`, and here for the same reason: this file owns the
 * kanban writes.
 *
 * The new task inherits what the origin knows — project, assignee, importance,
 * urgency — and waits behind it while the origin is still open, because a
 * follow-up to work that is still moving is not ready to start. Idempotent:
 * `consumedAt` is the guard, so a re-poll opens nothing twice. Never throws.
 */
export async function consumeAnsweredFollowUps(): Promise<number> {
  try {
    const all = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] }).decisions;
    const answered = all.filter(
      (d) => d.status === 'answered' && d.answer === FOLLOW_UP_ANSWER && !d.consumedAt,
    );
    if (answered.length === 0) return 0;

    const now = new Date().toISOString();
    const created = new Map<string, { id: string; title: string; projectId: string | null }>();

    await withFileLockAsync('tasks', async () => {
      const data = readJson<{ tasks: Array<Record<string, unknown>> }>(TASKS_FILE, { tasks: [] });
      for (const card of answered) {
        const origin = data.tasks.find((t) => t.id === card.taskId) as
          | (TaskRow & Record<string, unknown>)
          | undefined;
        // Nothing to inherit from and nothing to block on: the card is consumed
        // as-is rather than opening a task nobody can place.
        if (!origin) continue;

        const question = String(card.question ?? 'Follow-up')
          .replace(/\s+/g, ' ')
          .trim();
        const task = {
          id: generateId('task'),
          title: question.length > TITLE_CHARS ? `${question.slice(0, TITLE_CHARS)}…` : question,
          description:
            `${question}\n\n${card.context ?? ''}\n\n` +
            `Follow-up opened from a decision on task ${origin.id} ("${origin.title ?? origin.id}").`,
          importance: origin.importance ?? 'important',
          urgency: origin.urgency ?? 'not-urgent',
          kanban: 'not-started',
          verificationStatus: 'unverified',
          projectId: origin.projectId ?? null,
          milestoneId: origin.milestoneId ?? null,
          assignedTo: origin.assignedTo ?? null,
          collaborators: [],
          dailyActions: [],
          subtasks: [],
          // A follow-up to finished work is ready now; to live work, it waits.
          blockedBy: origin.kanban === 'done' ? [] : [origin.id],
          estimatedMinutes: null,
          actualMinutes: null,
          acceptanceCriteria: [],
          comments: [],
          tags: [],
          notes: '',
          dueDate: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          deletedAt: null,
        };
        data.tasks.push(task);
        created.set(String(card.id), { id: task.id, title: task.title, projectId: task.projectId });
      }

      if (created.size > 0) writeJson(TASKS_FILE, data);
    });

    const consumedIds = new Set(answered.map((d) => String(d.id)));
    await withFileLockAsync('decisions', async () => {
      const data = readJson<{ decisions: DecisionRow[] }>(DECISIONS_FILE, { decisions: [] });
      for (const d of data.decisions) {
        if (!consumedIds.has(String(d.id))) continue;
        d.consumedAt = now;
        const made = created.get(String(d.id));
        d.consequenceTaskIds = made ? [made.id] : [];
      }
      writeJson(DECISIONS_FILE, data);
    });

    for (const made of created.values()) {
      await appendActivity({
        type: 'task_created',
        taskId: made.id,
        projectId: made.projectId,
        summary: `Follow-up task opened: ${made.title}`,
        details: 'Opened by answering a decision card raised by the acceptance panel.',
        timestamp: now,
      });
    }

    return consumedIds.size;
  } catch (err) {
    console.error(
      `[harness/verdict] could not open follow-up tasks: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * Bulk evidence older than 72h, pruned (docs/history/CONTRACTS.md). run.json,
 * verdict.json and the persona report.json files are the audit trail and are
 * kept forever; screenshots and transcripts are what actually grows without
 * bound (~130 files per run).
 */
export function pruneVerificationEvidence(maxAgeMs = 72 * 60 * 60 * 1000): number {
  if (!existsSync(RUNS_DIR)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;

  const prunable = (name: string): boolean =>
    name === 'shots' || name === 'transcript.jsonl' || name === 'steps.jsonl';

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (prunable(entry.name)) {
        rmSync(full, { recursive: true, force: true });
        pruned += 1;
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };

  for (const name of runDirsNewestFirst()) {
    const dir = path.join(RUNS_DIR, name);
    try {
      if (statSync(dir).mtimeMs > cutoff) continue;
      walk(dir);
    } catch {
      // A run dir we cannot read is not a run dir we should delete from.
    }
  }
  return pruned;
}

/**
 * Spawn a verification run as a child process.
 *
 * Lives here rather than in run-verification.ts so the daemon can start a
 * verification without importing Playwright into its own process. Counting the
 * attempt here — the single spawn path the daemon uses — is what makes the D4
 * cap unloseable: a run killed before it writes anything still counted.
 * A human running `run-verification.ts` by hand does not burn the daemon's cap.
 *
 * stdout/stderr go to a log file, not /dev/null: a run that dies before it can
 * create its run dir used to leave no diagnostic anywhere at all, just a task
 * stuck in awaiting-verification. The child writes the file itself (fd stdio)
 * because a detached run outlives this process, so nothing here could pipe it.
 */
export async function spawnVerificationRun(
  taskId: string,
  opts: { smoke?: boolean; detached?: boolean; judgeSlot?: Backend | null } = {},
): Promise<ChildProcess> {
  mkdirSync(RUNS_DIR, { recursive: true });
  await countVerificationAttempt(taskId);
  const args = ['tsx', path.join('src', 'harness', 'run-verification.ts'), taskId];
  if (opts.smoke) args.push('--smoke');
  // The caller already BOOKED the judge's slot (C2). Passing it down is what
  // stops the judge queueing behind the very panel whose quota it needs.
  if (opts.judgeSlot) args.push('--judge-slot', opts.judgeSlot);

  // Same dir (and 72h prune) as the daemon's other run output. Unlike
  // OutputWriter this is not credential-scrubbed — the child's output is the
  // harness's own log lines, and an unscrubbed diagnostic beats none.
  const logDir = path.join(DATA_DIR, 'run-outputs');
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(
    logDir,
    `verification-${taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.log`,
  );
  return spawnHarness(args, logPath, opts.detached === true);
}

/**
 * Spawn a journey run ("Prove it", and every smoke schedule firing).
 *
 * The sibling of `spawnVerificationRun` and deliberately in the same file: two
 * callers — the route and the scheduler — start the same script, and a spawn
 * that drifts between them is a run that behaves differently depending on who
 * asked for it. No attempt counting: the D4 cap is a task's, and a journey has
 * no task to park.
 */
export function spawnJourneyRun(
  projectId: string,
  journeyId: string,
  opts: { smoke?: boolean; detached?: boolean } = {},
): ChildProcess {
  mkdirSync(RUNS_DIR, { recursive: true });
  const args = ['tsx', path.join('src', 'harness', 'run-journey.ts'), projectId, journeyId];
  if (opts.smoke) args.push('--smoke');

  const logDir = path.join(DATA_DIR, 'run-outputs');
  mkdirSync(logDir, { recursive: true });
  const safe = `${projectId}-${journeyId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return spawnHarness(
    args,
    path.join(logDir, `journey-${safe}-${Date.now()}.log`),
    opts.detached === true,
  );
}

function spawnHarness(args: string[], logPath: string, detached: boolean): ChildProcess {
  const fd = openSync(logPath, 'a');
  try {
    // `npx` is a .cmd shim on Windows and bare spawn() rejects it with EINVAL,
    // so no verification could ever start there (codebase audit E19). The args
    // are all daemon-built (a fixed script path plus ids), never user text.
    const shell = process.platform === 'win32';
    return spawn('npx', args, { cwd: DAEMON_ROOT, stdio: ['ignore', fd, fd], detached, shell });
  } finally {
    closeSync(fd);
  }
}
