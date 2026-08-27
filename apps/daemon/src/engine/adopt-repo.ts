/**
 * adopt-repo.ts — brownfield adoption (UX spec F2, build brief §7 D3).
 *
 *   npx tsx src/engine/adopt-repo.ts <adoptionRunId>
 *
 * An adoption run is watchable like any other run. It:
 *   1. reads the repo's own files and infers a `.ligma/boot.json` recipe,
 *   2. boots an ephemeral env from that recipe,
 *   3. lets an exploratory agent crawl the running product and propose journeys,
 *      keeping its confusion log as the first UX audit,
 *   4. parks in `awaiting-review` — nothing is written into the target repo
 *      until a human answers the review sheet.
 *
 * Both agent passes are STRUCTURED OUTPUT (build brief §8): the model returns a
 * fenced JSON block that Zod validates. Nothing is regex-scraped out of prose,
 * and an unparseable reply is a harness `error`, never a claim about the repo.
 *
 * Every spawn goes through `awaitClaimedSlot` + `AgentRunner`, so the quota
 * governor gates adoption exactly as it gates everything else (principle 9).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AdoptionReviewRequest,
  AdoptionReviewResponse,
  AdoptionRun,
  BootRecipe,
  ConfusionEntry,
  Project,
  ProjectShape,
  ProposedAdoptionJourney,
} from '@ligma/api';
import { z } from 'zod';
import { createEnv, teardownEnv } from '../env/lifecycle';
import { type Bridge, startBridge } from '../harness/browser-bridge';
import { parseCliJsonReply } from '../harness/personas';
import { awaitClaimedSlot } from '../harness/spawn-slot';
import { DATA_DIR } from '../paths';
import { mutateProjects } from '../store/data';
import { generateId } from '../store/ids';
import {
  appendProjectMd,
  appendQuirk,
  bootRecipeSchema,
  journeyIdFrom,
  writeBoot,
  writeJourney,
} from '../store/ligma-dir';
import { loadConfig } from './config';
import { OutputWriter } from './output-writer';
import { AgentRunner, modelForBackend } from './runner';
import { enforcePromptLimit } from './security';

export const ADOPTION_RUNS_DIR = path.join(DATA_DIR, 'adoption-runs');

const INFER_MAX_TURNS = 3;
const INFER_TIMEOUT_MINUTES = 5;
const EXPLORE_MAX_TURNS = 40;
const EXPLORE_TIMEOUT_MINUTES = 15;
const README_CHARS = 4000;
const MAX_ENTRIES = 80;

// ─── Run store ───────────────────────────────────────────────────────────────

function runFile(runId: string): string {
  const base = path.basename(runId);
  if (!/^arun_[a-zA-Z0-9_]+$/.test(base)) throw new Error(`Unsafe adoption run id: ${runId}`);
  return path.join(ADOPTION_RUNS_DIR, `${base}.json`);
}

export function saveAdoptionRun(run: AdoptionRun): AdoptionRun {
  mkdirSync(ADOPTION_RUNS_DIR, { recursive: true });
  writeFileSync(runFile(run.id), `${JSON.stringify(run, null, 2)}\n`, 'utf-8');
  return run;
}

export function getAdoptionRun(runId: string): AdoptionRun | null {
  const file = runFile(runId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8')) as AdoptionRun;
}

export function listAdoptionRuns(): AdoptionRun[] {
  if (!existsSync(ADOPTION_RUNS_DIR)) return [];
  return readdirSync(ADOPTION_RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(path.join(ADOPTION_RUNS_DIR, f), 'utf-8')) as AdoptionRun];
      } catch {
        return [];
      }
    });
}

/** Create the run record. The worker process does the work. */
export function createAdoptionRun(repoPath: string): AdoptionRun {
  const resolved = path.resolve(repoPath);
  if (!existsSync(resolved)) throw new Error(`No such directory: ${resolved}`);
  if (!existsSync(path.join(resolved, '.git'))) {
    throw new Error(
      `${resolved} is not a git repository — an ephemeral env is cut from a git worktree`,
    );
  }
  return saveAdoptionRun({
    id: `arun_${Date.now()}`,
    repoPath: resolved,
    projectId: null,
    status: 'running',
    shape: null,
    boot: null,
    bootRationale: '',
    proposedJourneys: [],
    confusionLog: [],
    envId: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
}

// ─── Repo facts (structured, never scraped) ──────────────────────────────────

/** A subdirectory that could BE the app when the repo root is not it. */
export interface AppDirCandidate {
  /** Repo-relative, e.g. "mission-control" or "apps/web". */
  dir: string;
  /** Its package.json `name`, when it has one. */
  name?: string;
  /** Its `scripts.dev` — what makes it a candidate at all. */
  dev: string;
  lockfiles: string[];
  /** The install argv its own lockfile implies. Null when it carries none. */
  install: string[] | null;
}

export interface RepoFacts {
  name: string;
  entries: string[];
  packageJson: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: string[];
    packageManager?: string;
    workspaces?: string[];
  } | null;
  markers: string[];
  readme: string;
  /** Lockfiles at the repo root. Which one is here decides the install argv. */
  lockfiles: string[];
  /** Install argv matching this root's lockfiles, declared packageManager first. */
  installCandidates: string[][];
  /**
   * Directories with their own dev script, gathered only when the root has none
   * — an absent (or non-app) root package.json is exactly when `appDir` has to
   * point somewhere else. `mission-control/mission-control` is the shape.
   */
  appDirs: AppDirCandidate[];
  /** Workspace globs from package.json `workspaces`. `pnpm-workspace.yaml` shows up in `markers`. */
  workspaceGlobs: string[];
}

const MARKER_FILES = [
  'README.md',
  'Dockerfile',
  'docker-compose.yml',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Makefile',
  'next.config.js',
  'next.config.ts',
  'vite.config.ts',
  'pnpm-workspace.yaml',
  'turbo.json',
  'lerna.json',
];

/**
 * Lockfile → the install that resolved it.
 *
 * D3 attempt 3 died on `pnpm install` in a repo whose dependency graph was
 * resolved by bun: the wrong package manager fails before anything boots, and
 * the recipe had no way of knowing because the facts never mentioned lockfiles.
 */
const LOCKFILE_INSTALLS: Record<string, string[]> = {
  'bun.lock': ['bun', 'install'],
  'bun.lockb': ['bun', 'install'],
  'pnpm-lock.yaml': ['pnpm', 'install'],
  'yarn.lock': ['yarn', 'install'],
  'package-lock.json': ['npm', 'ci'],
};

/** package.json's `packageManager` field ("pnpm@10.33.2") → the same argv. */
const PM_INSTALLS: Record<string, string[]> = {
  pnpm: ['pnpm', 'install'],
  bun: ['bun', 'install'],
  yarn: ['yarn', 'install'],
  npm: ['npm', 'ci'],
};

const APP_DIR_LIMIT = 12;

function readPackageJson(dir: string): Record<string, unknown> | null {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    // A broken package.json is a fact the LLM can work around; not fatal here.
    return null;
  }
}

