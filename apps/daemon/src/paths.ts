/**
 * Every filesystem root the daemon owns, resolved once.
 *
 * Before the extraction each engine module derived these itself with
 * `path.resolve(__dirname, "../../data")` — a depth that only held while the
 * code lived in apps/web/scripts. They resolve from this module now, so a move
 * costs one edit instead of twenty, and `LIGMA_DATA_DIR` can redirect the whole
 * store (tests, ephemeral envs) in one place.
 *
 * Resolution, all of it:
 *   REPO_ROOT       LIGMA_REPO_ROOT       → the checkout this file lives in
 *   DATA_DIR        LIGMA_DATA_DIR        → ~/.ligma/data
 *   ENVS_DIR        LIGMA_ENVS_DIR        → ~/.ligma/envs
 *   WORKSPACE_ROOT  LIGMA_WORKSPACE_ROOT  → REPO_ROOT/..
 */
import os from 'node:os';
import path from 'node:path';

/**
 * The ligma monorepo checkout: apps/daemon/src → apps/daemon → apps → repo.
 * Also the git root the ephemeral-env worktrees are cut from.
 */
export const REPO_ROOT = process.env.LIGMA_REPO_ROOT
  ? path.resolve(process.env.LIGMA_REPO_ROOT)
  : path.resolve(__dirname, '../../..');

/** The @ligma/daemon package root. */
export const DAEMON_ROOT = path.resolve(__dirname, '..');

/** Engine entry points spawned as detached child processes (run-task, index). */
export const ENGINE_DIR = path.join(DAEMON_ROOT, 'src', 'engine');

/** Which tier decided a root: an explicit env var, or the built-in default. */
export type RootSource = 'env' | 'default';

/**
 * Where the JSON stores live, and which tier decided it.
 *
 * `~/.ligma/data`, NOT `<repo>/data` (docs/DECISIONS.md 2026-08-13, "Data root
 * moves outside the checkout"): product evidence, per-project baselines,
 * contracts and pty sessions are a user's data, and a checkout is not where a
 * user's data goes. `LIGMA_DATA_DIR` is the only override — the dogfood
 * instance uses it to pin the store back to `<repo>/data`, visibly, in
 * `apps/daemon/package.json`'s scripts.
 *
 * Shaped like `productsRootInfo()` (store/product-repo.ts) so a caller that
 * wants to *show* the path can also say why it is that path.
 */
export function dataRootInfo(): { path: string; source: RootSource } {
  return process.env.LIGMA_DATA_DIR
    ? { path: path.resolve(process.env.LIGMA_DATA_DIR), source: 'env' }
    : { path: path.join(os.homedir(), '.ligma', 'data'), source: 'default' };
}

/** The JSON stores — the source of truth. The daemon is their sole writer. */
export const DATA_DIR = dataRootInfo().path;

/**
 * Where ephemeral-env git worktrees and their boot logs are cut.
 *
 * `~/.ligma/envs` by default, never inside a checkout: an env is a FULL
 * worktree of the target repo, and `.envs/` inside ligma meant every verified
 * product got a copy of itself inside the factory. `LIGMA_ENVS_DIR` overrides
 * it; the containment guard in env/lifecycle.ts moves with it, so nothing this
 * daemon deletes can ever sit outside whichever directory this resolves to.
 */
export const ENVS_DIR = process.env.LIGMA_ENVS_DIR
  ? path.resolve(process.env.LIGMA_ENVS_DIR)
  : path.join(os.homedir(), '.ligma', 'envs');

/**
 * The central, verification-sensitive per-project store (twin-primitives §3):
 * `<DATA_DIR>/projects/<id>/{baselines,probes}/`. Journeys live in the target
 * repo; everything under here is denied to spawned agents, because a builder
 * that can read the baseline can teach to the test.
 */
export const CENTRAL_PROJECTS_DIR = path.join(DATA_DIR, 'projects');

/**
 * Where agent runs are launched from — the directory holding this repo and its
 * sibling project checkouts, plus the user's `.claude/commands`.
 */
export const WORKSPACE_ROOT = process.env.LIGMA_WORKSPACE_ROOT
  ? path.resolve(process.env.LIGMA_WORKSPACE_ROOT)
  : path.resolve(REPO_ROOT, '..');
