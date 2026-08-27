/**
 * run-journey.ts — "Prove it": one journey run, end to end.
 *
 *   npx tsx src/harness/run-journey.ts <projectId> <journeyId> [--smoke]
 *
 * A journey run IS a verification run with a nullable taskId (twin-primitives
 * §4). Everything downstream — env lifecycle, browser bridge, persona panel,
 * fail-default judge, Ed25519-signed verdict, evidence locker — is the existing
 * pipeline, untouched. The only new things are the boot-recipe adapter (the env
 * comes from `.ligma/boot.json` instead of a hardcoded adapter) and this entry
 * point, which walks a journey instead of a task.
 *
 * Baselines: the FIRST run characterizes — it records what the product
 * currently does, centrally, under `data/projects/<id>/baselines/`, never in the
 * repo. Later runs are judged comparatively: the recorded outcomes are compiled
 * into the contract, so "this used to work" becomes something the judge can fail
 * on with evidence.
 *
 * Error handling follows the D3 rule: a boot failure or a judge crash is a
 * harness `error`, never a journey `failed`.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BaselineStep, Journey, JourneyBaseline, Project, RunFailureCause } from '@ligma/api';
import { loadConfig } from '../engine/config';
import { isKillSwitchActive, killSwitchFilePath } from '../engine/quota-governor';
import { createEnv, teardownEnv } from '../env/lifecycle';
import { DATA_DIR } from '../paths';
import { readBoot, readJourney } from '../store/ligma-dir';
import { observationOf, readBaseline, writeBaseline } from './baselines';
import type { Bridge, BridgeTransport } from './bridge-server';
import { saveContract } from './contract-store';
import { runJudge } from './judge';
import { panelRoster, panelTransports, startPanelBridge } from './panel';
import { type PersonaSpec, allInvalidByApiFault, runPersona } from './personas';
import { recordProbes } from './probes';
// The panel pool, shared with the task-verification path so both honour
// `maxParallelPersonas` identically. No cycle: run-verification does not import
// this module, and its CLI entry is behind `require.main === module`.
import { mapWithLimit } from './run-verification';
import type {
  AcceptanceContract,
  Criterion,
  PersonaReport,
  VerificationRunManifest,
  VerificationVerdict,
} from './types';
import { RUNS_DIR, appendHumanDecisions } from './verdict';

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

export interface JourneyRunOptions {
  projectId: string;
  journeyId: string;
  /** Two spawns instead of six — what the integration test and smoke runs use. */
  smoke?: boolean;
  /** Test seam: skip the real env/bridge/panel and judge these reports instead. */
  stub?: JourneyRunStub;
}

/**
 * The stub seam the integration test drives. It replaces exactly the three
 * things that cost money or a browser — the env, the bridge and the panel — and
 * leaves the contract, the baseline write, the judge call and the verdict
 * signing on their real code paths.
 */
export interface JourneyRunStub {
  productUrl: string;
  /** Reports to judge as-is — the cheapest seam, and the one most tests want. */
  reports?: PersonaReport[];
  /**
   * Or: run a panel yourself inside the real run dir and return what it found.
   * The headless integration test uses this to drive REAL bridges against
   * fixture products, so the evidence the baseline quotes is evidence a bridge
   * actually wrote rather than a literal in a test file.
   */
  panel?(runDir: string, contract: AcceptanceContract): Promise<PersonaReport[]>;
  /**
   * `scope` is what the real judge folds INTO the signed payload (E8). A stub
   * that signs (the headless test drives the real `runJudge`) must pass it on
   * for the same reason; a stub that returns `signature: null` may ignore it and
   * gets it stamped on afterwards.
   */
  judge(
    contract: AcceptanceContract,
    reports: PersonaReport[],
    runDir: string,
    scope: { journeyId: string; projectId: string },
  ): Promise<VerificationVerdict>;
}

export interface JourneyRunResult {
  runId: string;
  runDir: string;
  manifest: VerificationRunManifest;
  verdict: VerificationVerdict | null;
  /** Central path of the baseline this run recorded, or null if it compared. */
  baselinePath: string | null;
}

// ─── Oracle ──────────────────────────────────────────────────────────────────

