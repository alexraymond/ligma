/**
 * A createEnv that fails must not leak what it created.
 *
 * createEnv throws instead of returning an id, so the caller has no handle on the
 * worktree it made or the dev server it may already have started: a failed health
 * check leaked a next-dev process and .envs/<id>/ permanently.
 *
 * Runs entirely inside a throwaway git repo via LIGMA_REPO_ROOT / LIGMA_DATA_DIR
 * — the overrides the daemon resolves every root through (src/paths.ts), so a
 * test can never cut a worktree from the real repo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EnvManifest, SeedSummary, TargetAdapter } from '../src/env/types';

const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-env-repo-'));
// data/ sits at the repo root, the same layout the real monorepo has.
const appDir = repoRoot;

// Set before importing anything that resolves paths at module load.
mkdirSync(path.join(appDir, 'data'), { recursive: true });
process.env.LIGMA_REPO_ROOT = repoRoot;
process.env.LIGMA_DATA_DIR = path.join(appDir, 'data');
// ENVS_DIR is ~/.ligma/envs by default — a test must never cut a worktree there.
process.env.LIGMA_ENVS_DIR = path.join(repoRoot, '.envs');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();

function tornDownAdapter(overrides: Partial<TargetAdapter> = {}): TargetAdapter {
  return {
    kind: 'web',
    install: async () => undefined,
    seed: async (): Promise<SeedSummary> => ({ seed: 1, counts: {} }),
    boot: async () => ({ pid: 0, url: 'http://127.0.0.1:1' }),
    health: async () => true,
    teardown: async () => undefined,
    ...overrides,
  };
}

beforeAll(() => {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(appDir, 'README.md'), 'seed\n', 'utf-8');
  // Mirrors the real repo: `add -A` must not pull the worktrees it creates into
  // the snapshot it is taking.
  writeFileSync(path.join(repoRoot, '.gitignore'), '.envs/\n', 'utf-8');
  git('add', '-A');
  git('commit', '-qm', 'initial');
});

afterAll(() => {
  delete process.env.LIGMA_REPO_ROOT;
  delete process.env.LIGMA_DATA_DIR;
  delete process.env.LIGMA_ENVS_DIR;
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('createEnv failure', () => {
  it('tears down the worktree it created and records the failure', async () => {
    const { createEnv } = await import('../src/env/lifecycle');
    const { listEnvs } = await import('../src/env/manifest');

    let teardownCalls = 0;
    const adapter = tornDownAdapter({
      install: async () => {
        throw new Error('install blew up');
      },
      teardown: async () => {
        teardownCalls += 1;
      },
    });

    await expect(createEnv({ taskId: 'task_cleanup', boot: false, adapter })).rejects.toThrow(
      'install blew up',
    );

    const env = listEnvs().at(-1)!;
    expect(env.status).toBe('failed');
    expect(env.error).toContain('install blew up');
    // The product process is stopped and the worktree is gone — not left for a
    // human to find with `git worktree list` next week.
    expect(teardownCalls).toBe(1);
    expect(existsSync(env.worktreePath)).toBe(false);
    expect(git('worktree', 'list')).not.toContain(env.id);
  });

  it('verifies the working tree, not HEAD, and leaves the index alone', async () => {
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');

    // An edit the builder made and did NOT commit — the thing that must be tested.
    writeFileSync(path.join(appDir, 'README.md'), 'seed\nuncommitted builder edit\n', 'utf-8');
    writeFileSync(path.join(appDir, 'brand-new.txt'), 'untracked builder file\n', 'utf-8');

    const statusBefore = git('status', '--porcelain');
    const headBefore = git('rev-parse', 'HEAD');
    const branchBefore = git('rev-parse', '--abbrev-ref', 'HEAD');

    const env = await createEnv({
      taskId: 'task_snapshot',
      boot: false,
      adapter: tornDownAdapter(),
    });
    try {
      const snapshot = git('show', `${env.baseCommit}:README.md`);
      expect(snapshot).toContain('uncommitted builder edit');
      expect(git('show', `${env.baseCommit}:brand-new.txt`)).toContain('untracked builder file');
      expect(env.baseCommit).not.toBe(headBefore);

      // Nothing about the user's repo moved.
      expect(git('status', '--porcelain')).toBe(statusBefore);
      expect(git('rev-parse', 'HEAD')).toBe(headBefore);
      expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe(branchBefore);
      expect(git('stash', 'list')).toBe('');
    } finally {
      await teardownEnv(env.id, tornDownAdapter());
    }
  });
});
