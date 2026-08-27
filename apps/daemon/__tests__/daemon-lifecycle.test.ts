import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
/**
 * Stopping the daemon stops the dispatch loop, not the API.
 *
 * The parent's stop button took the engine down while the UI kept working. The
 * API and the engine share one process here, so the risk this pins is that a
 * stop kills the server with the loop: every assertion below is made over HTTP,
 * so a dead API fails the test by definition.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-lifecycle-'));
process.env.LIGMA_DATA_DIR = dataDir;

// Polling and every schedule off: this test starts a real engine, and a real
// engine that polls would dispatch real agents against Alex's subscription.
writeFileSync(
  path.join(dataDir, 'daemon-config.json'),
  JSON.stringify({
    polling: { enabled: false, intervalMinutes: 2 },
    concurrency: { maxParallelAgents: 1 },
    schedule: {},
    execution: { maxTurns: 1, timeoutMinutes: 1, allowedTools: [] },
  }),
  'utf-8',
);
writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [] }), 'utf-8');
mkdirSync(path.join(dataDir, 'verification-runs'), { recursive: true });

const { createApp } = await import('../src/server');
const { isEngineRunning, stopEngine } = await import('../src/engine/lifecycle');

const PID_FILE = path.join(dataDir, 'daemon.pid');

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

const post = (action: string) =>
  fetch(`${base}/api/daemon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });

const getStatus = async (): Promise<{ status: { status: string }; isRunning: boolean }> => {
  const res = await fetch(`${base}/api/daemon`);
  expect(res.status).toBe(200);
  return (await res.json()) as { status: { status: string }; isRunning: boolean };
};

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await stopEngine('test teardown');
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /api/daemon', () => {
  it('starts the engine loop in the process already serving the API', async () => {
    const res = await post('start');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Daemon starting...', pid: process.pid });
    expect(isEngineRunning()).toBe(true);
    expect(existsSync(PID_FILE)).toBe(true);

    const body = await getStatus();
    expect(body.isRunning).toBe(true);
    expect(body.status.status).toBe('running');
  });

  it('refuses a second engine over the same store', async () => {
    const res = await post('start');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: `Daemon is already running (PID: ${process.pid})` });
    expect(isEngineRunning()).toBe(true);
  });

  it('stops the loop and keeps serving — status stopped, API still answering', async () => {
    const res = await post('stop');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Stop signal sent', pid: process.pid });
    expect(isEngineRunning()).toBe(false);
    expect(existsSync(PID_FILE)).toBe(false);

    // The assertion that matters: this request is served by the process that
    // was just "stopped".
    const body = await getStatus();
    expect(body.isRunning).toBe(false);
    expect(body.status.status).toBe('stopped');
  });

  it('reports a stopped engine rather than pretending to stop it twice', async () => {
    const res = await post('stop');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Daemon is not running' });
  });

  it('starts again after a stop, in the same process', async () => {
    expect((await post('start')).status).toBe(200);
    expect(isEngineRunning()).toBe(true);
    expect((await getStatus()).status.status).toBe('running');

    expect((await post('stop')).status).toBe(200);
    expect(isEngineRunning()).toBe(false);
  });

  it('rejects an unknown action', async () => {
    const res = await post('explode');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid action. Use 'start' or 'stop'" });
  });
});
