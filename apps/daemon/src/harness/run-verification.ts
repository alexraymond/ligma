/**
 * run-verification.ts — one acceptance run, end to end.
 *
 *   npx tsx src/harness/run-verification.ts <taskId> [--smoke] [--mutate <script.ts>]
 *
 *   contract → ephemeral env → bridge(s) → persona panel → judge → verdict
 *
 * Which bridge, and therefore which personas, comes from the project's shape:
 * a UI app is verified by browser personas, a headless one by consumer personas
 * over HTTP or a terminal, a mixed one by both (UX spec §3).
 *
 * Exit codes: 0 verdict written (pass OR fail — a failed verdict is a successful
 * run), 1 the run itself broke, 2 no contract for the task.
 *
 * --smoke runs naive-user ×1 + spec-auditor (2 spawns instead of 6) for wiring
 * checks and for the harness's own acceptance test.
 * --mutate loads a module whose default export patches the fresh worktree before
 * install — how we plant a known defect and prove the panel catches it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type BootRecipe,
  type Project,
  type ProjectShape,
  type RunFailureCause,
  isArtifactBoot,
} from '@ligma/api';
import { loadConfig } from '../engine/config';
import {
  BACKENDS,
  GovernorAbort,
  isKillSwitchActive,
  killSwitchFilePath,
  refundSpawn,
} from '../engine/quota-governor';
import { headSha } from '../engine/run-changes';
import { taskProductEnv } from '../engine/task-env';
import type { Backend } from '../engine/types';
import { createEnv, teardownEnv } from '../env/lifecycle';
import { generateId } from '../store/ids';
import type { Bridge, BridgeTransport } from './bridge-server';
import { getLatestContract } from './contract-store';
import { runJudge } from './judge';
import { panelTransports, startPanelBridge, transportRoster } from './panel';
import { type PersonaSpec, allInvalidByApiFault, runPersona } from './personas';
import { recordProbes } from './probes';
import type {
  AcceptanceContract,
  PersonaReport,
  VerificationRunManifest,
  VerificationVerdict,
} from './types';
import {
  RUNS_DIR,
  type RunErrorKind,
  appendHumanDecisions,
  applyVerdict,
  refundVerificationAttempt,
} from './verdict';

import { DATA_DIR } from '../paths';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  projectId?: string | null;
}

/**
 * The shape of the project this task belongs to, defaulting to "ui".
 *
 * A task run has no journey and therefore no tags, so the shape is the only
 * signal — and a task on no project is the dogfood path, which is a web app.
 */
export function taskShape(projectId: string | null | undefined): ProjectShape {
  if (!projectId || !existsSync(PROJECTS_FILE)) return 'ui';
  try {
    const data = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8')) as { projects: Project[] };
    return data.projects.find((p) => p.id === projectId)?.shape ?? 'ui';
  } catch {
    return 'ui';
  }
}

/** Per-phase wall clock, stamped into run.json alongside the pinned manifest. */
interface RunTimings {
  envMs: number | null;
  bridgeMs: number | null;
  personasMs: number | null;
  judgeMs: number | null;
  teardownMs: number | null;
  totalMs: number | null;
}

// ─── Roster ──────────────────────────────────────────────────────────────────

/**
 * The acceptance panel for one transport. Browser by default — a task run on the
 * dogfood env is a web app — but a headless project gets consumer personas
 * instead, which is the whole point of the bridges having siblings.
 */
export function buildRoster(
  smoke: boolean,
  naiveRuns: number,
  transport: BridgeTransport = 'browser',
): PersonaSpec[] {
  return transportRoster(transport, { smoke, naiveRuns, kind: 'acceptance' });
}

