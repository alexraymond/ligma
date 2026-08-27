/**
 * The adoption fact gatherer, against the three repo shapes that killed D3
 * attempt 3 (`docs/evidence/campaign/d3-attempt-3`, crit_goal).
 *
 * Adoption of `open-design` and `mission-control` both died on "Command failed:
 * pnpm install" — one because its dependency graph was resolved by another
 * package manager, the other because the repo root is not the app at all. The
 * inference prompt could not have known either: the facts it was handed never
 * mentioned lockfiles and never looked one directory down.
 *
 * These are the facts, not the model: every assertion here is a pure read of
 * files on disk, so a wrong recipe can no longer be blamed on missing input.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { draftBootFromFacts, readRepoFacts } from '../src/engine/adopt-repo';

const dirs: string[] = [];

function fixture(build: (root: string) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), 'adopt-facts-'));
  dirs.push(root);
  build(root);
  return root;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('lockfile kind decides the install', () => {
  it('reads bun.lock as a bun install, not whatever we happen to run', () => {
    const repo = fixture((root) => {
      writeJson(path.join(root, 'package.json'), { name: 'bunny', scripts: { dev: 'vite' } });
      writeFileSync(path.join(root, 'bun.lock'), '{"lockfileVersion":1}', 'utf-8');
    });

    const facts = readRepoFacts(repo);
    expect(facts.lockfiles).toEqual(['bun.lock']);
    expect(facts.installCandidates).toEqual([['bun', 'install']]);
    // The root has the dev script, so there is nothing to look one level down for.
    expect(facts.appDirs).toEqual([]);
    expect(draftBootFromFacts(facts)).toMatchObject({ appDir: '.', install: ['bun', 'install'] });
  });

  it('maps every lockfile kind it knows, and offers none when there is none', () => {
    const cases: Array<[string, string[]]> = [
      ['yarn.lock', ['yarn', 'install']],
      ['pnpm-lock.yaml', ['pnpm', 'install']],
      ['package-lock.json', ['npm', 'ci']],
    ];
    for (const [lockfile, install] of cases) {
      const repo = fixture((root) => {
        writeJson(path.join(root, 'package.json'), { name: 'x', scripts: { dev: 'vite' } });
        writeFileSync(path.join(root, lockfile), '', 'utf-8');
      });
      expect(readRepoFacts(repo).installCandidates).toEqual([install]);
    }

    const bare = fixture((root) =>
      writeJson(path.join(root, 'package.json'), { name: 'x', scripts: { dev: 'vite' } }),
    );
    expect(readRepoFacts(bare).installCandidates).toEqual([]);
    expect(draftBootFromFacts(readRepoFacts(bare)).install).toBeNull();
  });

  it('puts the declared packageManager first when two lockfiles disagree', () => {
    // open-design's shape: bun.lock and pnpm-lock.yaml side by side. The
    // package.json field is the repo's own answer, so it leads — and the other
    // lockfile still gets offered rather than being silently dropped.
    const repo = fixture((root) => {
      writeJson(path.join(root, 'package.json'), {
        name: 'two-locks',
        packageManager: 'pnpm@10.33.2',
        scripts: { dev: 'vite' },
      });
      writeFileSync(path.join(root, 'bun.lock'), '', 'utf-8');
      writeFileSync(path.join(root, 'pnpm-lock.yaml'), '', 'utf-8');
    });

    const facts = readRepoFacts(repo);
    expect(facts.lockfiles).toEqual(['bun.lock', 'pnpm-lock.yaml']);
    expect(facts.installCandidates).toEqual([
      ['pnpm', 'install'],
      ['bun', 'install'],
    ]);
  });
});

describe('the repo root is not always the app', () => {
  it('finds the app subdirectory when the root has no package.json at all', () => {
    // mission-control/mission-control: nothing at the root, the whole app one
    // directory down with its own lockfile. `appDir` exists for exactly this.
    const repo = fixture((root) => {
      writeJson(path.join(root, 'mission-control', 'package.json'), {
        name: 'mission-control',
        scripts: { dev: 'next dev', build: 'next build' },
      });
      writeFileSync(path.join(root, 'mission-control', 'pnpm-lock.yaml'), '', 'utf-8');
      mkdirSync(path.join(root, 'docs'), { recursive: true });
    });

    const facts = readRepoFacts(repo);
    expect(facts.packageJson).toBeNull();
    expect(facts.lockfiles).toEqual([]);
    expect(facts.appDirs).toEqual([
      {
        dir: 'mission-control',
        name: 'mission-control',
        dev: 'next dev',
        lockfiles: ['pnpm-lock.yaml'],
        install: ['pnpm', 'install'],
      },
    ]);
    // The draft points at the app and installs with the app's own lockfile —
    // never `.` with whatever package manager we like best.
    expect(draftBootFromFacts(facts)).toMatchObject({
      appDir: 'mission-control',
      install: ['pnpm', 'install'],
    });
  });

  it('looks one level down when a root package.json has no dev script', () => {
    const repo = fixture((root) => {
      writeJson(path.join(root, 'package.json'), { name: 'root', scripts: { build: 'tsc' } });
      writeJson(path.join(root, 'site', 'package.json'), {
        name: 'site',
        scripts: { dev: 'vite' },
      });
    });
    expect(readRepoFacts(repo).appDirs.map((c) => c.dir)).toEqual(['site']);
  });
});

describe('monorepo workspace layout', () => {
  it('walks into container directories and skips packages with no dev script', () => {
    const repo = fixture((root) => {
      writeJson(path.join(root, 'package.json'), {
        name: 'monorepo',
        packageManager: 'pnpm@10.0.0',
        workspaces: ['apps/*', 'packages/*'],
        scripts: { build: 'turbo build' },
      });
      writeFileSync(path.join(root, 'pnpm-lock.yaml'), '', 'utf-8');
      writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n', 'utf-8');
      writeJson(path.join(root, 'apps', 'web', 'package.json'), {
        name: '@m/web',
        scripts: { dev: 'next dev' },
      });
      writeJson(path.join(root, 'apps', 'cli', 'package.json'), {
        name: '@m/cli',
        scripts: { start: 'node .' },
      });
      writeJson(path.join(root, 'packages', 'ui', 'package.json'), {
        name: '@m/ui',
        scripts: { build: 'tsc' },
      });
      // Noise the walk must not follow.
      mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
      writeJson(path.join(root, 'node_modules', 'left-pad', 'package.json'), {
        name: 'left-pad',
        scripts: { dev: 'x' },
      });
    });

    const facts = readRepoFacts(repo);
    expect(facts.workspaceGlobs).toEqual(['apps/*', 'packages/*']);
    expect(facts.markers).toContain('pnpm-workspace.yaml');
    expect(facts.installCandidates).toEqual([['pnpm', 'install']]);
    // Only the workspace member that can actually be booted.
    expect(facts.appDirs.map((c) => c.dir)).toEqual(['apps/web']);
    // The install stays the root's — a workspace member carries no lockfile.
    expect(facts.appDirs[0].install).toBeNull();
    expect(draftBootFromFacts(facts)).toMatchObject({
      appDir: 'apps/web',
      install: ['pnpm', 'install'],
    });
  });
});
