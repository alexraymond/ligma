/**
 * HTTP-bridge tests against a fixture API.
 *
 * The bridge is a trust boundary and an evidence recorder, so the assertions are
 * the same two the browser bridge answers, asked of a transport with no screen:
 * a persona cannot leave the product origin, and what it did is on disk whether
 * or not it says so. The third is specific to headless verification — a 4xx/5xx
 * is a RECORDED OBSERVATION, never a bridge error, because "the product returned
 * 500" is exactly the finding a headless panel exists to produce.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bridge, BridgeStep } from '../src/harness/bridge-server';
import {
  type HttpRecord,
  describeShape,
  schemaOf,
  startHttpBridge,
} from '../src/harness/http-bridge';

let server: http.Server;
let baseUrl: string;
let runDir: string;
let bridge: Bridge;
let sessionUrl: string;

/** A tiny fixture API: one resource, one broken endpoint, one non-JSON page. */
function fixtureApi(): http.Server {
  const tasks: Array<{ id: string; title: string; done: boolean; tags: string[] }> = [];
  return http.createServer((req, res) => {
    const json = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json',
        'set-cookie': 'session=supersecret',
      });
      res.end(text);
    };
    const url = new URL(req.url ?? '/', 'http://x');

    if (url.pathname === '/api/tasks' && req.method === 'GET') return json(200, { tasks });
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += String(c)));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(raw) as { title?: unknown };
          if (typeof parsed.title !== 'string')
            return json(400, { error: 'title must be a string' });
          const task = {
            id: `t${tasks.length + 1}`,
            title: parsed.title,
            done: false,
            tags: ['new'],
          };
          tasks.push(task);
          return json(201, task);
        } catch {
          return json(400, { error: 'body is not JSON' });
        }
      });
      return;
    }
    if (url.pathname === '/api/boom') return json(500, { error: 'kaboom' });
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<h1>Fixture API</h1>');
    }
    return json(404, { error: 'not found' });
  });
}

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

function record(rel: string): HttpRecord {
  return JSON.parse(readFileSync(path.join(runDir, rel), 'utf-8')) as HttpRecord;
}

beforeAll(async () => {
  server = fixtureApi();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  runDir = mkdtempSync(path.join(tmpdir(), 'mc-http-bridge-'));
  bridge = await startHttpBridge({ baseUrl, runDir });
  sessionUrl = (await bridge.session('naive-developer-1')).url;
});

afterAll(async () => {
  await bridge?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(runDir, { recursive: true, force: true });
});

describe('http bridge origin lock', () => {
  it('refuses to call off the product origin with 403', async () => {
    const res = await call('request', { method: 'GET', url: 'https://example.com/' });
    expect(res.status).toBe(403);
    expect(String(res.json.error)).toMatch(/Refusing to call/);
  });

  it('refuses a different localhost port — another env is still not this env', async () => {
    const other = new URL(baseUrl).port === '9' ? '10' : '9';
    expect(
      (await call('request', { method: 'GET', url: `http://127.0.0.1:${other}/` })).status,
    ).toBe(403);
  });

  it('records the refused call as a step, so a blocked attempt is evidence', () => {
    const refused = steps('naive-developer-1').filter((s) => s.error !== null);
    expect(refused.length).toBeGreaterThanOrEqual(2);
    expect(refused[0].error).toMatch(/Refusing to call/);
    // Nothing was sent, so there is nothing to point at.
    expect(refused[0].record).toBeNull();
  });

  it('resolves a bare path against the product origin', async () => {
    const res = await call('request', { method: 'GET', path: '/api/tasks' });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe(200);
  });
});