function lockfilesIn(dir: string): string[] {
  return Object.keys(LOCKFILE_INSTALLS).filter((f) => existsSync(path.join(dir, f)));
}

/** Installs this directory's lockfiles imply, the declared package manager first. */
function installsFor(dir: string, packageManager?: string): string[][] {
  const declared = packageManager ? PM_INSTALLS[packageManager.split('@')[0]] : undefined;
  const all = [
    ...(declared ? [declared] : []),
    ...lockfilesIn(dir).map((f) => LOCKFILE_INSTALLS[f]),
  ];
  return all.filter((argv, i) => all.findIndex((other) => other[0] === argv[0]) === i);
}

/**
 * Walk for directories that carry a dev script. One level down, plus one more
 * inside container directories (`apps/`, `packages/`) — a directory with no
 * package.json of its own is a container, not a candidate.
 */
function findAppDirs(repoPath: string): AppDirCandidate[] {
  const found: AppDirCandidate[] = [];

  const dirsOf = (rel: string): string[] => {
    try {
      return readdirSync(path.join(repoPath, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => (rel ? `${rel}/${e.name}` : e.name))
        .slice(0, MAX_ENTRIES);
    } catch {
      return [];
    }
  };

  /** True when `rel` has a package.json — i.e. it is a package, not a container. */
  const consider = (rel: string): boolean => {
    const pkg = readPackageJson(path.join(repoPath, rel));
    if (!pkg) return false;
    const dev = (pkg.scripts as Record<string, string> | undefined)?.dev;
    if (dev) {
      const dirPath = path.join(repoPath, rel);
      found.push({
        dir: rel,
        name: typeof pkg.name === 'string' ? pkg.name : undefined,
        dev,
        lockfiles: lockfilesIn(dirPath),
        install: installsFor(dirPath, pkg.packageManager as string | undefined)[0] ?? null,
      });
    }
    return true;
  };

  for (const top of dirsOf('')) {
    if (found.length >= APP_DIR_LIMIT) break;
    if (consider(top)) continue;
    for (const child of dirsOf(top)) {
      if (found.length >= APP_DIR_LIMIT) break;
      consider(child);
    }
  }
  return found;
}

export function readRepoFacts(repoPath: string): RepoFacts {
  const entries = readdirSync(repoPath, { withFileTypes: true })
    .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
    .slice(0, MAX_ENTRIES)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();

  let packageJson: RepoFacts['packageJson'] = null;
  const pkg = readPackageJson(repoPath);
  if (pkg) {
    packageJson = {
      name: pkg.name as string | undefined,
      scripts: pkg.scripts as Record<string, string> | undefined,
      dependencies: Object.keys((pkg.dependencies as Record<string, string>) ?? {}).slice(0, 60),
      packageManager: pkg.packageManager as string | undefined,
      workspaces: Array.isArray(pkg.workspaces)
        ? (pkg.workspaces as string[]).slice(0, 20)
        : undefined,
    };
  }

  const readmeFile = path.join(repoPath, 'README.md');
  return {
    name: path.basename(repoPath),
    entries,
    packageJson,
    markers: MARKER_FILES.filter((m) => existsSync(path.join(repoPath, m))),
    readme: existsSync(readmeFile) ? readFileSync(readmeFile, 'utf-8').slice(0, README_CHARS) : '',
    lockfiles: lockfilesIn(repoPath),
    installCandidates: installsFor(repoPath, packageJson?.packageManager),
    appDirs: packageJson?.scripts?.dev ? [] : findAppDirs(repoPath),
    workspaceGlobs: packageJson?.workspaces ?? [],
  };
}

/**
 * A recipe straight from the facts — no model involved.
 *
 * This is what the correction editor pre-fills when inference itself failed and
 * there is no inferred recipe to correct: the appDir and install the facts
 * already prove, and placeholders for the two fields only the repo can answer.
 */
export function draftBootFromFacts(facts: RepoFacts): BootRecipe {
  const app = facts.appDirs[0];
  const install = app?.install ?? facts.installCandidates[0] ?? null;
  const runner = install?.[0] ?? 'npm';
  return {
    appDir: app?.dir ?? '.',
    install,
    dev: [runner, 'run', 'dev'],
    portStrategy: { kind: 'flag', flag: '--port' },
    healthPath: '/',
    healthMarker: app?.name ?? facts.packageJson?.name ?? facts.name,
    seed: null,
  };
}

// ─── Agent passes ────────────────────────────────────────────────────────────

const inferenceSchema = z.object({
  shape: z.enum(['ui', 'headless', 'mixed']),
  rationale: z.string().min(1).max(2000),
  boot: bootRecipeSchema,
});

const proposalSchema = z.object({
  journeys: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        goal: z.string().min(1).max(2000),
        steps: z.array(z.string().min(1).max(500)).max(20).default([]),
        tags: z.array(z.string().min(1).max(40)).max(10).default([]),
        rationale: z.string().max(1000).default(''),
      }),
    )
    .max(12)
    .default([]),
  confusion: z
    .array(
      z.object({
        severity: z.enum(['blocker', 'major', 'minor', 'note']),
        summary: z.string().min(1).max(1000),
        evidence: z.array(z.string().max(300)).max(10).default([]),
      }),
    )
    .max(30)
    .default([]),
});

