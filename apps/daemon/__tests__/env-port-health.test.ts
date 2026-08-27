/**
 * Ports and health, against a dev server that behaves like a real one.
 *
 * The fixture repo's "dev server" copies the two habits that made D3 adoption
 * fail on every attempt: it binds LOCALHOST (which resolves to ::1 first, as
 * vite/vitepress/next do), and when its port is busy it prints
 * "Port N is in use, trying another one..." and takes N+1 instead of failing.
 * Health polling the port nobody bound then waits out the whole budget.
 *
 * Runs entirely inside a throwaway git repo via LIGMA_REPO_ROOT / LIGMA_DATA_DIR.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ServerBootRecipe } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-env-port-repo-'));

// Set before importing anything that resolves paths at module load.
mkdirSync(path.join(repoRoot, 'data'), { recursive: true });
process.env.LIGMA_REPO_ROOT = repoRoot;
process.env.LIGMA_DATA_DIR = path.join(repoRoot, 'data');
// ENVS_DIR is ~/.ligma/envs by default — a test must never cut a worktree there.
process.env.LIGMA_ENVS_DIR = path.join(repoRoot, '.envs');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();

/** A dev server with a real dev server's manners. */
const FIXTURE_SERVER = `
const http = require("http");
const args = process.argv.slice(2);
const flag = args.indexOf("--port");
let port = flag >= 0 ? Number(args[flag + 1]) : Number(process.env.PORT || 4173);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end('<!doctype html><html><head><title></title></head><body><div id="app"></div></body></html>');
});
server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.log("Port " + port + " is in use, trying another one...");
  server.listen(++port, "localhost");
});
server.on("listening", () => console.log("fixture dev server on http://localhost:" + port + "/"));
server.listen(port, "localhost");
`;

function recipe(over: Partial<ServerBootRecipe> = {}): ServerBootRecipe {
  return {
    appDir: '.',
    install: null,
    dev: ['node', 'server.js'],
    portStrategy: { kind: 'flag', flag: '--port' },
    healthPath: '/',
    healthMarker: '<div id="app">',
    seed: null,
    ...over,
  };
}

/** Hold a port the way a dev server holds it: on ::1, not 127.0.0.1. */
function holdPort(port: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, 'localhost', () => resolve(() => srv.close()));
  });
}

let baseCommit = '';

beforeAll(() => {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(repoRoot, 'server.js'), FIXTURE_SERVER, 'utf-8');
  writeFileSync(path.join(repoRoot, '.gitignore'), '.envs/\ndata/\n', 'utf-8');
  git('add', '-A');
  git('commit', '-qm', 'initial');
  baseCommit = git('rev-parse', 'HEAD');
});