/**
 * Fixed-size worker pool with cooperative cancellation. Order of results matches
 * order of specs.
 *
 * The first failure stops new work but the pool is still awaited to completion
 * before rethrowing. A bare `Promise.all` rejected immediately while the other
 * workers kept pulling specs — so the caller's `finally` tore the env and bridge
 * down underneath personas that were still driving a browser against them.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown = null;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      if (failure !== null) return; // someone else failed; stop taking work
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        if (failure === null) failure = err;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failure !== null) throw failure;
  return results;
}

/** Every file under the run dir, as run-relative posix paths. */
function evidenceIndex(runDir: string, dir = runDir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // The persona sandboxes are deliberately empty; don't index them.
    if (entry.isDirectory() && entry.name !== 'sandbox') out.push(...evidenceIndex(runDir, full));
    else if (entry.isFile()) out.push(path.relative(runDir, full).split(path.sep).join('/'));
  }
  return out.sort();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface Args {
  taskId: string;
  smoke: boolean;
  mutatePath: string | null;
  judgeSlot: Backend | null;
}

/**
 * The first bare word is the task id — every other positional is a flag's value,
 * so `--judge-slot claude` must not be mistaken for one.
 */
export function parseArgs(argv: string[]): Args {
  const valueFlags = new Set(['--mutate', '--judge-slot']);
  const taken = new Set<number>();
  argv.forEach((a, i) => {
    if (valueFlags.has(a)) taken.add(i + 1);
  });
  const taskId = argv.find((a, i) => !a.startsWith('--') && !taken.has(i));
  if (!taskId) {
    console.error(
      'Usage: npx tsx src/harness/run-verification.ts <taskId> [--smoke] [--mutate <script.ts>] [--judge-slot <backend>]',
    );
    process.exit(1);
  }
  const mutateIdx = argv.indexOf('--mutate');
  if (mutateIdx !== -1 && !argv[mutateIdx + 1]) {
    console.error('--mutate requires a module path (relative to src/harness/)');
    process.exit(1);
  }
  const slotIdx = argv.indexOf('--judge-slot');
  const slot = slotIdx === -1 ? null : argv[slotIdx + 1];
  return {
    taskId,
    smoke: argv.includes('--smoke'),
    mutatePath: mutateIdx === -1 ? null : argv[mutateIdx + 1],
    // An unrecognised backend is ignored rather than trusted: the judge then
    // claims its own slot, which is the old behaviour and always safe.
    judgeSlot: slot && (BACKENDS as readonly string[]).includes(slot) ? (slot as Backend) : null,
  };
}

async function loadMutation(rel: string): Promise<(worktreePath: string) => void> {
  const resolved = path.isAbsolute(rel) ? rel : path.resolve(__dirname, rel);
  const mod = (await import(resolved)) as { default?: unknown };
  if (typeof mod.default !== 'function') {
    throw new Error(`${resolved} must default-export (worktreePath: string) => void`);
  }
  return mod.default as (worktreePath: string) => void;
}