/**
 * The contract scope for a journey. Contracts are versioned per scope, so each
 * journey gets its own history instead of every journey in a project bumping
 * every other one's version.
 */
export function journeyScope(projectId: string, journeyId: string): string {
  return `${projectId}__${journeyId}`;
}

/**
 * Compile the journey into criteria.
 *
 * Nothing is held out: a journey lives in the repo by design (the visible
 * slice), so pretending part of it is secret would be theatre. What IS withheld
 * is the baseline — it stays central and tool-denied.
 *
 * With a baseline present the criteria carry what the baseline recorded, which
 * is how "everything comparative against baseline" (principle 8) is expressed
 * in a pipeline that only knows how to judge criteria.
 */
export function journeyCriteria(journey: Journey, baseline: JourneyBaseline | null): Criterion[] {
  const reached = new Map((baseline?.steps ?? []).map((s) => [s.index, s]));

  const steps: Criterion[] = journey.steps.map((text, i) => {
    const was = reached.get(i);
    const comparative =
      was?.outcome === 'reached'
        ? ` (the recorded baseline reached this step${was.note ? `: ${was.note}` : ''} — a regression here is a failure)`
        : '';
    return {
      id: `crit_${i + 1}`,
      kind: 'criterion' as const,
      text: `${text}${comparative}`,
      holdout: false,
      provenance: { source: `journey:${journey.id}`, quote: text },
    };
  });

  return [
    {
      id: 'crit_goal',
      kind: 'criterion' as const,
      text: `A user can accomplish this without help: ${journey.goal}`,
      holdout: false,
      provenance: { source: `journey:${journey.id}`, quote: journey.goal },
    },
    ...steps,
  ];
}

/**
 * The panel for a journey, chosen by the project's shape and the journey's tags
 * (UX spec §3): a UI journey gets browser personas, a headless one gets consumer
 * personas, a mixed project gets both. `panel.ts` owns the decision; this is the
 * journey's way of asking it.
 */
export function journeyRoster(
  smoke: boolean,
  transports: BridgeTransport[] = ['browser'],
): PersonaSpec[] {
  return panelRoster(transports, { smoke, naiveRuns: 3, kind: 'journey' });
}

// ─── Baseline ────────────────────────────────────────────────────────────────

const OUTCOME_BY_STATUS = {
  met: 'reached',
  'not-met': 'blocked',
  'not-tested': 'not-attempted',
} as const;

/** Charters that walk a journey — whichever transport they walked it on. */
const WALKERS = new Set(['naive-user', 'naive-developer']);

/**
 * What a headless bridge actually observed, read off the artifact the persona
 * cited — never off its prose, and never off its claim.
 *
 * This is what "baselines record response schemas and exit codes instead of
 * screenshots" means in practice: the bridge wrote the record, the persona could
 * only choose which one to point at, and the characterization quotes the record.
 * A schema that changes or an exit code that flips therefore lands in the next
 * run's criteria as a regression the judge can fail on with evidence.
 */
