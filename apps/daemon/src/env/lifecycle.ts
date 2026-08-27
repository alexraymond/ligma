/**
 * lifecycle.ts — createEnv / teardownEnv / listEnvs.
 *
 * createEnv drives the state machine and stamps every transition and duration
 * into the manifest before attempting the next step, so a crashed or killed run
 * is diagnosable from data/ephemeral-envs.json alone.
 *
 * All git invocations use execFileSync with an argv array. Never a shell string:
 * env ids and branch names must never be interpolated into a command line.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BootRecipe } from '@ligma/api';
import { assertFixedPortFree, createBootAdapter, fixedPort } from './boot-adapter';
import {
  ENVS_DIR,
  REPO_ROOT,
  getEnv,
  patchEnv,
  putEnv,
  listEnvs as readManifest,
} from './manifest';
import { createMissionControlAdapter, getFreePort } from './mission-control-adapter';
import type { EnvManifest, PhaseTimings, TargetAdapter } from './types';

export { reconcileOrphans } from './manifest';

export interface CreateEnvOptions {
  taskId?: string | null;
  productId?: string | null;
  /**
   * Commit to check out. Defaults to a snapshot commit of the CURRENT working
   * tree (D2) — the builder's uncommitted work is what needs verifying, not HEAD.
   */
  baseCommit?: string;
  /** false = worktree + install only (builder isolation, nothing served). */
  boot?: boolean;
  /** PRNG seed for the seeded dataset. Same seed ⇒ same data. */
  seed?: number;
  /**
   * The git repo the worktree is cut from. Defaults to ligma itself; an adopted
   * project points at its own checkout (twin-primitives §1).
   */
  repoPath?: string;
  /**
   * `.ligma/boot.json`. Given one, the env boots through the generic boot
   * adapter instead of the dogfood adapter — that is the whole generalization.
   */
  bootRecipe?: BootRecipe;
  adapter?: TargetAdapter;
  /**
   * Patch the fresh worktree before install/boot. Runs inside the worktree phase,
   * so a throw fails env creation instead of booting a half-patched product.
   * Used by the harness acceptance test to plant a known defect.
   */
  mutate?: (worktreePath: string) => void;
}

function git(args: string[], cwd = REPO_ROOT, env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: env ?? process.env }).trim();
}

function newEnvId(): string {
  return `env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Snapshot the working tree into a dangling commit (D2).
 *
 * The builder edits the live working tree and never commits, so checking out
 * HEAD verifies code the builder did not write — worse than not verifying at
 * all. Everything here runs against a THROWAWAY index (GIT_INDEX_FILE), and
 * commit-tree writes a commit no ref points at, so the user's index, working
 * tree and branches are untouched. `add -A` respects .gitignore and picks up
 * untracked work.
 */
function snapshotWorkingTree(taskId: string | null, repoRoot: string): string {
  const indexFile = path.join(os.tmpdir(), `mc-verify-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    git(['read-tree', 'HEAD'], repoRoot, env);
    git(['add', '-A'], repoRoot, env);
    const tree = git(['write-tree'], repoRoot, env);
    return git(
      ['commit-tree', tree, '-p', 'HEAD', '-m', `verification snapshot ${taskId ?? 'adhoc'}`],
      repoRoot,
      env,
    );
  } finally {
    rmSync(indexFile, { force: true });
  }
}

export function listEnvs(): EnvManifest[] {
  return readManifest();
}

/** Guard: nothing in this module may delete outside ENVS_DIR (~/.ligma/envs). */
function assertInsideEnvsDir(target: string): void {
  const resolved = path.resolve(target);
  if (resolved !== ENVS_DIR && !resolved.startsWith(`${ENVS_DIR}${path.sep}`)) {
    throw new Error(`Refusing to touch path outside ${ENVS_DIR}: ${resolved}`);
  }
}