export interface BootInference {
  boot: BootRecipe;
  rationale: string;
  shape: ProjectShape;
}

export interface Exploration {
  journeys: ProposedAdoptionJourney[];
  confusion: ConfusionEntry[];
}

/** The two agent passes, injectable so tests can drive the pipeline without spend. */
export interface AdoptionAgents {
  inferBoot(facts: RepoFacts): Promise<BootInference>;
  explore(input: { bridgeUrl: string; productUrl: string; facts: RepoFacts }): Promise<Exploration>;
}

function buildInferencePrompt(facts: RepoFacts): string {
  return enforcePromptLimit(
    [
      'You are inferring how to boot an unfamiliar repository so an acceptance harness can run it.',
      'Do not write code. Do not use any tools. Answer only from the facts below.',
      '',
      `Repository directory name: ${facts.name}`,
      `Top-level entries: ${facts.entries.join(', ')}`,
      `Marker files present: ${facts.markers.join(', ') || '(none)'}`,
      `Lockfiles at the repo root: ${facts.lockfiles.join(', ') || '(none)'}`,
      `Install commands those imply, best first: ${
        facts.installCandidates.map((argv) => JSON.stringify(argv)).join(', ') || '(none)'
      }`,
      `Workspace globs declared in package.json: ${facts.workspaceGlobs.join(', ') || '(none)'}`,
      '',
      'Root package.json:',
      facts.packageJson
        ? JSON.stringify(facts.packageJson, null, 2)
        : '(none — the repo root is NOT the app)',
      '',
      'Candidate app directories (each has its own dev script and its own lockfile):',
      facts.appDirs.length > 0
        ? JSON.stringify(facts.appDirs, null, 2)
        : '(none — the root has the dev script)',
      '',
      'README (truncated):',
      facts.readme || '(none)',
      '',
      'Decide:',
      '- `shape`: "ui" if a human uses it through a browser, "headless" for an API/CLI/library/service, "mixed" for both.',
      '- `boot`: the recipe for standing the product up in a throwaway checkout.',
      '',
      'Rules for `boot`:',
      '- Every command is an ARGV ARRAY, never a shell string: ["pnpm","install"], not "pnpm install".',
      '- `appDir` is repo-relative ("." for the root) — the directory the commands run in.',
      '  When a candidate app directory is listed above, `appDir` IS that directory, never ".": a repo whose',
      '  root has no package.json (or no dev script) cannot be installed or booted from its root.',
      '- `install` MUST match the lockfile that actually sits next to `appDir`. bun.lock → ["bun","install"],',
      '  pnpm-lock.yaml → ["pnpm","install"], yarn.lock → ["yarn","install"], package-lock.json → ["npm","ci"].',
      "  Pick one of the install commands listed above (the candidate directory's own `install`, when there is",
      '  one) — a package manager whose lockfile the repo does not carry fails before anything boots.',
      '- `install` is null if the repo needs no dependency step. `seed` is null if it needs no fixtures.',
      '- `dev` must stay in the foreground. Never use a flag that daemonizes or detaches it.',
      '- `portStrategy` says how the dev command learns its port. Envs run CONCURRENTLY, so choose a',
      '  settable strategy whenever the dev tool has one — and nearly all of them do:',
      '    {"kind":"flag","flag":"--port"} vite, vitepress, astro, nuxt, remix, ng serve, uvicorn',
      '    {"kind":"flag","flag":"-p"}     next dev, http-server',
      '    {"kind":"env","var":"PORT"}     react-scripts, nest, express/node servers, rails, gradle bootRun',
      '    {"kind":"fixed","port":3000}    LAST RESORT — only when the dev command takes no port flag and',
      '                                    reads no port variable. A dev server handed a busy port moves to the',
      '                                    next free one instead of failing, so a fixed port that collides makes',
      '                                    the env unreachable forever.',
      '  A flag or variable the tool does not understand is worse than `fixed`, so name one you can point at',
      "  in the package.json script or the tool's own documented interface.",
      '- `healthMarker` is a short literal string that must appear in the RAW HTML the server returns,',
      '  BEFORE any JavaScript runs. A dev server for a client-rendered app (vite, vitepress, CRA, Vue CLI)',
      '  serves an empty shell — often an empty <title> and no product name anywhere — so a heading you',
      '  expect to see in the browser will never match. For those, pick a literal from the shell itself',
      '  (e.g. `<div id="app">` or the entry script path). Never a generic word like "html".',
      '- `healthPath` is the path to fetch, usually "/". Redirects are followed, so a site served under a',
      '  base path (e.g. "/docs/") is fine.',
      '',
      'Reply with NOTHING but a single fenced JSON block in exactly this shape:',
      '```json',
      '{',
      '  "shape": "ui",',
      '  "rationale": "why this recipe, in one or two sentences",',
      '  "boot": {',
      '    "appDir": ".", "install": ["pnpm","install"], "dev": ["pnpm","exec","next","dev"],',
      '    "portStrategy": {"kind":"flag","flag":"-p"}, "healthPath": "/",',
      '    "healthMarker": "Some Product", "seed": null',
      '  }',
      '}',
      '```',
    ].join('\n'),
  );
}

