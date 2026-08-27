/**
 * PTY-bridge tests against a fixture CLI.
 *
 * Two things must hold for a headless panel to be worth anything:
 *   1. Exit codes are recorded faithfully — they are what screenshots are to a
 *      browser run, so a non-zero exit is an observation, not a bridge error.
 *   2. The tester never sees source. `docs` is the persona's ONLY view of the
 *      checkout, and it serves documents by name; a repo whose quickstart lives
 *      inside a .ts file does not have a quickstart.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bridge, BridgeStep } from '../src/harness/bridge-server';
import { type PtyRecord, findDocs, startPtyBridge } from '../src/harness/pty-bridge';

let product: string;
let runDir: string;
let bridge: Bridge;
let sessionUrl: string;

/** A fixture CLI with a working command, a failing one, and one that hangs. */
const CLI = `#!/usr/bin/env node
const [, , cmd, ...rest] = process.argv;
if (cmd === "--version") { console.log("fixture-cli 1.2.3"); process.exit(0); }
if (cmd === "add") {
  if (rest.length === 0) { console.error("add: needs a title"); process.exit(2); }
  console.log(JSON.stringify({ id: "t1", title: rest.join(" ") }));
  process.exit(0);
}
if (cmd === "hang") { setInterval(() => {}, 1000); return; }
if (cmd === "echo") { process.stdin.on("data", (c) => process.stdout.write(c)); return; }
console.error("unknown command: " + cmd);
process.exit(127);
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

function record(rel: string): PtyRecord {
  return JSON.parse(readFileSync(path.join(runDir, rel), 'utf-8')) as PtyRecord;
}

beforeAll(async () => {
  product = mkdtempSync(path.join(tmpdir(), 'mc-pty-product-'));
  mkdirSync(path.join(product, 'bin'), { recursive: true });
  mkdirSync(path.join(product, 'src'), { recursive: true });
  mkdirSync(path.join(product, 'docs'), { recursive: true });
  writeFileSync(path.join(product, 'bin', 'cli.js'), CLI, 'utf-8');
  writeFileSync(
    path.join(product, 'README.md'),
    '# Fixture CLI\n\n    node bin/cli.js add "Buy milk"\n',
    'utf-8',
  );
  writeFileSync(
    path.join(product, 'docs', 'quickstart.md'),
    'Run `node bin/cli.js --version` first.\n',
    'utf-8',
  );
  writeFileSync(
    path.join(product, 'src', 'index.ts'),
    'export const SECRET_IMPLEMENTATION = 42;\n',
    'utf-8',
  );
  writeFileSync(path.join(product, 'package.json'), '{"name":"fixture-cli"}\n', 'utf-8');

  runDir = mkdtempSync(path.join(tmpdir(), 'mc-pty-run-'));
  bridge = await startPtyBridge({ cwd: product, runDir });
  sessionUrl = (await bridge.session('naive-developer-1')).url;
});

afterAll(async () => {
  await bridge?.close();
  rmSync(product, { recursive: true, force: true });
  rmSync(runDir, { recursive: true, force: true });
});

describe('pty bridge command evidence', () => {
  it('runs a command and records argv, stdout and a zero exit code', async () => {
    const res = await call('run', { argv: ['node', 'bin/cli.js', '--version'] });
    expect(res.status).toBe(200);
    expect(res.json.exitCode).toBe(0);
    expect(String(res.json.stdout)).toContain('fixture-cli 1.2.3');

    const step = steps().at(-1)!;
    expect(step.action).toBe('run');
    expect(step.error).toBeNull();
    expect(step.record).toMatch(/^personas\/naive-developer-1\/records\/01-node\.json$/);

    const saved = record(step.record!);
    expect(saved.argv).toEqual(['node', 'bin/cli.js', '--version']);
    expect(saved.cwd).toBe(path.resolve(product));
    expect(saved.exitCode).toBe(0);
    expect(saved.timedOut).toBe(false);
  });

  it('treats a non-zero exit as an observation, not a bridge error', async () => {
    const res = await call('run', { argv: ['node', 'bin/cli.js', 'add'] });
    // The bridge call succeeded. Exit 2 is the finding.
    expect(res.status).toBe(200);
    expect(res.json.exitCode).toBe(2);
    expect(String(res.json.stderr)).toContain('needs a title');
    expect(steps().at(-1)!.error).toBeNull();
    expect(record(steps().at(-1)?.record!).exitCode).toBe(2);
  });

  it('records a command that does not exist at all', async () => {
    const res = await call('run', { argv: ['definitely-not-a-real-binary-xyz'] });
    expect(res.status).toBe(200);
    expect(String(res.json.spawnError)).toMatch(/ENOENT/);
    expect(record(steps().at(-1)?.record!).error).toMatch(/ENOENT/);
  });

  it('sends stdin when asked', async () => {
    const res = await call('run', { argv: ['node', 'bin/cli.js', 'echo'], input: 'hello stdin' });
    expect(String(res.json.stdout)).toContain('hello stdin');
  });

  it('kills a hung command and records that it was killed', async () => {
    const res = await call('run', { argv: ['node', 'bin/cli.js', 'hang'], timeoutMs: 400 });
    expect(res.json.timedOut).toBe(true);
    const saved = record(steps().at(-1)?.record!);
    expect(saved.timedOut).toBe(true);
    expect(saved.signal).toBe('SIGKILL');
  });

  it('refuses a shell string — argv is an array or nothing', async () => {
    const before = steps().length;
    const res = await call('run', { argv: 'node bin/cli.js --version' });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toMatch(/array of strings/);
    // Still recorded: a malformed instruction is evidence of a confused persona.
    expect(steps().length).toBe(before + 1);
    expect(steps().at(-1)!.record).toBeNull();
  });

  it('does not record reads as steps', async () => {
    const before = steps().length;
    await call('docs');
    await call('records');
    expect(steps().length).toBe(before);
  });
});

describe('pty bridge docs — the README is the UI', () => {
  it('serves the README and the quickstart, and nothing else', async () => {
    const res = await call('docs');
    const files = res.json.files as string[];
    expect(files).toContain('README.md');
    expect(files).toContain('docs/quickstart.md');
    expect(files).not.toContain('package.json');
    expect(files.some((f) => f.endsWith('.ts'))).toBe(false);
  });

  it("returns the documents' text, so the persona can follow them literally", async () => {
    const docs = (await call('docs')).json.docs as Array<{ file: string; text: string }>;
    expect(docs.find((d) => d.file === 'README.md')?.text).toContain('node bin/cli.js add');
  });

  it('refuses to serve a source file even when named explicitly', async () => {
    const res = await call('docs', { file: 'src/index.ts' });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toMatch(/No such doc/);
    // And the secret really is in that file — the refusal is doing work.
    expect(readFileSync(path.join(product, 'src', 'index.ts'), 'utf-8')).toContain(
      'SECRET_IMPLEMENTATION',
    );
  });

  it('finds docs by name, at the root and under docs/', () => {
    expect(findDocs(product)).toEqual(['README.md', 'docs/quickstart.md']);
  });
});

describe('pty bridge access control', () => {
  it('refuses a wrong token for a session that exists', async () => {
    const res = await fetch(`${bridge.url}/s/naive-developer-1/${'0'.repeat(32)}/records`);
    expect(res.status).toBe(403);
  });

  it("keeps each persona's transcripts in its own directory", async () => {
    const other = (await bridge.session('saboteur')).url;
    await fetch(`${other}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ argv: ['node', 'bin/cli.js', '--version'] }),
    });
    expect(steps('saboteur').length).toBe(1);
    expect(steps('saboteur')[0].record).toMatch(/^personas\/saboteur\/records\//);
  });
});
