/**
 * preflight.ts — predict ephemeral-env creation failures before they happen.
 *
 * docs/history/harvest.md §2.1 says install/boot/health are the fragile phases; the
 * cheapest way to stop losing four minutes to a doomed install is to check the
 * machine first. Every check therefore carries its own remedy as *data*: a
 * `fix.kind` from a CLOSED union. applyPreflightFix() executes exactly those
 * four kinds and nothing else — no freeform command ever crosses the wire,
 * which is the safe inverse of "exec whatever the LLM suggested".
 *
 * Every check is fast and offline. No network, no installs, no writes.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  constants,
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isArtifactBoot } from '@ligma/api';
import { DATA_DIR, ENVS_DIR, REPO_ROOT } from '../paths';
import { bootPath, readBoot } from '../store/ligma-dir';
import { findDeadEnvs, isPidAlive, reconcileOrphans } from './manifest';
import type { EnvManifest } from './types';

// ─── Contracts ───────────────────────────────────────────────────────────────

/** The whole vocabulary of remediation. Adding a kind is a code change. */
export const FIX_KINDS = [
  'reconcile-orphans',
  'prune-boot-logs',
  'reset-env-manifest',
  'install-chromium',
] as const;

export type FixKind = (typeof FIX_KINDS)[number];

export type CheckStatus = 'pass' | 'warning' | 'fail';

/** blocking = env creation will fail. warning = it will work, worse. */
export type CheckSeverity = 'info' | 'warning' | 'blocking';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  details?: string;
  fix?: { kind: FixKind; label: string };
}

export interface PreflightResult {
  checks: Check[];
  scannedAt: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export interface PreflightPaths {
  /** The product app dir — where its package.json lives. */
  appDir: string;
  repoRoot: string;
  envsDir: string;
  manifestPath: string;
  ledgerPath: string;
  /** Playwright's browser cache root. */
  browsersDir: string;
}

/** Where playwright unpacks browsers, per platform. */
function playwrightBrowsersDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
      'ms-playwright',
    );
  }
  return path.join(home, '.cache', 'ms-playwright');
}

/**
 * ponytail: anchored on ../paths, the same roots the store and the engine use.
 * The app dir and the repo root are one directory; the store and the env
 * worktrees are not in it (LIGMA_REPO_ROOT / LIGMA_DATA_DIR / LIGMA_ENVS_DIR
 * redirect each).
 */
export function defaultPaths(): PreflightPaths {
  return {
    appDir: REPO_ROOT,
    repoRoot: REPO_ROOT,
    envsDir: ENVS_DIR,
    manifestPath: path.join(DATA_DIR, 'ephemeral-envs.json'),
    ledgerPath: path.join(DATA_DIR, 'quota-ledger.json'),
    browsersDir: playwrightBrowsersDir(),
  };
}

// ─── Small shared helpers ────────────────────────────────────────────────────

const NODE_FLOOR_FALLBACK = 20;
const MIN_FREE_BYTES = 2 * 1024 ** 3;
const STALE_LOG_DAYS = 7;
const GIT_WORKTREE_FLOOR: [number, number] = [2, 30];
/** How long after spawning `playwright install` we still call it "installing". */
const CHROMIUM_INSTALL_WINDOW_MS = 30 * 60_000;

/** Leading integers of a version string. "v22.1.0" → [22,1,0]. */
export function versionParts(raw: string): number[] {
  const m = raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [];
  return m
    .slice(1)
    .filter((p): p is string => p !== undefined)
    .map(Number);
}

/** -1 / 0 / 1, comparing as many components as `b` supplies. */
export function compareVersions(a: string, b: readonly number[]): number {
  const parts = versionParts(a);
  for (let i = 0; i < b.length; i++) {
    const got = parts[i] ?? 0;
    if (got !== b[i]) return got < b[i] ? -1 : 1;
  }
  return 0;
}

/** Node major floor from package.json engines, else NODE_FLOOR_FALLBACK. */
export function nodeFloor(appDir: string): number {
  try {
    const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf-8')) as {
      engines?: { node?: string };
    };
    const declared = versionParts(pkg.engines?.node ?? '')[0];
    return declared ?? NODE_FLOOR_FALLBACK;
  } catch {
    return NODE_FLOOR_FALLBACK;
  }
}