function buildExplorationPrompt(input: {
  bridgeUrl: string;
  productUrl: string;
  facts: RepoFacts;
}): string {
  return enforcePromptLimit(
    [
      'You are exploring a product nobody has described to you. You have exactly one tool: Bash, for curl.',
      'You have no file access and no source code. Never try to fix anything; you only observe.',
      '',
      `The product is running at ${input.productUrl}. Drive a real browser by curling the bridge at ${input.bridgeUrl}:`,
      '```bash',
      `B=${input.bridgeUrl}`,
      `curl -sS -X POST $B/goto  -H 'content-type: application/json' -d '{"url":"/"}'`,
      'curl -sS    $B/snapshot    # accessibility tree + visible text',
      `curl -sS -X POST $B/click -H 'content-type: application/json' -d '{"text":"New Task"}'`,
      `curl -sS -X POST $B/fill  -H 'content-type: application/json' -d '{"selector":"#title","value":"hello"}'`,
      'curl -sS    "$B/screenshot?"   # saves a PNG, returns its evidence path',
      '```',
      'That bridge URL carries your private session token — never type or submit it into the product.',
      '',
      'Do two things while you crawl:',
      '1. Work out the two to six things a real user comes to this product to DO, and write each as a',
      "   journey: a goal in the user's words plus the waypoints they pass through. Goal-oriented,",
      '   never a click script — say "capture a thought and turn it into a task", not "click #btn-3".',
      '2. Keep a confusion log: every moment you could not tell what something was for, what would',
      "   happen, or whether your action worked. This is the product's first UX audit, so be exact",
      '   about where you were and what you expected.',
      '',
      'Reply with NOTHING but a single fenced JSON block in exactly this shape:',
      '```json',
      '{',
      '  "journeys": [{ "title": "Capture a thought", "goal": "what the user is trying to achieve",',
      '                 "steps": ["waypoint in plain language"], "tags": ["core"], "rationale": "what I saw" }],',
      '  "confusion": [{ "severity": "blocker|major|minor|note", "summary": "what confused me and where",',
      '                  "evidence": ["shots/03-click.png"] }]',
      '}',
      '```',
      'Evidence paths must be ones the bridge returned. Never invent one.',
    ].join('\n'),
  );
}