afterAll(() => {
  delete process.env.LIGMA_REPO_ROOT;
  delete process.env.LIGMA_DATA_DIR;
  delete process.env.LIGMA_ENVS_DIR;
  delete process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS;
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('a failed install says why', () => {
  it("carries the package manager's own words, not just 'Command failed'", async () => {
    const { createEnv } = await import('../src/env/lifecycle');
    await expect(
      createEnv({
        repoPath: repoRoot,
        baseCommit,
        boot: false,
        bootRecipe: recipe({
          install: [
            'node',
            '-e',
            "console.error('ERR_PNPM_NO_PKG  packages field missing or empty'); process.exit(1)",
          ],
        }),
      }),
    ).rejects.toThrow(/packages field missing or empty/);
  }, 30_000);
});

describe('fixed vs settable port strategies', () => {
  it('gives two concurrent flag-strategy envs their own port, and both come up', async () => {
    process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS = '20000';
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');

    const both = await Promise.all([
      createEnv({ repoPath: repoRoot, bootRecipe: recipe(), boot: true, baseCommit }),
      createEnv({ repoPath: repoRoot, bootRecipe: recipe(), boot: true, baseCommit }),
    ]);

    try {
      expect(both.map((e) => e.status)).toEqual(['ready', 'ready']);
      expect(both[0].port).not.toBe(both[1].port);
      for (const env of both) {
        const res = await fetch(env.url as string);
        expect(await res.text()).toContain('<div id="app">');
      }
    } finally {
      for (const env of both) await teardownEnv(env.id, undefined, repoRoot);
    }
  }, 60_000);

  it('fails a fixed-port recipe fast, and says what to do, when the port is taken', async () => {
    // Long health budget: if the guard were missing this test would hang on it.
    process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS = '60000';
    const { createEnv } = await import('../src/env/lifecycle');
    const release = await holdPort(4173); // the port the fixture hardcodes
    const startedAt = Date.now();

    try {
      await expect(
        createEnv({
          repoPath: repoRoot,
          bootRecipe: recipe({ portStrategy: { kind: 'fixed', port: 4173 } }),
          boot: true,
          baseCommit,
        }),
      ).rejects.toThrow(/Port 4173 is already in use.*settable strategy/s);
      expect(Date.now() - startedAt).toBeLessThan(15_000);
    } finally {
      release();
    }
  }, 60_000);

  it('still boots a fixed-port recipe when the port is genuinely free', async () => {
    process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS = '20000';
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');
    const env = await createEnv({
      repoPath: repoRoot,
      bootRecipe: recipe({ portStrategy: { kind: 'fixed', port: 4173 } }),
      boot: true,
      baseCommit,
    });
    try {
      expect(env.status).toBe('ready');
      expect(env.url).toBe('http://localhost:4173');
    } finally {
      await teardownEnv(env.id, undefined, repoRoot);
    }
  }, 60_000);
});

describe('health failure diagnosis', () => {
  it("names the phase, the marker and the dev server's own output", async () => {
    process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS = '2500';
    const { createEnv } = await import('../src/env/lifecycle');

    // The failure that killed D3: the server is up and serving 200s, the marker
    // is simply not in the shell a dev server returns before JavaScript runs.
    const err: unknown = await createEnv({
      repoPath: repoRoot,
      bootRecipe: recipe({ healthMarker: 'Ligma Design System' }),
      boot: true,
      baseCommit,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('install and boot both succeeded');
    expect(message).toContain('healthMarker "Ligma Design System" is not in the');
    expect(message).toContain('Dev server log tail:');
    expect(message).toContain('fixture dev server on http://localhost:');
  }, 60_000);
});

/**
 * An artifact project's env (H5). The recipe declares `dev: null`, so there is
 * nothing to serve: no port is allocated, no dev server is spawned and health is
 * never polled. Booting one anyway is what made a research repo invent an HTTP
 * server so it could be verified at all.
 */
describe('an artifact recipe gets a worktree, not a server', () => {
  it('reaches ready with no port, no pid and no url — and never polls health', async () => {
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');
    const env = await createEnv({
      repoPath: repoRoot,
      baseCommit,
      boot: true,
      bootRecipe: { appDir: '.', install: null, dev: null, artifacts: ['server.js'], check: null },
    });
    try {
      expect(env.status).toBe('ready');
      expect(env.port).toBeNull();
      expect(env.pid).toBeNull();
      expect(env.url).toBeNull();
      // The phases that only a served product has were never entered.
      expect(env.timings.bootMs).toBeNull();
      expect(env.timings.healthMs).toBeNull();
      // The worktree — the whole product — is there.
      expect(existsSync(path.join(env.worktreePath, 'server.js'))).toBe(true);
    } finally {
      await teardownEnv(env.id, undefined, repoRoot);
    }
  }, 60_000);

  it('runs a declared install even though nothing is booted', async () => {
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');
    const env = await createEnv({
      repoPath: repoRoot,
      baseCommit,
      boot: true,
      bootRecipe: {
        appDir: '.',
        install: ['node', '-e', "require('fs').writeFileSync('installed.txt','yes')"],
        dev: null,
        artifacts: ['server.js'],
        check: null,
      },
    });
    try {
      expect(existsSync(path.join(env.worktreePath, 'installed.txt'))).toBe(true);
    } finally {
      await teardownEnv(env.id, undefined, repoRoot);
    }
  }, 60_000);
});

/**
 * The real thing: ~/ligma-classic, the repo every D3 persona failed to adopt.
 * Needs that checkout and a warm pnpm store, so it is opt-in.
 */
const classic = '/Users/alexraymond/ligma-classic';
describe.skipIf(!process.env.LIGMA_E2E_CLASSIC)('ligma-classic boots end to end', () => {
  it('comes up healthy on its own allocated port', async () => {
    process.env.LIGMA_ENV_HEALTH_TIMEOUT_MS = '120000';
    const { createEnv, teardownEnv } = await import('../src/env/lifecycle');
    const env = await createEnv({
      repoPath: classic,
      bootRecipe: {
        appDir: 'website',
        install: ['pnpm', 'install'],
        dev: ['pnpm', 'exec', 'vitepress', 'dev'],
        portStrategy: { kind: 'flag', flag: '--port' },
        healthPath: '/',
        healthMarker: '<div id="app">',
        seed: null,
      },
      boot: true,
    });
    try {
      expect(env.status).toBe('ready');
      expect(env.port).not.toBe(5173);
      console.log(`[ligma-classic] ${env.url} timings=${JSON.stringify(env.timings)}`);
    } finally {
      await teardownEnv(env.id, undefined, classic);
    }
  }, 900_000);
});