function getTask(taskId: string): TaskRow {
  const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as { tasks: TaskRow[] };
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

export interface VerificationRunOptions {
  taskId: string;
  smoke?: boolean;
  /** Patch the fresh worktree before install — how a known defect is planted. */
  mutate?: (worktreePath: string) => void;
  /**
   * A judge slot the DAEMON already claimed for this run (C2). Set, the judge
   * spends it directly instead of queueing behind the panel it is meant to
   * adjudicate; null, it claims its own, which is what a hand-run does.
   *
   * It is refunded here if the run dies before the judge is ever reached — the
   * one place that knows both that a slot was booked and that nothing spent it.
   */
  judgeSlot?: Backend | null;
  /**
   * The two spawns a test cannot afford. Everything else — the env, the boot
   * recipe, the transports, the bridges, the contract, the verdict signing and
   * `applyVerdict` — stays on its real code path, so what a stubbed run proves
   * about the wiring is true of a real one.
   */
  stub?: {
    persona?: typeof runPersona;
    judge?: typeof runJudge;
  };
}

export interface VerificationRunResult {
  runId: string;
  runDir: string;
  manifest: VerificationRunManifest;
  verdict: VerificationVerdict | null;
}

export async function runVerification(
  opts: VerificationRunOptions,
): Promise<VerificationRunResult> {
  const { taskId } = opts;
  const smoke = opts.smoke ?? false;
  const runPersonaFn = opts.stub?.persona ?? runPersona;
  const runJudgeFn = opts.stub?.judge ?? runJudge;

  const contract: AcceptanceContract | null = getLatestContract(taskId);
  if (!contract) throw new Error(`No acceptance contract for ${taskId}`);

  // Don't boot an environment we are forbidden to test in. Personas and the judge
  // check this too, but finding out after a four-minute install is worse.
  if (isKillSwitchActive()) {
    // The daemon claimed an attempt when it spawned us. Nothing ran, so nothing
    // was tested — give it back, or a switched-off governor eats the cap.
    await refundVerificationAttempt(taskId, 'governor-denied');
    throw new Error(
      `Quota governor kill switch is active (config or ${killSwitchFilePath()}) — refusing to start a verification run.`,
    );
  }

  const task = getTask(taskId);
  const config = loadConfig();
  const harness = config.execution.harness;
  // generateId, not Date.now(): the dispatcher spawns several runs in one tick,
  // and same-millisecond ids merged unrelated runs into one evidence directory.
  const runId = generateId('vrun');
  const runDir = path.join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const t0 = Date.now();
  const timings: RunTimings = {
    envMs: null,
    bridgeMs: null,
    personasMs: null,
    judgeMs: null,
    teardownMs: null,
    totalMs: null,
  };

  const manifest: VerificationRunManifest = {
    id: runId,
    taskId,
    contractId: contract.id,
    contractVersion: contract.version,
    envId: null,
    baseCommit: '',
    status: 'running',
    // D5: without this a killed run keeps its task hostage — a "running" string
    // whose process is gone is indistinguishable from a live one.
    pid: process.pid,
    personaReports: [],
    verdictPath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  // Did any persona get past the governor and actually start? The refund below
  // turns on this, never on the shape of an error message.
  let panelStarted = false;
  /** Did the run get as far as calling the judge with its pre-claimed slot? */
  let judgeReached = false;
  /** Set only in the catch, from what the throw structurally WAS. */
  let errorKind: RunErrorKind | null = null;

  // Extra `timings` and `errorKind` keys beyond the pinned
  // VerificationRunManifest — additive, so readers of the pinned shape are
  // unaffected.
  const writeManifest = (): void =>
    writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify({ ...manifest, timings, errorKind }, null, 2),
      'utf-8',
    );
  writeManifest();

  console.log(
    `[run-verification] ${runId} task=${taskId} contract=${contract.id} v${contract.version} smoke=${smoke}`,
  );

  let envId: string | null = null;
  // What a throw from here on would mean — narrowed at the step that owns the
  // risk, never guessed from the message afterwards.
  let causeKind: RunFailureCause = 'harness';
  // Only ever set alongside causeKind "rate-limit" or "auth" — mirrors
  // GovernorAbort.resumesAt (quota-governor.ts).
  let resumesAt: string | undefined;
  let product: { repoPath: string; boot: BootRecipe } | null = null;
  let verdict: VerificationVerdict | null = null;
  const bridges: Bridge[] = [];

  try {
    const tEnv = Date.now();
    // A task on a product repo is verified against THAT product, booted from its
    // own recipe. A ligma-self task keeps the dogfood adapter, unchanged — which
    // is what `taskProductEnv` returning null means.
    product = taskProductEnv(task.projectId);
    causeKind = 'env';
    const env = await createEnv({
      taskId,
      boot: true,
      mutate: opts.mutate,
      ...(product
        ? {
            productId: task.projectId ?? null,
            repoPath: product.repoPath,
            bootRecipe: product.boot,
          }
        : {}),
    });
    timings.envMs = Date.now() - tEnv;
    causeKind = 'harness';
    envId = env.id;
    manifest.envId = env.id;
    manifest.baseCommit = env.baseCommit;
    writeManifest();
    console.log(
      `[run-verification] env ${env.id} ready at ${env.url ?? '(no url)'} (${timings.envMs}ms)`,
    );

    // Shape-aware panel selection (UX spec §3). A task carries no journey tags,
    // so its project's shape is the only signal.
    const transports = panelTransports(taskShape(task.projectId), [], env.url !== null);
    const roster = transports.flatMap((transport) =>
      buildRoster(smoke, harness.naiveUserRuns, transport).map((spec) => ({
        ...spec,
        name: transports.length > 1 ? `${spec.name}-${transport}` : spec.name,
      })),
    );
    // The goal is deliberately NOT criterion text: naive and returning users must
    // not be handed the checklist they are supposed to discover.
    const goal = task.description?.trim() || task.title;

    const tBridge = Date.now();
    const sessions = new Map<string, string>();
    for (const transport of transports) {
      const bridge = await startPanelBridge(transport, {
        runDir,
        productUrl: env.url,
        worktreePath: env.worktreePath,
        // A terminal panel runs where the product was built, not at the worktree
        // root — the recipe is the only thing that knows the difference.
        ...(product ? { appDir: product.boot.appDir } : {}),
        // An artifact panel reads what the recipe declared, and may run only the
        // one command it declared. Both come from the recipe, never the persona.
        ...(product && isArtifactBoot(product.boot)
          ? { artifacts: product.boot.artifacts, check: product.boot.check }
          : {}),
      });
      bridges.push(bridge);
      console.log(`[run-verification] ${transport} bridge on ${bridge.url}`);
      for (const spec of roster.filter((s) => (s.transport ?? 'browser') === transport)) {
        sessions.set(spec.name, (await bridge.session(spec.name)).url);
      }
    }
    timings.bridgeMs = Date.now() - tBridge;

    const tPersonas = Date.now();
    const reports: PersonaReport[] = await mapWithLimit(
      roster,
      harness.maxParallelPersonas,
      async (spec) => {
        console.log(`[run-verification] persona ${spec.name} starting`);
        const report = await runPersonaFn({
          spec,
          runId,
          runDir,
          bridgeUrl: sessions.get(spec.name)!,
          productUrl: env.url ?? '',
          contract,
          goal,
          maxTurns: config.execution.maxTurns,
          timeoutMinutes: config.execution.timeoutMinutes,
        });
        // A returned report means this persona was granted its quota slot and ran —
        // the panel has started, whatever happens next.
        panelStarted = true;
        console.log(
          `[run-verification] persona ${spec.name} done: invalid=${report.invalid} steps=${report.stepCount} findings=${report.findings.length}`,
        );
        return report;
      },
    );
    timings.personasMs = Date.now() - tPersonas;

    manifest.personaReports = roster.map((s) => path.posix.join('personas', s.name, 'report.json'));
    writeManifest();

    // Every persona invalidated by the SAME class of backend fault (429 / auth)
    // means the panel produced no usable evidence at all — running the judge
    // anyway would let its fail-default gate silently upgrade "the backend
    // refused us" into "the product failed" (core principle 12: error ≠
    // failed). A panel with even one non-API-caused invalid run, or one clean
    // run, still has evidence to weigh — that stays on the existing path,
    // where computeOutcome's load-bearing-charter check already covers it.
    const apiFault = allInvalidByApiFault(reports);
    if (apiFault) {
      causeKind = apiFault.causeKind;
      resumesAt = apiFault.resumesAt;
      throw new Error(
        `all ${reports.length} persona run(s) invalidated by an API-level fault (${causeKind}) before producing usable evidence — nothing to judge`,
      );
    }

    const tJudge = Date.now();
    judgeReached = true;
    verdict = await runJudgeFn({
      contract,
      reports,
      claimedSlot: opts.judgeSlot ?? null,
      runId,
      taskId,
      runDir,
      // What this verdict is a statement ABOUT: HEAD of the product's own repo,
      // read now rather than at env-creation time, so it names the code the
      // panel actually exercised. A ligma-self task has no product repo, and a
      // repo-less product yields null — in both cases the verdict says so
      // instead of borrowing the factory's commit and implying otherwise.
      commitSha: headSha(product?.repoPath),
      evidenceIndex: evidenceIndex(runDir),
      judgeModel: harness.judgeModel,
      builderModel: config.execution.workerModel,
      maxTurns: config.execution.maxTurns,
      timeoutMinutes: config.execution.timeoutMinutes,
    });
    timings.judgeMs = Date.now() - tJudge;

    writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');
    manifest.verdictPath = 'verdict.json';

    await applyVerdict(verdict);
    const decisions = await appendHumanDecisions(verdict);

    // Every failure joins the project's regression corpus. A task verdict has
    // no journey to re-run, so the probe records the criterion and its evidence
    // and the corpus links back to this verdict — the origin, never a dead end.
    if (task.projectId) recordProbes(task.projectId, verdict, contract);

    manifest.status = 'complete';
    if (verdict.outcome === 'error') manifest.causeKind = verdict.causeKind ?? 'harness';
    manifest.finishedAt = new Date().toISOString();
    timings.totalMs = Date.now() - t0;
    writeManifest();

    console.log(`\n[run-verification] verdict: ${verdict.outcome.toUpperCase()}`);
    for (const v of verdict.criterionVerdicts)
      console.log(`  ${v.criterionId}: ${v.status} — ${v.reasoning.slice(0, 160)}`);
    if (decisions > 0) console.log(`  ${decisions} decision card(s) raised for the human`);
    console.log(`[run-verification] evidence: data/verification-runs/${runId}/`);
  } catch (err) {
    manifest.status = 'error';
    manifest.error = err instanceof Error ? err.message : String(err);
    manifest.causeKind = causeKind;
    if (resumesAt) manifest.resumesAt = resumesAt;
    manifest.finishedAt = new Date().toISOString();
    timings.totalMs = Date.now() - t0;
    // The governor refused the panel's spawns and no persona ever started: this
    // run tested nothing, so it must not spend one of the task's attempts (D4).
    // Recorded structurally here, at the only site that knows both facts.
    if (err instanceof GovernorAbort && !panelStarted) errorKind = 'governor-denied';
    writeManifest();
    await refundVerificationAttempt(taskId, errorKind);
    // The daemon booked a judge slot for a judge that never ran. Hand it back, or
    // an env that fails to boot quietly eats a session out of every window.
    if (opts.judgeSlot && !judgeReached) refundSpawn('judge', taskId, opts.judgeSlot);
    console.error(`[run-verification] run failed: ${manifest.error}`);
    throw err;
  } finally {
    // Teardown is unconditional: a leaked worktree or dev server outlives the run.
    const tDown = Date.now();
    for (const bridge of bridges)
      await bridge.close().catch((e) => console.error(`[run-verification] bridge close: ${e}`));
    if (envId) {
      try {
        // The worktree was cut from the product's repo, so that is the repo the
        // worktree must be removed from.
        await teardownEnv(envId, undefined, product?.repoPath);
      } catch (err) {
        console.error(
          `[run-verification] teardown: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    timings.teardownMs = Date.now() - tDown;
    timings.totalMs = Date.now() - t0;
    writeManifest();
  }

  return { runId, runDir, manifest, verdict };
}

/**
 * The CLI. Exit codes are the contract the dispatcher spawns against: 0 a
 * verdict was written (pass OR fail), 1 the run itself broke, 2 no contract.
 */
async function main(): Promise<void> {
  const { taskId, smoke, mutatePath, judgeSlot } = parseArgs(process.argv.slice(2));

  if (!getLatestContract(taskId)) {
    console.error(
      `No acceptance contract for ${taskId}. Compile one first:\n` +
        `  npx tsx src/harness/compile-contract.ts ${taskId}`,
    );
    process.exit(2);
  }

  try {
    await runVerification({
      taskId,
      smoke,
      judgeSlot,
      mutate: mutatePath ? await loadMutation(mutatePath) : undefined,
    });
  } catch {
    // runVerification already wrote the error into the manifest and said so.
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