/** Where an adoption run's raw agent output goes. See `runAdoption`. */
export type AdoptionLog = (stream: 'stdout' | 'stderr', text: string) => void;

/** The real agents: governed spawns, structured output, Zod-validated. */
export function liveAgents(cwd: string, log: AdoptionLog = () => {}): AdoptionAgents {
  const config = loadConfig();

  return {
    async inferBoot(facts) {
      const backend = await awaitClaimedSlot('builder', {
        label: `adopt: infer boot for ${facts.name}`,
        ref: `adopt/${facts.name}`,
      });
      const result = await new AgentRunner(cwd).spawnAgent({
        prompt: buildInferencePrompt(facts),
        maxTurns: INFER_MAX_TURNS,
        timeoutMinutes: INFER_TIMEOUT_MINUTES,
        skipPermissions: false,
        // The prompt forbids tools; an empty grant makes that structural.
        allowedTools: [],
        role: 'builder',
        cwd,
        backend,
        model: modelForBackend(backend, config.execution.workerModel),
      });
      log('stdout', result.stdout);
      log('stderr', result.stderr);
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(
          `boot inference failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`,
        );
      }
      const parsed = inferenceSchema.parse(parseCliJsonReply(result.stdout, 'boot inference'));
      return { boot: parsed.boot, rationale: parsed.rationale, shape: parsed.shape };
    },

    async explore(input) {
      const backend = await awaitClaimedSlot('persona', {
        label: `adopt: explore ${input.facts.name}`,
        ref: `adopt/${input.facts.name}/explore`,
      });
      const result = await new AgentRunner(cwd).spawnAgent({
        prompt: buildExplorationPrompt(input),
        maxTurns:
          config.execution.maxTurns > EXPLORE_MAX_TURNS
            ? config.execution.maxTurns
            : EXPLORE_MAX_TURNS,
        timeoutMinutes: EXPLORE_TIMEOUT_MINUTES,
        skipPermissions: false,
        // Same grant the persona panel gets: curl and nothing else.
        allowedTools: ['Bash'],
        role: 'persona',
        cwd,
        backend,
        model: modelForBackend(backend, config.execution.harness.personaModel),
      });
      log('stdout', result.stdout);
      log('stderr', result.stderr);
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(
          `exploration failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`,
        );
      }
      const parsed = proposalSchema.parse(parseCliJsonReply(result.stdout, 'exploration'));
      return parsed;
    },
  };
}

