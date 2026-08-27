/**
 * fs-bridge tests against a fixture artifact repo (execution-flow review H5).
 *
 * The fs transport is what a project that is not a running program gets. Three
 * things must hold for its evidence to be worth anything:
 *   1. A read is a citation — every one writes a record the persona can put in
 *      `evidence[]`, exactly as a screenshot or an HTTP record is elsewhere.
 *   2. Nothing outside the worktree can be read, by relative path or by symlink.
 *   3. The ONLY command that runs is the one boot.json declared. A persona that
 *      asks for its own argv is refused, and nothing is executed.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bridge, BridgeStep } from '../src/harness/bridge-server';
import { type FsReadRecord, startFsBridge } from '../src/harness/fs-bridge';
import type { PtyRecord } from '../src/harness/pty-bridge';

let product: string;
let outside: string;
let runDir: string;
let bridge: Bridge;
let sessionUrl: string;

/** The declared check: passes, and prints something the persona can cite. */
const CHECK = `#!/usr/bin/env node
console.log("2 passed, 0 failed");
`;

async function call(
  action: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${sessionUrl}/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function steps(name = 'naive-developer-1'): BridgeStep[] {
  const file = path.join(runDir, 'personas', name, 'steps.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BridgeStep);
}

function record<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(runDir, rel), 'utf-8')) as T;
}

