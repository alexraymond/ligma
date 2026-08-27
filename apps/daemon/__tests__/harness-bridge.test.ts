/**
 * Browser-bridge tests against a real Chromium and a real static server.
 *
 * The bridge is the harness's trust boundary, so these assertions are about
 * behaviour that must hold even when the persona misbehaves: it cannot leave the
 * product origin, and its actions are recorded whether or not it says so.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Bridge, type BridgeStep, startBridge } from '../src/harness/browser-bridge';

const PAGE = `<!doctype html><html><head><title>Bridge Fixture</title></head><body>
<h1>Task board</h1>
<button id="add">New Task</button>
<input id="title" />
<p id="out">nothing yet</p>
<script>
  document.getElementById('add').addEventListener('click', () => {
    document.getElementById('out').textContent = 'clicked:' + document.getElementById('title').value;
  });
</script>
</body></html>`;

let server: http.Server;
let origin: string;
let runDir: string;
let bridge: Bridge;
let sessionUrl: string;

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

function steps(name: string): BridgeStep[] {
  const file = path.join(runDir, 'personas', name, 'steps.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BridgeStep);
}

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${addr.port}`;

  runDir = mkdtempSync(path.join(tmpdir(), 'mc-bridge-run-'));
  bridge = await startBridge({ origin, runDir });
  sessionUrl = (await bridge.session('naive-user-1')).url;
}, 120_000);

afterAll(async () => {
  await bridge?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(runDir, { recursive: true, force: true });
});

describe('browser bridge origin lock', () => {
  it('refuses to navigate off the product origin with 403', async () => {
    const res = await call('goto', { url: 'https://example.com/' });
    expect(res.status).toBe(403);
    expect(String(res.json.error)).toMatch(/Refusing to navigate/);
  });

  it('refuses a different localhost port — another env is still not this env', async () => {
    const otherPort = new URL(origin).port === '9' ? '10' : '9';
    const res = await call('goto', { url: `http://127.0.0.1:${otherPort}/` });
    expect(res.status).toBe(403);
  });

  it('records the refused navigation as a step, so a blocked attempt is evidence', () => {
    const refused = steps('naive-user-1').filter((s) => s.action === 'goto' && s.error !== null);
    expect(refused.length).toBeGreaterThanOrEqual(2);
    expect(refused[0].error).toMatch(/Refusing to navigate/);
  });

  it('accepts a bare path, resolved against the product origin', async () => {
    const res = await call('goto', { url: '/' });
    expect(res.status).toBe(200);
    expect(res.json.url).toBe(`${origin}/`);
  });
});

describe('browser bridge step recording', () => {
  it('records every mutating action with an index, timing and url', async () => {
    const before = steps('naive-user-1').length;
    await call('fill', { selector: '#title', value: 'Buy milk' });
    await call('click', { text: 'New Task' });

    const recorded = steps('naive-user-1');
    expect(recorded.length).toBe(before + 2);

    const fill = recorded[recorded.length - 2];
    const click = recorded[recorded.length - 1];
    expect(fill.action).toBe('fill');
    expect(click.action).toBe('click');
    expect(click.index).toBe(fill.index + 1);
    expect(click.url).toBe(`${origin}/`);
    expect(click.durationMs).toBeGreaterThanOrEqual(0);
    expect(click.error).toBeNull();
    // Indices are strictly increasing — the ordering of the evidence is not a guess.
    expect(recorded.map((s) => s.index)).toEqual(recorded.map((_, i) => i + 1));
  });

  it('does not record reads as steps', async () => {
    const before = steps('naive-user-1').length;
    await call('snapshot');
    await call('console');
    expect(steps('naive-user-1').length).toBe(before);
  });

  it('really performed the actions in the page', async () => {
    const snap = await call('snapshot');
    expect(String(snap.json.text)).toContain('clicked:Buy milk');
  });

  it('auto-captures a screenshot file for clicks and navigations', () => {
    const withShots = steps('naive-user-1').filter((s) => s.screenshot !== null);
    expect(withShots.length).toBeGreaterThan(0);
    for (const step of withShots) {
      expect(['goto', 'click']).toContain(step.action);
      // The path in the evidence must point at a file that exists.
      expect(existsSync(path.join(runDir, step.screenshot!))).toBe(true);
      expect(step.screenshot!.startsWith('personas/naive-user-1/shots/')).toBe(true);
    }
  });

  it('captures a screenshot even when the action failed', () => {
    const failed = steps('naive-user-1').find((s) => s.action === 'goto' && s.error !== null);
    expect(failed?.screenshot).toBeTruthy();
    expect(existsSync(path.join(runDir, failed?.screenshot!))).toBe(true);
  });

  it("keeps each persona's evidence in its own directory", async () => {
    const other = (await bridge.session('saboteur')).url;
    await fetch(`${other}/goto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '/' }),
    });
    expect(steps('saboteur').length).toBe(1);
    expect(steps('saboteur')[0].screenshot).toMatch(/^personas\/saboteur\/shots\//);
  });

  it('rejects calls for an unregistered session', async () => {
    const res = await fetch(`${bridge.url}/s/who-is-this/snapshot`);
    expect(res.status).toBe(404);
  });
});

// ─── Access control ─────────────────────────────────────────────────────────

describe('browser bridge access control', () => {
  it('refuses an untokenised call — the old /s/<session>/<action> shape', async () => {
    const res = await fetch(`${bridge.url}/s/naive-user-1/snapshot`);
    expect(res.status).toBe(404);
    expect(steps('naive-user-1').every((s) => s.action !== 'snapshot')).toBe(true);
  });

  it('refuses a wrong token for a session that exists', async () => {
    const res = await fetch(`${bridge.url}/s/naive-user-1/${'0'.repeat(32)}/snapshot`);
    expect(res.status).toBe(403);
    expect(String(((await res.json()) as { error: string }).error)).toBe('bridge: unauthorized');
  });

  it("does not let one persona drive another persona's session", async () => {
    const mine = await bridge.session('visual-critic');
    const theirs = await bridge.session('returning-user');
    const before = steps('returning-user').length;

    const res = await fetch(`${bridge.url}/s/returning-user/${mine.token}/goto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '/' }),
    });

    expect(res.status).toBe(403);
    expect(steps('returning-user').length).toBe(before);
    // The victim's own token still works, so this is a scoping check, not an outage.
    const ok = await fetch(`${theirs.url}/goto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '/' }),
    });
    expect(ok.status).toBe(200);
  });

  it('refuses a rebound (non-loopback) Host header', async () => {
    // fetch() refuses to set Host, so this goes through raw http — which is
    // exactly what a rebound page's request looks like on the wire.
    const target = new URL(`${sessionUrl}/snapshot`);
    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: Number(target.port),
            path: target.pathname,
            method: 'GET',
            headers: { host: 'evil.example.com' },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += String(c)));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(status).toBe(403);
    expect(body).toMatch(/non-loopback Host/);
  });

  it('mints a different token per session', async () => {
    const a = await bridge.session('saboteur-2');
    const b = await bridge.session('naive-user-2');
    expect(a.token).not.toEqual(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
  });
});
