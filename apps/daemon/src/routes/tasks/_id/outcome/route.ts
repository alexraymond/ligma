/**
 * GET /api/tasks/:id/outcome — did this task actually do anything, and is it
 * still moving?
 *
 * The two questions the surfaces could not answer. A builder that wrote a whole
 * paper/ and code/ tree reported "No additional notes." because nothing carried
 * its summary or its files anywhere a human looks; a verification the quota
 * governor deferred said "reserve — retry in 240s" to the daemon log and nothing
 * at all to the UI, so a waiting project read as a dead one.
 *
 * Pure assembly over stores that already exist — tasks.json, active-runs.json,
 * the run-outputs sidecars, inbox.json, data/verification-runs, and the
 * governor's own decision. It WRITES NOTHING: an answer about whether work
 * happened must not itself be work.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  ActiveRun,
  DecisionItem,
  InboxMessage,
  Task,
  TaskOutcome,
  TaskOutcomeCriterion,
  TaskOutcomeVerificationRun,
} from '@ligma/api';
import { canSpawn, deferralFields } from '../../../../engine/quota-governor';
import { runOutputsDir } from '../../../../engine/run-changes';
import { getContract } from '../../../../harness/contract-store';
import { RUNS_DIR, getLatestVerdict, maxVerificationAttempts } from '../../../../harness/verdict';
import { NextResponse } from '../../../../http';
import { DATA_DIR } from '../../../../paths';

/** How many log lines the tail carries. Enough to see the ending, not the run. */
const TAIL_LINES = 40;
/** Read at most this much of the log — a builder run's JSONL can be tens of MB. */
const TAIL_BYTES = 64 * 1024;

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * The last lines the run said, from its append-only JSONL.
 *
 * Reads the tail of the FILE rather than the whole of it: this is the surface a
 * human opens when a task looks dead, and it must stay cheap enough to poll.
 * A line that will not parse is passed through raw — a half-written last line is
 * still evidence.
 */
function outputTail(file: string | null | undefined): string[] {
  if (!file || !existsSync(file)) return [];
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = readFileSync(file);
    const text = fd.subarray(start).toString('utf-8');
    // A byte-offset read can start mid-line; that first partial line is dropped.
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (start > 0) lines.shift();
    return lines.slice(-TAIL_LINES).map((line) => {
      try {
        const parsed = JSON.parse(line) as { text?: unknown };
        return typeof parsed.text === 'string' ? parsed.text : line;
      } catch {
        return line;
      }
    });
  } catch {
    return [];
  }
}

/** The builder report `recordBuilderReport` persisted beside the run's output. */
interface ReportSidecar {
  summary?: string;
  artifacts?: string[];
  reportedAt?: string;
  outputLogPath?: string | null;
}

function readReportSidecar(runId: string): ReportSidecar | null {
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = path.join(runOutputsDir(), `${safeId}.report.json`);
  return existsSync(file) ? readJson<ReportSidecar | null>(file, null) : null;
}