// ─── The pipeline ────────────────────────────────────────────────────────────

export interface RunAdoptionOptions {
  agents?: AdoptionAgents;
  /** Skip the ephemeral env (no boot, no bridge). Used by the smoke test. */
  skipEnv?: boolean;
}

export async function runAdoption(
  runId: string,
  opts: RunAdoptionOptions = {},
): Promise<AdoptionRun> {
  const run = getAdoptionRun(runId);
  if (!run) throw new Error(`No such adoption run: ${runId}`);

  const facts = readRepoFacts(run.repoPath);
  // The run's own log, in the same append-only JSONL every other run streams
  // from — so `GET /api/runs/:id/output` serves an adoption run with no special
  // case, and a run that died keeps what its install and boot actually printed.
  const log: AdoptionLog = (stream, text) => OutputWriter.appendSync(run.id, stream, text);
  const agents = opts.agents ?? liveAgents(run.repoPath, log);
  let envId: string | null = null;
  let bridge: Bridge | null = null;

  log('stdout', `[adopt] ${run.repoPath}\n`);
  log(
    'stdout',
    `[adopt] facts: ${JSON.stringify({
      lockfiles: facts.lockfiles,
      installCandidates: facts.installCandidates,
      appDirs: facts.appDirs,
      workspaceGlobs: facts.workspaceGlobs,
      rootPackageJson: facts.packageJson !== null,
    })}\n`,
  );

  try {
    // A retry that carries a corrected recipe boots from it instead of asking
    // the model again — that IS the correction loop (F2 recovery).
    const inference = run.boot
      ? { boot: run.boot, rationale: run.bootRationale, shape: run.shape ?? 'headless' }
      : await agents.inferBoot(facts);
    log('stdout', `[adopt] boot recipe: ${JSON.stringify(inference.boot)}\n`);
    run.boot = inference.boot;
    run.bootRationale = inference.rationale;
    run.shape = inference.shape;
    saveAdoptionRun(run);

    let exploration: Exploration = { journeys: [], confusion: [] };
    if (opts.skipEnv) {
      exploration = await agents.explore({ bridgeUrl: '', productUrl: '', facts });
    } else {
      const env = await createEnv({
        repoPath: run.repoPath,
        bootRecipe: inference.boot,
        boot: true,
      });
      envId = env.id;
      run.envId = env.id;
      saveAdoptionRun(run);
      if (!env.url) throw new Error(`env ${env.id} came up without a URL`);

      const runDir = path.join(ADOPTION_RUNS_DIR, run.id);
      mkdirSync(runDir, { recursive: true });
      bridge = await startBridge({ origin: env.url, runDir });
      const session = await bridge.session('explorer');
      exploration = await agents.explore({ bridgeUrl: session.url, productUrl: env.url, facts });
    }

    run.proposedJourneys = exploration.journeys;
    run.confusionLog = exploration.confusion;
    run.status = 'awaiting-review';
    run.finishedAt = new Date().toISOString();
    return saveAdoptionRun(run);
  } catch (err) {
    // D3: an adoption that breaks is recoverable, not a dead end — the run keeps
    // its log, and `retryAdoption` goes again from a corrected recipe.
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
    log('stderr', `[adopt] ${run.error}\n`);
    return saveAdoptionRun(run);
  } finally {
    if (bridge) await bridge.close().catch(() => {});
    if (envId) {
      await teardownEnv(envId, undefined, run.repoPath).catch((e: unknown) => {
        console.error(`[adopt] teardown: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
}

/**
 * Go again on a run that failed (F2 recovery).
 *
 * With `boot` the corrected recipe is pinned and `runAdoption` boots straight
 * from it — the same schema the review sheet POSTs, because it is the same
 * correction. Without one the run re-infers from scratch. Either way the run
 * keeps its id, so its log grows rather than starting over somewhere new.
 */
export function retryAdoption(runId: string, boot?: unknown): AdoptionRun {
  const run = getAdoptionRun(runId);
  if (!run) throw new Error(`No such adoption run: ${runId}`);
  if (run.status === 'running') throw new Error(`Adoption run ${runId} is still running`);
  if (run.status === 'applied') throw new Error(`Adoption run ${runId} was already applied`);

  run.boot = boot === undefined || boot === null ? null : bootRecipeSchema.parse(boot);
  run.status = 'running';
  run.error = null;
  run.startedAt = new Date().toISOString();
  run.finishedAt = null;
  return saveAdoptionRun(run);
}

// ─── Review ──────────────────────────────────────────────────────────────────

/**
 * Apply the human's answers: create the project, write `.ligma/` into the target
 * repo, and record the confusion log as the project's first note. This is the
 * ONLY place adoption writes into someone else's repository.
 */
export async function applyAdoptionReview(
  runId: string,
  review: AdoptionReviewRequest,
): Promise<AdoptionReviewResponse> {
  const run = getAdoptionRun(runId);
  if (!run) throw new Error(`No such adoption run: ${runId}`);
  if (run.status === 'applied') throw new Error(`Adoption run ${runId} was already applied`);
  if (run.status === 'running') throw new Error(`Adoption run ${runId} is still running`);

  const boot = bootRecipeSchema.parse(review.boot ?? run.boot);
  const shape = review.shape ?? run.shape ?? 'headless';

  const project = await mutateProjects(async (data) => {
    const existing = data.projects.find((p) => p.repoPath === run.repoPath && !p.deletedAt);
    if (existing) {
      existing.shape = shape;
      return existing;
    }
    const created: Project = {
      id: generateId('proj'),
      name: review.name ?? path.basename(run.repoPath),
      description: run.bootRationale,
      status: 'active',
      color: '#3b82f6',
      teamMembers: [],
      createdAt: new Date().toISOString(),
      tags: ['adopted'],
      deletedAt: null,
      repoPath: run.repoPath,
      shape,
    };
    data.projects.push(created);
    return created;
  });

  writeBoot(run.repoPath, boot);

  const acceptedJourneyIds: string[] = [];
  let rejected = 0;
  for (const decision of review.journeys) {
    const proposal = decision.edited ?? run.proposedJourneys[decision.index];
    if (!proposal) throw new Error(`No proposed journey at index ${decision.index}`);
    if (decision.action === 'reject') {
      rejected++;
      continue;
    }
    const journey = writeJourney(run.repoPath, {
      id: journeyIdFrom(proposal.title),
      title: proposal.title,
      goal: proposal.goal,
      steps: proposal.steps,
      tags: proposal.tags,
      origin: 'discovery',
      schedule: null,
    });
    acceptedJourneyIds.push(journey.id);
  }

  if (run.confusionLog.length > 0) {
    // The confusion log IS the project's first list of quirks — the things that
    // surprised the first thing to touch this repo. It lands under the one
    // conventional heading rather than a dated section of its own, so Knowledge
    // has somewhere to render it and later quirks join it instead of scattering.
    appendQuirk(
      run.repoPath,
      [
        'First UX audit (adoption crawl):',
        '',
        ...run.confusionLog.map((c) => `- **${c.severity}** — ${c.summary}`),
      ].join('\n'),
      `adoption:${run.id}`,
    );
  }

  run.projectId = project.id;
  run.status = 'applied';
  saveAdoptionRun(run);

  return {
    runId: run.id,
    projectId: project.id,
    repoPath: run.repoPath,
    acceptedJourneyIds,
    rejected,
  };
}

// ─── CLI (the detached worker the adopt route spawns) ────────────────────────

if (require.main === module) {
  const runId = process.argv[2];
  if (!runId) {
    console.error('Usage: npx tsx src/engine/adopt-repo.ts <adoptionRunId>');
    process.exit(1);
  }
  runAdoption(runId)
    .then((run) => {
      console.log(`[adopt] ${run.id} → ${run.status}${run.error ? `: ${run.error}` : ''}`);
      if (run.status === 'error') process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    });
}