export function describeRecord(runDir: string, relPath: string): string | null {
  if (!relPath.endsWith('.json') || !relPath.includes('/records/')) return null;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(readFileSync(path.join(runDir, relPath), 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null; // An unreadable record characterizes nothing.
  }
  if (Array.isArray(record.argv)) {
    const argv = (record.argv as unknown[])
      .filter((a): a is string => typeof a === 'string')
      .join(' ');
    const exit = record.timedOut ? 'timed out' : `exit ${record.exitCode ?? 'killed'}`;
    return `\`${argv}\` → ${exit}`;
  }
  if (typeof record.method === 'string') {
    const path_ = typeof record.url === 'string' ? new URL(record.url).pathname : '?';
    const status =
      record.status === null || record.status === undefined ? 'no response' : `${record.status}`;
    const schema = typeof record.schema === 'string' ? `, body ${record.schema}` : '';
    return `${record.method} ${path_} → ${status}${schema}`;
  }
  return null;
}

/**
 * Turn the panel's structured output into a characterization record. Every
 * field here comes from a report the agents produced in a fixed schema, or from
 * a record the bridge itself wrote — no prose is parsed to get it (brief §8).
 *
 * `runDir` is optional so the browser path, which has nothing to read, is
 * unchanged: its evidence is a PNG and the note is the auditor's status.
 */
export function buildBaseline(
  projectId: string,
  journey: Journey,
  runId: string,
  reports: PersonaReport[],
  evidence: string[],
  runDir?: string,
): JourneyBaseline {
  const auditor = reports.find((r) => r.charter === 'spec-auditor');
  const walker = reports.find((r) => WALKERS.has(r.charter)) ?? reports[0];
  const byId = new Map((auditor?.criterionResults ?? []).map((r) => [r.criterionId, r]));

  const steps: BaselineStep[] = journey.steps.map((step, i) => {
    const result = byId.get(`crit_${i + 1}`);
    const cited = result?.evidence[0] ?? null;
    const observed = cited && runDir ? describeRecord(runDir, cited) : null;
    return {
      index: i,
      step,
      outcome: result ? OUTCOME_BY_STATUS[result.status] : 'not-attempted',
      note: result
        ? `spec-auditor: ${result.status}${observed ? ` — ${observed}` : ''}`
        : 'not reported by the panel',
      // The run-relative evidence path: a screenshot for a browser journey, the
      // request/response or command record for a headless one.
      screenshot: cited,
      // The same evidence as fields — status codes and exit codes a later run
      // can compare without parsing the note above.
      ...(runDir ? { observed: observationOf(runDir, cited) } : {}),
    };
  });

  return {
    projectId,
    journeyId: journey.id,
    runId,
    recordedAt: new Date().toISOString(),
    steps,
    // Headless runs have none; their evidence is the per-step records above.
    screenshots: evidence.filter((p) => p.endsWith('.png')),
    metrics: {
      timeOnTaskMs: walker?.elapsedMs ?? 0,
      misclicks: walker?.wrongTurns ?? 0,
      stepCount: walker?.stepCount ?? 0,
      goalAchieved: walker?.goalAchieved ?? null,
    },
    findings: reports.flatMap((r) =>
      r.findings.map((f) => ({ severity: f.severity, summary: f.summary })),
    ),
  };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

function getProject(projectId: string): Project {
  const data = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8')) as { projects: Project[] };
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

/** Every file under the run dir, as run-relative posix paths. */
function evidenceIndex(runDir: string, dir = runDir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'sandbox') out.push(...evidenceIndex(runDir, full));
    else if (entry.isFile()) out.push(path.relative(runDir, full).split(path.sep).join('/'));
  }
  return out.sort();
}

export async function runJourney(opts: JourneyRunOptions): Promise<JourneyRunResult> {
  const project = getProject(opts.projectId);
  if (!project.repoPath) {
    throw new Error(`Project ${project.id} has no repoPath — nothing to boot a journey against`);
  }
  const boot = readBoot(project.repoPath);
  if (boot.status !== 'ready') {
    throw new Error(
      boot.error ??
        `${project.repoPath}/.ligma/boot.json is missing — adopt the repo before proving a journey`,
    );
  }
  const journey = readJourney(project.repoPath, opts.journeyId);
  if (!journey) throw new Error(`Journey not found: ${opts.journeyId}`);

  if (isKillSwitchActive()) {
    throw new Error(
      `Quota governor kill switch is active (config or ${killSwitchFilePath()}) — refusing to start a journey run.`,
    );
  }

  const config = loadConfig();
  const harness = config.execution.harness;
  const runId = `vrun_${Date.now()}`;
  const runDir = path.join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  // Central, builder-denied. Read BEFORE the env exists so a repo that somehow
  // contains a baseline file cannot be mistaken for the real one.
  const baseline = readBaseline(project.id, journey.id);

  const contract = saveContract({
    taskId: null,
    productId: journeyScope(project.id, journey.id),
    title: `Journey: ${journey.title}`,
    baselineRunId: baseline?.runId ?? null,
    criteria: journeyCriteria(journey, baseline),
  });

  const manifest: VerificationRunManifest = {
    id: runId,
    taskId: null,
    journeyId: journey.id,
    projectId: project.id,
    contractId: contract.id,
    contractVersion: contract.version,
    envId: null,
    baseCommit: '',
    status: 'running',
    pid: process.pid,
    personaReports: [],
    verdictPath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  const writeManifest = (): void =>
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  writeManifest();

  let envId: string | null = null;
  // What a throw from here on would mean. Narrowed at the step that owns the
  // risk, so the failure card names a cause we actually established rather than
  // one read back out of an error string.
  let causeKind: RunFailureCause = 'harness';
  // Only ever set alongside causeKind "rate-limit" or "auth" — mirrors
  // GovernorAbort.resumesAt (quota-governor.ts).
  let resumesAt: string | undefined;
  const bridges: Bridge[] = [];
  let verdict: VerificationVerdict | null = null;
  let baselinePath: string | null = null;

  try {
    let reports: PersonaReport[];
    // Where each report was actually written, collected as it is produced.
    // Deriving these from the reports collapsed every seeded walker of one
    // charter onto `<charter>-1` — a 3-run naive panel recorded one path three
    // times and 2/3 of the evidence links pointed at files that do not exist
    // (codebase audit E8). `runPersona` writes under `personas/<spec.name>/`,
    // so the roster's own names are the only truthful source.
    let reportPaths: string[];

    if (opts.stub) {
      reports = opts.stub.panel
        ? await opts.stub.panel(runDir, contract)
        : (opts.stub.reports ?? []);
      reportPaths = reports.map((report) => writeReport(runDir, report));
    } else {
      causeKind = 'env';
      const env = await createEnv({
        productId: project.id,
        repoPath: project.repoPath,
        bootRecipe: boot.boot,
        boot: true,
      });
      causeKind = 'harness';
      envId = env.id;
      manifest.envId = env.id;
      manifest.baseCommit = env.baseCommit;
      writeManifest();

      // Shape-aware panel selection (UX spec §3): ui → browser, headless →
      // consumer, mixed → both, with the journey's own tags overriding.
      const transports = panelTransports(project.shape ?? 'ui', journey.tags, env.url !== null);
      const roster = journeyRoster(opts.smoke ?? false, transports);

      // One bridge per transport; every persona gets its own session on the one
      // its charter was written for.
      const sessions = new Map<string, string>();
      for (const transport of transports) {
        const bridge = await startPanelBridge(transport, {
          runDir,
          productUrl: env.url,
          worktreePath: env.worktreePath,
          appDir: boot.boot.appDir,
          // An artifact project's journey is read, not driven: what may be read
          // and the one command that may be run both come from the recipe.
          ...(boot.boot.dev === null
            ? { artifacts: boot.boot.artifacts, check: boot.boot.check }
            : {}),
        });
        bridges.push(bridge);
        for (const spec of roster.filter((s) => (s.transport ?? 'browser') === transport)) {
          sessions.set(spec.name, (await bridge.session(spec.name)).url);
        }
      }

      // Same pool the task-verification panel uses, at the same configured
      // width. A plain sequential loop ignored `maxParallelPersonas` entirely
      // and, because `runner.ts` blocks on a spawn slot with `Atomics.wait`,
      // each admission stalled the whole event loop for up to 4s with nothing
      // else in flight (codebase audit E24). `mapWithLimit` preserves roster
      // order and drains the pool before rethrowing, so the `finally` below
      // never tears the env down under a persona still driving it.
      reports = await mapWithLimit(roster, harness.maxParallelPersonas, (spec) =>
        runPersona({
          spec,
          runId,
          runDir,
          bridgeUrl: sessions.get(spec.name)!,
          productUrl: env.url ?? '',
          contract,
          // The goal, never the step list: a naive user must discover the flow.
          goal: journey.goal,
          maxTurns: config.execution.maxTurns,
          timeoutMinutes: config.execution.timeoutMinutes,
        }),
      );
      reportPaths = roster.map((s) => path.posix.join('personas', s.name, 'report.json'));
    }

    manifest.personaReports = reportPaths;
    writeManifest();

    // Every persona invalidated by the SAME class of backend fault (429 / auth)
    // means the panel produced no usable evidence at all — running the judge
    // anyway would let its fail-default gate silently upgrade "the backend
    // refused us" into "the journey failed" (core principle 12: error ≠
    // failed). A panel with even one non-API-caused invalid run, or one clean
    // run, still has evidence to weigh — that stays on the existing path.
    const apiFault = allInvalidByApiFault(reports);
    if (apiFault) {
      causeKind = apiFault.causeKind;
      resumesAt = apiFault.resumesAt;
      throw new Error(
        `all ${reports.length} persona run(s) invalidated by an API-level fault (${causeKind}) before producing usable evidence — nothing to judge`,
      );
    }

    const index = evidenceIndex(runDir);
    const scope = { journeyId: journey.id, projectId: project.id };
    if (opts.stub) {
      const stubbed = await opts.stub.judge(contract, reports, runDir, scope);
      // "A stub verdict is never signed" was wrong: the headless integration
      // test's stub IS the real judge with only its LLM spawn replaced, so it
      // signs. Stamping scope onto a SIGNED verdict is exactly the E8 bug —
      // it puts the payload outside its own signature. Signed stubs already
      // carry scope (it was handed to them above); only unsigned doubles get it
      // stamped, and there is no signature there to fall outside of.
      verdict = stubbed.signature ? stubbed : { ...stubbed, ...scope };
    } else {
      verdict = await runJudge({
        contract,
        reports,
        runId,
        taskId: null,
        // Inside the signed payload. Spreading these on afterwards is what
        // made every journey verdict fail verify() (E8).
        ...scope,
        runDir,
        evidenceIndex: index,
        judgeModel: harness.judgeModel,
        builderModel: null,
        maxTurns: config.execution.maxTurns,
        timeoutMinutes: config.execution.timeoutMinutes,
      });
    }

    writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');
    manifest.verdictPath = 'verdict.json';

    // Characterize on the first run only. A harness error characterizes nothing —
    // "the judge crashed" is not a description of the product (D3).
    if (!baseline && verdict.outcome !== 'error') {
      baselinePath = writeBaseline(
        buildBaseline(project.id, journey, runId, reports, evidenceIndex(runDir), runDir),
      );
    }

    // No applyVerdict: a journey run has no task to move, unblock or re-queue.
    // Findings a test cannot express still reach the human.
    await appendHumanDecisions(verdict);

    // Every failure joins the regression corpus, so the next "Prove it" on this
    // journey is re-asking a question the product is already known to get wrong.
    recordProbes(project.id, verdict, contract);

    manifest.status = verdict.outcome === 'error' ? 'error' : 'complete';
    // The judge classified its own malfunction; carry that word through rather
    // than re-deciding it here.
    if (verdict.outcome === 'error') manifest.causeKind = verdict.causeKind ?? 'harness';
    manifest.finishedAt = new Date().toISOString();
    writeManifest();
  } catch (err) {
    manifest.status = 'error';
    manifest.error = err instanceof Error ? err.message : String(err);
    manifest.causeKind = causeKind;
    if (resumesAt) manifest.resumesAt = resumesAt;
    manifest.finishedAt = new Date().toISOString();
    writeManifest();
    throw err;
  } finally {
    for (const bridge of bridges)
      await bridge.close().catch((e) => console.error(`[run-journey] bridge close: ${e}`));
    if (envId) {
      try {
        await teardownEnv(envId, undefined, project.repoPath);
      } catch (e) {
        console.error(`[run-journey] teardown: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { runId, runDir, manifest, verdict, baselinePath };
}

function personaDirName(report: PersonaReport): string {
  return report.personaSeed === null ? report.charter : `${report.charter}-1`;
}

/**
 * Write one stub report and return its path relative to `runDir`, so the
 * manifest records where the file actually is rather than re-deriving a name.
 * Stub-path only — a real persona writes its own report from `runPersona`.
 */
function writeReport(runDir: string, report: PersonaReport): string {
  const rel = path.posix.join('personas', personaDirName(report), 'report.json');
  const file = path.join(runDir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  return rel;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const argv = process.argv.slice(2);
  const [projectId, journeyId] = argv.filter((a) => !a.startsWith('--'));
  if (!projectId || !journeyId) {
    console.error('Usage: npx tsx src/harness/run-journey.ts <projectId> <journeyId> [--smoke]');
    process.exit(1);
  }
  runJourney({ projectId, journeyId, smoke: argv.includes('--smoke') })
    .then((result) => {
      console.log(`[run-journey] ${result.runId} → ${result.verdict?.outcome ?? 'no verdict'}`);
      if (result.baselinePath)
        console.log(`[run-journey] baseline recorded at ${result.baselinePath}`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    });
}