interface RunManifest {
  id?: string;
  taskId?: string | null;
  status?: string;
  error?: string | null;
  errorKind?: string | null;
  causeKind?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

/**
 * Every acceptance run for this task, newest first — read straight off the
 * manifests, because that is where `errorKind` (the governor-denied class) and
 * the harness's own error string live.
 */
function verificationRunsFor(taskId: string): TaskOutcomeVerificationRun[] {
  if (!existsSync(RUNS_DIR)) return [];
  let dirs: string[];
  try {
    dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const rows: TaskOutcomeVerificationRun[] = [];
  for (const name of dirs.sort().reverse()) {
    const manifest = readJson<RunManifest | null>(path.join(RUNS_DIR, name, 'run.json'), null);
    if (!manifest || manifest.taskId !== taskId) continue;
    rows.push({
      id: manifest.id ?? name,
      status: (manifest.status as TaskOutcomeVerificationRun['status']) ?? 'error',
      error: manifest.error ?? null,
      errorKind: manifest.errorKind ?? null,
      causeKind: (manifest.causeKind as TaskOutcomeVerificationRun['causeKind']) ?? null,
      startedAt: manifest.startedAt ?? null,
      finishedAt: manifest.finishedAt ?? null,
    });
  }
  return rows;
}

/**
 * Is the governor holding this task's verification back right now?
 *
 * The same `canSpawn("judge")` the dispatcher gates on, asked read-only — a
 * denial books nothing, so this cannot cost a slot. Only meaningful while the
 * task is actually queued for verification: a done task is not waiting on quota
 * however exhausted the window is.
 */
function deferralFor(task: Task): TaskOutcome['deferred'] {
  if (task.kanban !== 'awaiting-verification') return null;
  if ((task.verificationStatus ?? 'unverified') !== 'unverified') return null;
  const gate = canSpawn('judge');
  if (gate.allowed) return null;
  return { reason: gate.reason, resumesAt: deferralFields(gate).resumesAt ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;

  const tasks = readJson<{ tasks: Task[] }>(path.join(DATA_DIR, 'tasks.json'), { tasks: [] }).tasks;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // The task's newest builder run — where the report sidecar and the log live.
  const runs = readJson<{ runs: ActiveRun[] }>(path.join(DATA_DIR, 'active-runs.json'), {
    runs: [],
  }).runs;
  const latestRun =
    runs
      .filter((r) => r.taskId === taskId && r.kind !== 'adoption')
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;
  const sidecar = latestRun ? readReportSidecar(latestRun.id) : null;

  // The completion report as the human received it. Newest wins.
  const inbox = readJson<{ messages: InboxMessage[] }>(path.join(DATA_DIR, 'inbox.json'), {
    messages: [],
  }).messages;
  const report = inbox.filter((m) => m.taskId === taskId && m.type === 'report').pop() ?? null;

  const verdict = getLatestVerdict(taskId);
  const contract = verdict ? getContract(taskId, verdict.contractVersion) : null;
  const criterionVerdicts: TaskOutcomeCriterion[] = (verdict?.criterionVerdicts ?? []).map((v) => ({
    criterionId: v.criterionId,
    text: contract?.criteria.find((c) => c.id === v.criterionId)?.text ?? null,
    status: v.status,
    reasoning: v.reasoning,
    evidence: v.evidence,
  }));

  const outputLogPath = latestRun?.outputFile ?? sidecar?.outputLogPath ?? null;

  const outcome: TaskOutcome = {
    taskId,
    kanban: task.kanban,
    verificationStatus: task.verificationStatus ?? 'unverified',
    verificationAttempts: task.verificationAttempts ?? 0,
    maxVerificationAttempts: maxVerificationAttempts(),
    builder: {
      runId: latestRun?.id ?? null,
      // "" from the sidecar means the builder returned none — kept distinct from
      // null ("no run has reported at all"), because only one of those is a
      // defect in the build.
      summary: sidecar?.summary ? sidecar.summary : null,
      artifacts: sidecar?.artifacts ?? [],
      reportedAt: sidecar?.reportedAt ?? report?.createdAt ?? null,
      inboxBody: report?.body ?? null,
      outputLogPath,
      outputTail: outputTail(outputLogPath),
    },
    verificationRuns: verificationRunsFor(taskId),
    latestVerdict: verdict
      ? { runId: verdict.runId, outcome: verdict.outcome, criterionVerdicts }
      : null,
    deferred: deferralFor(task),
    // The park the dispatcher recorded, and the count that makes it actionable.
    // Read, never recomputed: the dispatcher's own decision is the fact, and this
    // route writes nothing.
    parkedReason: task.parkedReason ?? null,
    pendingDecisions: readJson<{ decisions: DecisionItem[] }>(
      path.join(DATA_DIR, 'decisions.json'),
      { decisions: [] },
    ).decisions.filter((d) => d.taskId === taskId && d.status === 'pending').length,
  };

  return NextResponse.json(outcome);
}