beforeAll(async () => {
  product = mkdtempSync(path.join(tmpdir(), 'mc-fs-product-'));
  outside = mkdtempSync(path.join(tmpdir(), 'mc-fs-outside-'));
  writeFileSync(path.join(outside, 'secrets.txt'), 'SUPER_SECRET_TOKEN\n', 'utf-8');

  mkdirSync(path.join(product, 'docs'), { recursive: true });
  mkdirSync(path.join(product, 'node_modules', 'junk'), { recursive: true });
  mkdirSync(path.join(product, '.git'), { recursive: true });
  writeFileSync(
    path.join(product, 'paper.md'),
    '# The paper\n\nWe claim a 12% improvement.\n',
    'utf-8',
  );
  writeFileSync(path.join(product, 'docs', 'method.md'), 'The method is a loop.\n', 'utf-8');
  writeFileSync(path.join(product, 'big.md'), 'x'.repeat(100_000), 'utf-8');
  writeFileSync(path.join(product, 'check.js'), CHECK, 'utf-8');
  writeFileSync(
    path.join(product, 'node_modules', 'junk', 'index.js'),
    'module.exports = 1;\n',
    'utf-8',
  );
  writeFileSync(path.join(product, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
  symlinkSync(path.join(outside, 'secrets.txt'), path.join(product, 'escape.md'));

  runDir = mkdtempSync(path.join(tmpdir(), 'mc-fs-run-'));
  bridge = await startFsBridge({
    root: product,
    runDir,
    artifacts: ['paper.md', 'docs/*.md'],
    check: ['node', 'check.js'],
  });
  sessionUrl = (await bridge.session('naive-developer-1')).url;
});

afterAll(async () => {
  await bridge?.close();
  for (const dir of [product, outside, runDir]) rmSync(dir, { recursive: true, force: true });
});

describe('fs bridge — list', () => {
  it('names the declared artifacts and the check the repo committed to', async () => {
    const res = await call('list');
    expect(res.status).toBe(200);
    expect(res.json.artifacts).toEqual(['paper.md', 'docs/*.md']);
    expect(res.json.check).toEqual(['node', 'check.js']);
  });

  it("lists the repo's files with their sizes", async () => {
    const files = (await call('list')).json.files as Array<{ path: string; bytes: number }>;
    expect(files.map((f) => f.path)).toContain('paper.md');
    expect(files.map((f) => f.path)).toContain('docs/method.md');
    expect(files.find((f) => f.path === 'paper.md')!.bytes).toBeGreaterThan(0);
  });

  it('does not list the machinery — .git and node_modules are not deliverables', async () => {
    const paths = ((await call('list')).json.files as Array<{ path: string }>).map((f) => f.path);
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
  });

  it('is a read, so it is not recorded as a step', async () => {
    const before = steps().length;
    await call('list');
    expect(steps().length).toBe(before);
  });
});

describe('fs bridge — read is the citation', () => {
  it("returns a file's text and records it as evidence", async () => {
    const res = await call('read', { path: 'paper.md' });
    expect(res.status).toBe(200);
    expect(String(res.json.text)).toContain('12% improvement');

    const step = steps().at(-1)!;
    expect(step.action).toBe('read');
    expect(step.error).toBeNull();
    expect(step.record).toMatch(/^personas\/naive-developer-1\/records\/\d\d-paper-md\.json$/);

    const saved = record<FsReadRecord>(step.record!);
    expect(saved.path).toBe('paper.md');
    expect(saved.text).toContain('12% improvement');
    expect(saved.truncated).toBe(false);
  });

  it('caps a huge file rather than pulling it whole into a transcript', async () => {
    const res = await call('read', { path: 'big.md' });
    expect(res.json.truncated).toBe(true);
    expect(String(res.json.text).length).toBeLessThan(100_000);
    expect(record<FsReadRecord>(steps().at(-1)?.record!).bytes).toBe(100_000);
  });

  it('records a missing artifact as a failed step — that absence IS the finding', async () => {
    const before = steps().length;
    const res = await call('read', { path: 'docs/results.md' });
    expect(res.status).toBe(400);
    expect(steps().length).toBe(before + 1);
    expect(steps().at(-1)!.error).toMatch(/no such file/i);
  });
});

describe('fs bridge — containment', () => {
  it('refuses a relative path that climbs out of the worktree', async () => {
    const res = await call('read', { path: '../../etc/passwd' });
    expect(res.status).toBe(403);
    expect(String(res.json.error)).toMatch(/outside/i);
  });

  it('refuses an absolute path elsewhere on the machine', async () => {
    const res = await call('read', { path: path.join(outside, 'secrets.txt') });
    expect(res.status).toBe(403);
    expect(String(res.json.error)).not.toContain('SUPER_SECRET_TOKEN');
  });

  it('refuses a symlink inside the worktree that points outside it', async () => {
    const res = await call('read', { path: 'escape.md' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain('SUPER_SECRET_TOKEN');
    // The secret really is there — the refusal is doing work.
    expect(readFileSync(path.join(outside, 'secrets.txt'), 'utf-8')).toContain(
      'SUPER_SECRET_TOKEN',
    );
  });
});

describe('fs bridge — run only the declared command', () => {
  it("runs boot.json's check and records argv, stdout and the exit code", async () => {
    const res = await call('run', {});
    expect(res.status).toBe(200);
    expect(res.json.exitCode).toBe(0);
    expect(String(res.json.stdout)).toContain('2 passed');

    const saved = record<PtyRecord>(steps().at(-1)?.record!);
    expect(saved.argv).toEqual(['node', 'check.js']);
    expect(saved.exitCode).toBe(0);
  });

  it('refuses a caller-supplied command, and executes nothing', async () => {
    const res = await call('run', {
      argv: ['node', '-e', "require('fs').writeFileSync('pwned','x')"],
    });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toMatch(/declared in boot\.json/);
    expect(existsSync(path.join(product, 'pwned'))).toBe(false);
    // Still a step: a persona reaching for its own argv is evidence of confusion.
    expect(steps().at(-1)!.error).toMatch(/declared in boot\.json/);
  });
});

describe('fs bridge — a repo that declared no check', () => {
  it('says so instead of inventing a command', async () => {
    const otherRun = mkdtempSync(path.join(tmpdir(), 'mc-fs-run2-'));
    const plain = await startFsBridge({
      root: product,
      runDir: otherRun,
      artifacts: ['paper.md'],
      check: null,
    });
    try {
      const url = (await plain.session('spec-auditor')).url;
      const res = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/declares no check command/);
    } finally {
      await plain.close();
      rmSync(otherRun, { recursive: true, force: true });
    }
  });
});

describe('fs bridge — access control', () => {
  it('refuses a wrong token for a session that exists', async () => {
    const res = await fetch(`${bridge.url}/s/naive-developer-1/${'0'.repeat(32)}/list`);
    expect(res.status).toBe(403);
  });

  it("keeps each persona's records in its own directory", async () => {
    const other = (await bridge.session('spec-auditor')).url;
    await fetch(`${other}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'docs/method.md' }),
    });
    expect(steps('spec-auditor').length).toBe(1);
    expect(steps('spec-auditor')[0].record).toMatch(/^personas\/spec-auditor\/records\//);
  });
});
