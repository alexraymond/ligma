/**
 * The path primitives — docs/DECISIONS.md 2026-08-13, "Data root moves outside
 * the checkout".
 *
 * The property worth holding is not "DATA_DIR equals some string": it is that
 * NOTHING a user accumulates resolves inside a checkout unless someone said so
 * out loud with an env var. The write-path audit found the opposite twice over
 * (product evidence in `<repo>/data`, whole worktrees of other repos in
 * `<repo>/.envs`), so both defaults are pinned here, and so is the rule that
 * the env var wins.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VARS = ['LIGMA_DATA_DIR', 'LIGMA_ENVS_DIR', 'LIGMA_REPO_ROOT'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
  vi.resetModules();
});

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  vi.resetModules();
});

/** Re-resolve src/paths.ts against whatever env is set right now. */
async function freshPaths(): Promise<typeof import('../src/paths')> {
  vi.resetModules();
  return import('../src/paths');
}

describe('DATA_DIR', () => {
  it('defaults to ~/.ligma/data — outside every checkout', async () => {
    const { DATA_DIR, REPO_ROOT, dataRootInfo } = await freshPaths();
    expect(DATA_DIR).toBe(path.join(os.homedir(), '.ligma', 'data'));
    expect(dataRootInfo()).toEqual({ path: DATA_DIR, source: 'default' });
    expect(DATA_DIR.startsWith(REPO_ROOT + path.sep)).toBe(false);
  });

  it('is redirected by LIGMA_DATA_DIR, resolved to an absolute path', async () => {
    process.env.LIGMA_DATA_DIR = './some/store';
    const { DATA_DIR, dataRootInfo } = await freshPaths();
    expect(DATA_DIR).toBe(path.resolve('./some/store'));
    expect(dataRootInfo().source).toBe('env');
  });

  it('carries the whole store with it — projects and contracts included', async () => {
    const store = mkdtempSync(path.join(os.tmpdir(), 'ligma-paths-'));
    try {
      process.env.LIGMA_DATA_DIR = store;
      const { CENTRAL_PROJECTS_DIR } = await freshPaths();
      expect(CENTRAL_PROJECTS_DIR).toBe(path.join(store, 'projects'));
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});

describe('ENVS_DIR', () => {
  it('defaults to ~/.ligma/envs — an env is a full worktree, never in the repo', async () => {
    const { ENVS_DIR, REPO_ROOT } = await freshPaths();
    expect(ENVS_DIR).toBe(path.join(os.homedir(), '.ligma', 'envs'));
    expect(ENVS_DIR.startsWith(REPO_ROOT + path.sep)).toBe(false);
  });

  it('is redirected by LIGMA_ENVS_DIR, and does not follow LIGMA_DATA_DIR', async () => {
    process.env.LIGMA_DATA_DIR = '/tmp/some-store';
    process.env.LIGMA_ENVS_DIR = './envs-here';
    const { ENVS_DIR } = await freshPaths();
    expect(ENVS_DIR).toBe(path.resolve('./envs-here'));
  });

  it("is what env/manifest re-exports, so lifecycle's guard moves with it", async () => {
    process.env.LIGMA_ENVS_DIR = '/tmp/ligma-envs-fixture';
    const { ENVS_DIR } = await freshPaths();
    const manifest = await import('../src/env/manifest');
    expect(manifest.ENVS_DIR).toBe(ENVS_DIR);
  });
});

describe('the containment guard', () => {
  it('refuses to tear down a worktree that is not inside ENVS_DIR', async () => {
    const store = mkdtempSync(path.join(os.tmpdir(), 'ligma-guard-store-'));
    const envs = mkdtempSync(path.join(os.tmpdir(), 'ligma-guard-envs-'));
    try {
      process.env.LIGMA_DATA_DIR = store;
      process.env.LIGMA_ENVS_DIR = envs;
      vi.resetModules();
      const { putEnv } = await import('../src/env/manifest');
      const { teardownEnv } = await import('../src/env/lifecycle');

      const now = new Date().toISOString();
      putEnv({
        id: 'env_escape',
        taskId: null,
        productId: null,
        // The shape of the bug this guard exists for: a manifest entry whose
        // path points at somebody's real work.
        worktreePath: path.join(os.homedir(), 'important-repo'),
        branch: '',
        baseCommit: 'HEAD',
        port: null,
        url: null,
        pid: null,
        status: 'ready',
        timings: {
          worktreeMs: null,
          installMs: null,
          seedMs: null,
          bootMs: null,
          healthMs: null,
          totalMs: null,
        },
        createdAt: now,
        updatedAt: now,
        error: null,
        seedSummary: null,
      });

      await expect(teardownEnv('env_escape')).rejects.toThrow(/Refusing to touch path outside/);
    } finally {
      rmSync(store, { recursive: true, force: true });
      rmSync(envs, { recursive: true, force: true });
    }
  });
});
