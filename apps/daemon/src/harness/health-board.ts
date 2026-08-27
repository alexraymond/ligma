/**
 * health-board.ts — the join nothing in the product was doing: **contracts**
 * (what "done" was frozen to mean) against **verdicts** (what was actually
 * proven), at two grains.
 *
 * `projectHealthFor` is the portfolio grain — one number per project, served
 * beside the project list so Home's cards can say how much of each project is
 * proven instead of how many tickets were moved.
 *
 * `criteriaHealthFor` is the Overview grain — one row per criterion in the
 * project's contracts, each carrying the latest ruling and the run that made it.
 *
 * Read-only, and deliberately re-implemented on top of `fs` rather than
 * importing `contract-store`/`verdict`: those pull in signing, cross-process
 * locks and `child_process`, none of which belongs in a route handler. Same
 * argument the contracts route already makes for itself.
 *
 * ponytail: both entry points walk the run directory once per call, newest
 * first, and stop as soon as every scope has an answer. Upgrade path if a
 * workspace ever grows enough runs for that to show up in a poll: an index
 * file beside the runs, written when a verdict lands.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  AcceptanceContract,
  CriterionHealthRow,
  ProjectHealth,
  Task,
  VerificationRunManifest,
  VerificationVerdict,
} from '@ligma/api';
import { DATA_DIR } from '../paths';

/** Roots are env-overridable exactly as the read routes' own helpers are. */
function runsRoot(): string {
  return path.resolve(
    process.env.VERIFICATION_RUNS_DIR || path.join(DATA_DIR, 'verification-runs'),
  );
}

function contractsRoot(): string {
  return path.resolve(process.env.CONTRACTS_DIR || path.join(DATA_DIR, 'contracts'));
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Run directories newest first, by mtime — every lookup below can stop early. */
function runDirsNewestFirst(): string[] {
  const root = runsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path.join(root, e.name)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { name: e.name, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map((e) => e.name);
}

/** The manifest + verdict of one run directory, when both are readable. */
interface RunPair {
  manifest: VerificationRunManifest;
  verdict: VerificationVerdict | null;
}

function readRun(name: string): RunPair | null {
  const dir = path.join(runsRoot(), name);
  const manifest = readJson<VerificationRunManifest>(path.join(dir, 'run.json'));
  if (!manifest) return null;
  return { manifest, verdict: readJson<VerificationVerdict>(path.join(dir, 'verdict.json')) };
}

/**
 * The newest finished run per task, across the whole locker, in one walk.
 *
 * This is what makes a fifty-card board cost zero extra fetches: the task list
 * route joins against this map rather than the client opening one run per card
 * (the N+1 the board would otherwise need).
 */
export function latestRunByTask(): Map<string, VerificationRunManifest> {
  const out = new Map<string, VerificationRunManifest>();
  for (const name of runDirsNewestFirst()) {
    const pair = readRun(name);
    const taskId = pair?.manifest.taskId;
    if (!taskId || out.has(taskId)) continue;
    out.set(taskId, pair.manifest);
  }
  return out;
}

/**
 * One project's verified-ness.
 *
 * The denominator is tasks that *carry acceptance criteria* — a task with none
 * can never be verified, and counting it against the project would make every
 * project look permanently unproven. `lastVerifiedAt` is the newest run behind
 * the passing tasks, which is what the client's staleness decay measures from.
 */
export function projectHealthFor(
  projectId: string,
  tasks: Task[],
  latestRuns: Map<string, VerificationRunManifest> = latestRunByTask(),
): ProjectHealth {
  const mine = tasks.filter((t) => t.projectId === projectId && !t.deletedAt);
  const verifiable = mine.filter((t) => (t.acceptanceCriteria ?? []).length > 0);
  const verified = verifiable.filter((t) => t.verificationStatus === 'passed');

  let lastVerifiedAt: string | null = null;
  for (const task of verified) {
    const at = latestRuns.get(task.id)?.finishedAt ?? null;
    if (at && (lastVerifiedAt === null || at > lastVerifiedAt)) lastVerifiedAt = at;
  }

  return {
    projectId,
    verifiable: verifiable.length,
    verified: verified.length,
    percent: verifiable.length === 0 ? 0 : Math.round((verified.length / verifiable.length) * 100),
    lastVerifiedAt,
  };
}

/** Every project's health in one walk of the run locker. */
export function projectHealthAll(projectIds: string[], tasks: Task[]): ProjectHealth[] {
  const latestRuns = latestRunByTask();
  return projectIds.map((id) => projectHealthFor(id, tasks, latestRuns));
}

// ─── Criterion grain ─────────────────────────────────────────────────────────

/** The highest version of every contract in `scopes`, read once per scope. */
function latestContracts(scopes: string[]): AcceptanceContract[] {
  const out: AcceptanceContract[] = [];
  for (const scope of scopes) {
    const file = path.join(contractsRoot(), `${path.basename(scope)}.jsonl`);
    if (!existsSync(file)) continue;
    let latest: AcceptanceContract | null = null;
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const contract = JSON.parse(line) as AcceptanceContract;
        if (latest === null || contract.version > latest.version) latest = contract;
      } catch {
        // A corrupt line means part of the oracle is unreadable — the rest of
        // the board is still worth rendering, so skip the line, not the file.
        console.error(`[harness/health-board] skipping unparseable line in ${file}`);
      }
    }
    if (latest) out.push(latest);
  }
  return out;
}

