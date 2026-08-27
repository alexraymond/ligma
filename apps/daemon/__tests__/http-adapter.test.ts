import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
/**
 * The Express seam: the moved handlers still speak Request/Response, so the
 * adapter is the only thing that can break their shapes. Checked against the
 * run-output route because it exercises both directions — a buffered JSON body
 * and the streamed SSE sibling.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-http-'));
process.env.LIGMA_DATA_DIR = dataDir;

const RUN_ID = 'run_adapter';
const LINE = { ts: '2026-08-11T00:00:00.000Z', stream: 'stdout' as const, text: 'hello' };

mkdirSync(path.join(dataDir, 'run-outputs'), { recursive: true });
writeFileSync(
  path.join(dataDir, 'run-outputs', `${RUN_ID}.jsonl`),
  `${JSON.stringify(LINE)}\n`,
  'utf-8',
);
writeFileSync(path.join(dataDir, 'active-runs.json'), JSON.stringify({ runs: [] }), 'utf-8');

const { createApp } = await import('../src/server');

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('express adapter', () => {
  it('serves the polling route with its exact shape', async () => {
    const res = await fetch(`${base}/api/runs/${RUN_ID}/output`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { lines: unknown[]; nextOffset: number; done: boolean };
    expect(body.lines).toEqual([LINE]);
    expect(body.nextOffset).toBeGreaterThan(0);
    expect(body.done).toBe(true);
  });

  it("keeps a handler's 404 body, not just its status", async () => {
    const res = await fetch(`${base}/api/runs/run_missing/output`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Output not found',
      lines: [],
      nextOffset: 0,
      done: true,
    });
  });

  it('405s a method the route does not export', async () => {
    const res = await fetch(`${base}/api/runs/${RUN_ID}/output`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  it('streams the same payload as SSE frames', async () => {
    const res = await fetch(`${base}/api/runs/${RUN_ID}/output/stream`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // the run is done, so the stream closes itself
    expect(text).toContain('event: output');
    expect(text).toContain('event: end');
    const first = text.split('\n\n')[0]?.split('\ndata: ')[1] ?? '';
    expect((JSON.parse(first) as { lines: unknown[] }).lines).toEqual([LINE]);
  });

  it('closes with an `end` frame that repeats no lines', async () => {
    const text = await (await fetch(`${base}/api/runs/${RUN_ID}/output/stream`)).text();
    const frames = text
      .split('\n\n')
      .filter(Boolean)
      .map((f) => ({
        event: f.split('\n')[0]?.slice('event: '.length),
        data: JSON.parse(f.split('\ndata: ')[1] ?? '{}'),
      }));

    // Every line arrives exactly once — the `end` frame is a close signal.
    const lines = frames.flatMap((f) => (f.data as { lines: unknown[] }).lines);
    expect(lines).toEqual([LINE]);

    const end = frames.at(-1)!;
    expect(end.event).toBe('end');
    // Shape unchanged: same three keys, only `lines` emptied.
    expect(end.data).toEqual({ lines: [], nextOffset: expect.any(Number), done: true });
    expect((end.data as { nextOffset: number }).nextOffset).toBeGreaterThan(0);
  });
});