export async function createEnv(opts: CreateEnvOptions = {}): Promise<EnvManifest> {
  const id = newEnvId();
  const worktreePath = path.join(ENVS_DIR, id);
  // Detached: the env is pinned to a snapshot commit, and a branch pointing at a
  // dangling commit is one more thing teardown can leak. "" = no branch to delete.
  const branch = '';
  const repoRoot = opts.repoPath ? path.resolve(opts.repoPath) : REPO_ROOT;
  const baseCommit = opts.baseCommit ?? snapshotWorkingTree(opts.taskId ?? null, repoRoot);
  const adapter =
    opts.adapter ??
    (opts.bootRecipe
      ? createBootAdapter(opts.bootRecipe)
      : createMissionControlAdapter(opts.seed ?? 1));
  // An artifact recipe has nothing to serve (execution-flow review H5): its env
  // is the worktree plus whatever install it declared, and asking for a port, a
  // dev server and a health poll is asking the project to be something it is not.
  const shouldBoot = opts.boot !== false && opts.bootRecipe?.dev !== null;
  const startedAt = Date.now();
  const now = new Date().toISOString();

  const timings: PhaseTimings = {
    worktreeMs: null,
    installMs: null,
    seedMs: null,
    bootMs: null,
    healthMs: null,
    totalMs: null,
  };

  putEnv({
    id,
    taskId: opts.taskId ?? null,
    productId: opts.productId ?? null,
    worktreePath,
    branch,
    baseCommit,
    port: null,
    url: null,
    pid: null,
    status: 'creating',
    timings,
    createdAt: now,
    updatedAt: now,
    error: null,
    seedSummary: null,
  });

  /** Run one phase, recording its duration whether or not it throws. */
  const phase = async <T>(key: keyof PhaseTimings, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      patchEnv(id, { timings: { [key]: Date.now() - t0 } });
    }
  };

  try {
    await phase('worktreeMs', () => {
      mkdirSync(ENVS_DIR, { recursive: true });
      git(['worktree', 'add', '--detach', worktreePath, baseCommit], repoRoot);
      opts.mutate?.(worktreePath);
    });

    patchEnv(id, { status: 'installing' });
    await phase('installMs', () => adapter.install(getEnvOrThrow(id)));

    if (!shouldBoot) {
      return patchEnv(id, { status: 'ready', timings: { totalMs: Date.now() - startedAt } });
    }

    patchEnv(id, { status: 'seeding' });
    const seedSummary = await phase('seedMs', () => adapter.seed(getEnvOrThrow(id)));
    patchEnv(id, { seedSummary });

    // A "fixed" recipe cannot take an OS-assigned port — the product insists on
    // one — so the port is checked before boot instead of after: a dev server
    // handed a busy port moves to the next one and health polls the old one
    // forever. ponytail: check-then-bind has a race window; the loser of a real
    // race fails on its own health timeout, which now says why.
    const fixed = opts.bootRecipe ? fixedPort(opts.bootRecipe) : null;
    if (fixed !== null) await assertFixedPortFree(fixed);
    const port = fixed ?? (await getFreePort());
    patchEnv(id, { status: 'booting', port });
    const { pid, url } = await phase('bootMs', () => adapter.boot(getEnvOrThrow(id)));
    patchEnv(id, { pid, url });

    const healthy = await phase('healthMs', () => adapter.health(getEnvOrThrow(id)));
    if (!healthy) throw new Error(`Env ${id} never became healthy at ${url}`);

    return patchEnv(id, { status: 'ready', timings: { totalMs: Date.now() - startedAt } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Nobody else can ever clean this up: a failed createEnv throws instead of
    // returning an id, so the caller has no handle on the worktree it created or
    // the dev server it may already have spawned. A failed health check used to
    // leak a next-dev process and .envs/<id>/ permanently. Best effort, and the
    // final status stays "failed" — that is the fact worth keeping.
    let cleanup: string | null = null;
    try {
      cleanup = (await teardownEnv(id, adapter, opts.repoPath)).error;
    } catch (teardownErr) {
      cleanup = teardownErr instanceof Error ? teardownErr.message : String(teardownErr);
    }

    patchEnv(id, {
      status: 'failed',
      error: cleanup ? `${message} (cleanup: ${cleanup})` : message,
      timings: { totalMs: Date.now() - startedAt },
    });
    throw err;
  }
}

function getEnvOrThrow(id: string): EnvManifest {
  const env = getEnv(id);
  if (!env) throw new Error(`No such env: ${id}`);
  return env;
}

/**
 * Stop the product, remove the worktree, delete the branch. Best-effort by
 * design: a failure in any step must not prevent the later steps from running,
 * or a half-torn-down env leaks a worktree forever.
 */
export async function teardownEnv(
  id: string,
  adapter?: TargetAdapter,
  repoPath?: string,
): Promise<EnvManifest> {
  const env = getEnvOrThrow(id);
  const repoRoot = repoPath ? path.resolve(repoPath) : REPO_ROOT;
  assertInsideEnvsDir(env.worktreePath);
  const problems: string[] = [];

  try {
    // teardown() ignores the seed; 0 is a placeholder, not a data choice.
    await (adapter ?? createMissionControlAdapter(0)).teardown(env);
  } catch (err) {
    problems.push(`process: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    git(['worktree', 'remove', '--force', env.worktreePath], repoRoot);
  } catch (err) {
    problems.push(`worktree remove: ${err instanceof Error ? err.message : String(err)}`);
    if (existsSync(env.worktreePath)) {
      assertInsideEnvsDir(env.worktreePath);
      rmSync(env.worktreePath, { recursive: true, force: true });
      try {
        git(['worktree', 'prune'], repoRoot);
      } catch {
        // housekeeping only
      }
    }
  }

  // Detached envs (the default since D2) have no branch to delete.
  if (env.branch) {
    try {
      git(['branch', '-D', env.branch], repoRoot);
    } catch (err) {
      problems.push(`branch delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return patchEnv(id, {
    status: 'torn-down',
    pid: null,
    url: null,
    error: problems.length ? problems.join('; ') : null,
  });
}