/** The newest verdict per contract scope, plus when its run finished. */
function latestVerdictByScope(
  scopes: Set<string>,
): Map<string, { verdict: VerificationVerdict; finishedAt: string | null }> {
  const out = new Map<string, { verdict: VerificationVerdict; finishedAt: string | null }>();
  for (const name of runDirsNewestFirst()) {
    if (out.size >= scopes.size) break;
    const pair = readRun(name);
    if (!pair?.verdict) continue;
    const scope = scopeOf(
      pair.verdict.taskId,
      pair.verdict.projectId ?? null,
      pair.verdict.journeyId ?? null,
    );
    if (scope === null || !scopes.has(scope) || out.has(scope)) continue;
    out.set(scope, { verdict: pair.verdict, finishedAt: pair.manifest.finishedAt });
  }
  return out;
}

/** A contract's scope key: a task id, or `<projectId>__<journeyId>` for a journey. */
export function scopeOf(
  taskId: string | null,
  projectId: string | null,
  journeyId: string | null,
): string | null {
  if (taskId) return taskId;
  if (projectId && journeyId) return `${projectId}__${journeyId}`;
  return null;
}

/**
 * Every criterion this project has frozen, with what the judge last said.
 *
 * Scopes come from two places because contracts do: one per promoted task, and
 * one per journey the project proves. A criterion no verdict has ever ruled on
 * is `unverified` — the honest state, never a silent pass.
 */
export function criteriaHealthFor(
  projectId: string,
  tasks: Task[],
  journeyIds: string[],
): CriterionHealthRow[] {
  const taskScopes = tasks
    .filter((t) => t.projectId === projectId && !t.deletedAt)
    .map((t) => t.id);
  const journeyScopes = journeyIds.map((jid) => `${projectId}__${jid}`);
  const contracts = latestContracts([...taskScopes, ...journeyScopes]);
  if (contracts.length === 0) return [];

  const verdicts = latestVerdictByScope(
    new Set(contracts.map((c) => c.taskId ?? c.productId ?? '')),
  );

  return contracts.flatMap((contract) => {
    const scope = contract.taskId ?? contract.productId ?? '';
    const found = verdicts.get(scope);
    const journeyId =
      contract.taskId === null && scope.startsWith(`${projectId}__`)
        ? scope.slice(projectId.length + 2)
        : null;

    return contract.criteria.map((criterion): CriterionHealthRow => {
      const ruling = found?.verdict.criterionVerdicts.find((c) => c.criterionId === criterion.id);
      return {
        scope,
        contractId: contract.id,
        title: contract.title,
        taskId: contract.taskId,
        journeyId,
        criterionId: criterion.id,
        text: criterion.text,
        kind: criterion.kind,
        holdout: criterion.holdout,
        // A harness `error` proved nothing about the product, so it leaves the
        // criterion unverified rather than marking it not-met (principle 12).
        status: found && found.verdict.outcome !== 'error' && ruling ? ruling.status : 'unverified',
        reasoning: found && found.verdict.outcome !== 'error' && ruling ? ruling.reasoning : '',
        runId: found?.verdict.runId ?? null,
        verifiedAt: found?.finishedAt ?? null,
      };
    });
  });
}