describe('http bridge evidence', () => {
  it('writes a full request/response record and links it from the step', async () => {
    const res = await call('request', {
      method: 'POST',
      path: '/api/tasks',
      json: { title: 'Buy milk' },
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe(201);

    const step = steps('naive-developer-1').at(-1)!;
    expect(step.action).toBe('request');
    expect(step.url).toBe(`${baseUrl}/api/tasks`);
    expect(step.error).toBeNull();
    expect(step.record).toMatch(/^personas\/naive-developer-1\/records\/\d\d-POST-.*\.json$/);
    expect(existsSync(path.join(runDir, step.record!))).toBe(true);

    const saved = record(step.record!);
    expect(saved.method).toBe('POST');
    expect(saved.status).toBe(201);
    expect(saved.requestBody).toBe('{"title":"Buy milk"}');
    expect(JSON.parse(saved.body)).toMatchObject({ title: 'Buy milk', done: false });
    expect(saved.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records the response SCHEMA — what a headless baseline compares', () => {
    const step = steps('naive-developer-1').at(-1)!;
    expect(record(step.record!).schema).toBe('{done:boolean,id:string,tags:string[],title:string}');
  });

  it('scrubs credentials out of recorded headers', () => {
    const step = steps('naive-developer-1').at(-1)!;
    expect(JSON.stringify(record(step.record!).responseHeaders)).not.toContain('supersecret');
  });

  it('treats a 500 as an observation, not a bridge error', async () => {
    const res = await call('request', { method: 'GET', path: '/api/boom' });
    // The bridge call SUCCEEDED. The product's 500 is the finding.
    expect(res.status).toBe(200);
    expect(res.json.status).toBe(500);
    const step = steps('naive-developer-1').at(-1)!;
    expect(step.error).toBeNull();
    expect(record(step.record!).status).toBe(500);
  });

  it("sends a raw malformed body when asked — the saboteur's whole job", async () => {
    const res = await call('request', {
      method: 'POST',
      path: '/api/tasks',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.json.status).toBe(400);
    expect(record(steps('naive-developer-1').at(-1)?.record!).requestBody).toBe('{not json');
  });

  it('gives no schema for a non-JSON response', async () => {
    await call('request', { method: 'GET', path: '/' });
    const saved = record(steps('naive-developer-1').at(-1)?.record!);
    expect(saved.contentType).toMatch(/text\/html/);
    expect(saved.schema).toBeNull();
  });

  it('rejects an unsupported method before anything is sent', async () => {
    const before = steps('naive-developer-1').length;
    const res = await call('request', { method: 'TRACE', path: '/' });
    expect(res.status).toBe(400);
    expect(steps('naive-developer-1').length).toBe(before + 1);
    expect(steps('naive-developer-1').at(-1)!.record).toBeNull();
  });

  it('does not record reads as steps', async () => {
    const before = steps('naive-developer-1').length;
    await call('records');
    await call('base');
    expect(steps('naive-developer-1').length).toBe(before);
  });

  it("keeps each persona's evidence in its own directory", async () => {
    const other = (await bridge.session('saboteur')).url;
    await fetch(`${other}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/api/tasks' }),
    });
    expect(steps('saboteur').length).toBe(1);
    expect(steps('saboteur')[0].record).toMatch(/^personas\/saboteur\/records\//);
  });
});

describe('http bridge access control', () => {
  it('refuses an untokenised call', async () => {
    expect((await fetch(`${bridge.url}/s/naive-developer-1/records`)).status).toBe(404);
  });

  it('refuses a wrong token for a session that exists', async () => {
    const res = await fetch(`${bridge.url}/s/naive-developer-1/${'0'.repeat(32)}/records`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('bridge: unauthorized');
  });

  it('refuses a rebound (non-loopback) Host header', async () => {
    const target = new URL(`${sessionUrl}/records`);
    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: Number(target.port),
            path: target.pathname,
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
});

// ─── Schema derivation ───────────────────────────────────────────────────────

describe('response schemas', () => {
  it('describes shape, not content', () => {
    expect(describeShape({ id: 'a', n: 1, ok: true, missing: null })).toBe(
      '{id:string,missing:null,n:number,ok:boolean}',
    );
    expect(describeShape([{ id: 'a' }])).toBe('{id:string}[]');
    expect(describeShape([])).toBe('unknown[]');
  });

  it('sorts keys, so a reordering serializer is not a regression', () => {
    expect(describeShape({ b: 1, a: 'x' })).toBe(describeShape({ a: 'y', b: 2 }));
  });

  it('changes when a TYPE changes, which is the regression that matters', () => {
    expect(describeShape({ id: 'a' })).not.toBe(describeShape({ id: 1 }));
  });

  it('stops descending rather than recursing forever', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 12; i++) deep = { next: deep };
    expect(describeShape(deep)).toContain('object');
  });

  it('returns null for a body that is not JSON', () => {
    expect(schemaOf('<h1>hi</h1>', 'text/html')).toBeNull();
    expect(schemaOf('not json', 'application/json')).toBeNull();
    expect(schemaOf('{"a":1}', null)).toBe('{a:number}');
  });
});