/** Run a binary for its stdout. null = missing or non-zero exit. */
function probe(bin: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(bin, args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** null = the file is corrupt. Missing is not corrupt: it means "no envs yet". */
export function readManifestFile(manifestPath: string): EnvManifest[] | null {
  if (!existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { envs?: EnvManifest[] };
    return Array.isArray(parsed.envs) ? parsed.envs : null;
  } catch {
    return null;
  }
}

/** Boot logs in .envs/ older than `maxAgeDays`. Absolute paths. */
export function staleBootLogs(
  envsDir: string,
  now = Date.now(),
  maxAgeDays = STALE_LOG_DAYS,
): string[] {
  if (!existsSync(envsDir)) return [];
  const cutoff = now - maxAgeDays * 86_400_000;
  return readdirSync(envsDir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => path.join(envsDir, name))
    .filter((file) => {
      try {
        return statSync(file).mtimeMs < cutoff;
      } catch {
        return false;
      }
    });
}

/** Directories in .envs/ with no manifest entry. Counted, never deleted here. */
export function orphanWorktreeDirs(envsDir: string, envs: EnvManifest[]): string[] {
  if (!existsSync(envsDir)) return [];
  const known = new Set(envs.map((e) => e.id));
  return readdirSync(envsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !known.has(d.name))
    .map((d) => path.join(envsDir, d.name));
}

export function chromiumInstallLog(envsDir: string): string {
  return path.join(envsDir, 'chromium-install.log');
}

/** A `chromium-<build>` directory in the browser cache is the whole test. */
export function hasChromium(browsersDir: string): boolean {
  try {
    return readdirSync(browsersDir).some((name) => /^chromium-\d+$/.test(name));
  } catch {
    return false;
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

function checkNode(paths: PreflightPaths, nodeVersion: string): Check {
  const floor = nodeFloor(paths.appDir);
  const ok = compareVersions(nodeVersion, [floor]) >= 0;
  return {
    id: 'node-version',
    label: 'Node version',
    status: ok ? 'pass' : 'fail',
    severity: 'blocking',
    message: ok
      ? `${nodeVersion} (floor: ${floor})`
      : `${nodeVersion} is below the required Node ${floor}`,
    details: `Floor from package.json engines.node, else Node ${NODE_FLOOR_FALLBACK}.`,
  };
}

function checkPnpm(): Check {
  const version = probe('pnpm', ['--version']);
  return {
    id: 'pnpm',
    label: 'pnpm on PATH',
    status: version ? 'pass' : 'fail',
    severity: 'blocking',
    message: version ? `pnpm ${version}` : 'pnpm not found on PATH — install() cannot run',
  };
}

function checkGit(paths: PreflightPaths): Check {
  const raw = probe('git', ['--version']);
  if (!raw) {
    return {
      id: 'git-worktree',
      label: 'git worktree support',
      status: 'fail',
      severity: 'blocking',
      message: 'git not found on PATH',
    };
  }
  if (compareVersions(raw, GIT_WORKTREE_FLOOR) < 0) {
    return {
      id: 'git-worktree',
      label: 'git worktree support',
      status: 'fail',
      severity: 'blocking',
      message: `${raw} is below git ${GIT_WORKTREE_FLOOR.join('.')}`,
    };
  }

  // A rebase in flight makes `git worktree add` unpredictable; detached HEAD is
  // survivable (createEnv resolves HEAD to a commit) but worth saying out loud.
  const gitCommonDir = probe('git', ['rev-parse', '--git-common-dir'], paths.repoRoot);
  const gitDir = gitCommonDir
    ? path.resolve(paths.repoRoot, gitCommonDir)
    : path.join(paths.repoRoot, '.git');
  const rebasing =
    existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply'));
  const branch = probe('git', ['rev-parse', '--abbrev-ref', 'HEAD'], paths.repoRoot);

  if (rebasing) {
    return {
      id: 'git-worktree',
      label: 'git worktree support',
      status: 'fail',
      severity: 'blocking',
      message: 'A rebase is in progress — finish or abort it before creating envs',
      details: gitDir,
    };
  }
  if (branch === 'HEAD') {
    return {
      id: 'git-worktree',
      label: 'git worktree support',
      status: 'warning',
      severity: 'warning',
      message: `${raw}, but HEAD is detached — envs will branch off a bare commit`,
    };
  }
  return {
    id: 'git-worktree',
    label: 'git worktree support',
    status: 'pass',
    severity: 'blocking',
    message: `${raw}, on ${branch ?? 'unknown branch'}`,
  };
}

/**
 * The nearest ancestor that exists, `dir` itself included.
 *
 * The envs root is created on demand and now lives at `~/.ligma/envs`, so on a
 * first run BOTH it and its parent are missing — "can I write the repo root"
 * (what this used to ask) answers a question about a different filesystem.
 */
function nearestExisting(dir: string): string {
  let current = path.resolve(dir);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function checkEnvsRoot(paths: PreflightPaths): Check {
  const target = nearestExisting(paths.envsDir);
  try {
    accessSync(target, constants.W_OK);
  } catch {
    return {
      id: 'envs-root',
      label: '.envs/ writable + disk space',
      status: 'fail',
      severity: 'blocking',
      message: `Not writable: ${target}`,
    };
  }

  let freeBytes: number | null = null;
  try {
    const fs = statfsSync(target);
    freeBytes = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    freeBytes = null;
  }
  const freeGb = freeBytes === null ? null : freeBytes / 1024 ** 3;
  const tight = freeGb !== null && freeBytes !== null && freeBytes < MIN_FREE_BYTES;
  return {
    id: 'envs-root',
    label: '.envs/ writable + disk space',
    status: tight ? 'fail' : 'pass',
    severity: 'blocking',
    message:
      freeGb === null
        ? `Writable: ${target} (free space unknown)`
        : `Writable, ${freeGb.toFixed(1)} GB free${tight ? ` — below the ${MIN_FREE_BYTES / 1024 ** 3} GB floor` : ''}`,
    details: target,
  };
}

function checkManifest(paths: PreflightPaths, envs: EnvManifest[] | null): Check {
  if (envs === null) {
    return {
      id: 'env-manifest',
      label: 'ephemeral-envs.json',
      status: 'fail',
      severity: 'blocking',
      message: 'Manifest is unparseable — every env write will read an empty registry',
      details: paths.manifestPath,
      fix: { kind: 'reset-env-manifest', label: 'Back up and reset manifest' },
    };
  }
  return {
    id: 'env-manifest',
    label: 'ephemeral-envs.json',
    status: 'pass',
    severity: 'blocking',
    message: `Parseable, ${envs.length} env${envs.length === 1 ? '' : 's'} recorded`,
    details: paths.manifestPath,
  };
}

function checkOrphans(paths: PreflightPaths, envs: EnvManifest[] | null): Check {
  const dead = findDeadEnvs(envs ?? [], isPidAlive);
  const orphanDirs = orphanWorktreeDirs(paths.envsDir, envs ?? []);
  const total = dead.length + orphanDirs.length;
  const manifestNote =
    envs === null ? ' (manifest unreadable — every .envs/ directory counts as stray)' : '';
  if (total === 0) {
    return {
      id: 'orphan-envs',
      label: 'Orphaned envs',
      status: 'pass',
      severity: 'warning',
      message: 'No stale envs or stray worktrees',
    };
  }
  return {
    id: 'orphan-envs',
    label: 'Orphaned envs',
    status: 'warning',
    severity: 'warning',
    message: `${dead.length} env(s) claim to be up with a dead process, ${orphanDirs.length} stray worktree dir(s)${manifestNote}`,
    details: [...dead, ...orphanDirs].join('\n'),
    fix: { kind: 'reconcile-orphans', label: 'Reconcile orphans' },
  };
}

function checkBootLogs(paths: PreflightPaths, now: number): Check {
  const stale = staleBootLogs(paths.envsDir, now);
  if (stale.length === 0) {
    return {
      id: 'boot-logs',
      label: 'Boot logs',
      status: 'pass',
      severity: 'info',
      message: `No logs older than ${STALE_LOG_DAYS} days in .envs/`,
    };
  }
  return {
    id: 'boot-logs',
    label: 'Boot logs',
    status: 'warning',
    severity: 'info',
    message: `${stale.length} boot log(s) older than ${STALE_LOG_DAYS} days`,
    details: stale.join('\n'),
    fix: { kind: 'prune-boot-logs', label: `Delete ${stale.length} stale log(s)` },
  };
}

function checkChromium(paths: PreflightPaths, now: number): Check {
  if (hasChromium(paths.browsersDir)) {
    return {
      id: 'playwright-chromium',
      label: 'Playwright chromium',
      status: 'pass',
      severity: 'warning',
      message: 'Chromium build present',
      details: paths.browsersDir,
    };
  }

  // An install spawned by applyPreflightFix keeps writing to this log; a recent
  // one means "in flight", and only a later re-scan finding the binary is proof.
  const log = chromiumInstallLog(paths.envsDir);
  let startedMsAgo: number | null = null;
  try {
    startedMsAgo = now - statSync(log).mtimeMs;
  } catch {
    startedMsAgo = null;
  }
  if (startedMsAgo !== null && startedMsAgo < CHROMIUM_INSTALL_WINDOW_MS) {
    return {
      id: 'playwright-chromium',
      label: 'Playwright chromium',
      status: 'warning',
      severity: 'warning',
      message: `Installing… started ${Math.round(startedMsAgo / 1000)}s ago — re-scan until the binary appears`,
      details: log,
    };
  }
  return {
    id: 'playwright-chromium',
    label: 'Playwright chromium',
    status: 'warning',
    severity: 'warning',
    message: 'No chromium build — browser-driven acceptance tests cannot run',
    details: paths.browsersDir,
    fix: { kind: 'install-chromium', label: 'Install chromium' },
  };
}

/**
 * The boot recipe for one repo (twin-primitives §2).
 *
 * On ligma's own checkout a missing recipe is a warning: journeys cannot be
 * proved, but the task-verification path still boots through the dogfood
 * adapter. In a PRODUCT repo the same absence is blocking — the consumer panel
 * has no other way in — so `blocking` raises the same fact to the same failure
 * class the /launch card already renders. One check, two severities, never two
 * vocabularies.
 */
export function bootRecipeCheck(repoRoot: string, blocking = false): Check {
  const read = readBoot(repoRoot);
  const details = bootPath(repoRoot);
  const severity: CheckSeverity = blocking ? 'blocking' : 'warning';

  if (read.status === 'missing') {
    return {
      id: 'boot-recipe',
      label: 'Boot recipe',
      status: blocking ? 'fail' : 'warning',
      severity,
      message: blocking
        ? `No .ligma/boot.json in ${repoRoot} — the consumer panel cannot boot this product`
        : 'No .ligma/boot.json — journey runs cannot boot this repo',
      details,
    };
  }
  if (read.status === 'invalid') {
    return {
      id: 'boot-recipe',
      label: 'Boot recipe',
      status: 'fail',
      severity,
      message: read.error ?? 'boot.json is not a valid recipe',
      details,
    };
  }
  const boot = read.boot;
  return {
    id: 'boot-recipe',
    label: 'Boot recipe',
    status: 'pass',
    severity: blocking ? 'blocking' : 'info',
    // An artifact recipe has no dev server and no health marker, and saying it
    // does was the fiction H5 removes: this env is a worktree, nothing more.
    message: isArtifactBoot(boot)
      ? `Artifact project — no server. ${boot.artifacts.length} declared artifact(s) in ${boot.appDir}` +
        `${boot.check ? `, check "${boot.check.join(' ')}"` : ''}`
      : `${boot.dev.join(' ')} in ${boot.appDir} (health marker "${boot.healthMarker}")`,
    details,
  };
}

function checkQuotaLedger(paths: PreflightPaths): Check {
  if (!existsSync(paths.ledgerPath)) {
    return {
      id: 'quota-ledger',
      label: 'Quota ledger',
      status: 'pass',
      severity: 'info',
      message: 'No ledger yet — the spawn window is empty',
    };
  }
  try {
    JSON.parse(readFileSync(paths.ledgerPath, 'utf-8'));
  } catch {
    return {
      id: 'quota-ledger',
      label: 'Quota ledger',
      status: 'warning',
      severity: 'warning',
      message: 'Ledger unparseable — the governor will read the window as empty and over-spend',
      details: paths.ledgerPath,
    };
  }
  return {
    id: 'quota-ledger',
    label: 'Quota ledger',
    status: 'pass',
    severity: 'info',
    message: 'Parseable',
    details: paths.ledgerPath,
  };
}

// ─── Scan ────────────────────────────────────────────────────────────────────

export interface PreflightOptions {
  paths?: PreflightPaths;
  now?: number;
  nodeVersion?: string;
}

export function runPreflight(opts: PreflightOptions = {}): PreflightResult {
  const paths = opts.paths ?? defaultPaths();
  const now = opts.now ?? Date.now();
  const envs = readManifestFile(paths.manifestPath);

  return {
    checks: [
      checkNode(paths, opts.nodeVersion ?? process.version),
      checkPnpm(),
      checkGit(paths),
      checkEnvsRoot(paths),
      checkManifest(paths, envs),
      checkOrphans(paths, envs),
      checkBootLogs(paths, now),
      checkChromium(paths, now),
      bootRecipeCheck(paths.repoRoot),
      checkQuotaLedger(paths),
    ],
    scannedAt: new Date(now).toISOString(),
  };
}

/** The first blocking failure, which is what the UI leads with. */
export function firstBlocking(result: PreflightResult): Check | undefined {
  return result.checks.find((c) => c.severity === 'blocking' && c.status !== 'pass');
}

// ─── Fixes ───────────────────────────────────────────────────────────────────

/** Nothing in this module may unlink outside .envs/. */
function assertInsideEnvsDir(target: string, envsDir: string): void {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${path.resolve(envsDir)}${path.sep}`)) {
    throw new Error(`Refusing to delete outside ${envsDir}: ${resolved}`);
  }
}

function startChromiumInstall(paths: PreflightPaths): void {
  mkdirSync(paths.envsDir, { recursive: true });
  const log = chromiumInstallLog(paths.envsDir);
  writeFileSync(log, `[${new Date().toISOString()}] npx playwright install chromium\n`, 'utf-8');
  // Detached: this takes minutes and must outlive the request.
  const child = spawn('npx', ['playwright', 'install', 'chromium'], {
    cwd: paths.appDir,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export interface FixOptions extends PreflightOptions {
  /** Injectable so tests exercise the routing without touching the real manifest. */
  reconcile?: () => void;
}

export interface FixOutcome {
  /** true = the work continues in the background; the result is still a snapshot. */
  started: boolean;
  result: PreflightResult;
}

/**
 * Execute one kind from the closed union, then re-scan. There is deliberately
 * no branch that runs a string: `kind` is the entire instruction set.
 */
export function applyPreflightFix(kind: FixKind, opts: FixOptions = {}): FixOutcome {
  const paths = opts.paths ?? defaultPaths();
  let started = false;

  switch (kind) {
    case 'reconcile-orphans':
      (opts.reconcile ?? reconcileOrphans)();
      break;

    case 'prune-boot-logs':
      for (const file of staleBootLogs(paths.envsDir, opts.now ?? Date.now())) {
        assertInsideEnvsDir(file, paths.envsDir);
        unlinkSync(file);
      }
      break;

    case 'reset-env-manifest':
      // Guarded: only a manifest we cannot parse gets replaced, so a stray click
      // can never discard a healthy registry.
      if (readManifestFile(paths.manifestPath) === null) {
        renameSync(paths.manifestPath, `${paths.manifestPath}.bak-${Date.now()}`);
        writeFileSync(paths.manifestPath, `${JSON.stringify({ envs: [] }, null, 2)}\n`, 'utf-8');
      }
      break;

    case 'install-chromium':
      startChromiumInstall(paths);
      started = true;
      break;
  }

  return { started, result: runPreflight({ ...opts, paths }) };
}
