/**
 * The guards on the workspace wipe (process audit P2).
 *
 * The point of every case here is the same: `POST /api/checkpoints/new` erases
 * everything, and it must be unreachable by accident — a bodiless retry, a
 * cross-site POST, or a request that lands while the engine is dispatching.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonRequest } from '../../../http';

/** `Response.json()` is `unknown` under this config; every assertion below reads fields. */
async function json<T = Record<string, string>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const engineRunning = vi.fn(() => false);
const activeRuns = vi.fn(async () => ({ runs: [] as Array<{ status?: string }> }));
const saved = vi.fn(async () => {});
const savedCheckpoint = vi.fn(async (_snap: unknown) => {});

vi.mock('../../../engine/lifecycle', () => ({ isEngineRunning: () => engineRunning() }));
vi.mock('node:child_process', () => ({
  exec: (_cmd: string, _opts: unknown, cb: () => void) => cb(),
}));
vi.mock('../../../store/data', () => ({
  getActiveRuns: () => activeRuns(),
  getAllCoreData: async () => ({ tasks: { tasks: [] } }),
  saveCheckpoint: (snap: unknown) => savedCheckpoint(snap),
  saveTasks: () => saved(),
  saveGoals: () => saved(),
  saveProjects: () => saved(),
  saveBrainDump: () => saved(),
  saveInbox: () => saved(),
  saveDecisions: () => saved(),
  saveAgents: () => saved(),
  saveSkillsLibrary: () => saved(),
  saveActivityLog: () => saved(),
}));

function post(body?: unknown): DaemonRequest {
  return new DaemonRequest('http://internal/api/checkpoints/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  engineRunning.mockReturnValue(false);
  activeRuns.mockResolvedValue({ runs: [] });
});

describe('POST /api/checkpoints/new — the wipe is not reachable by accident', () => {
  it('refuses a body with no confirm, and erases nothing', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ name: 'audit-1' }));

    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/confirm/);
    expect(saved).not.toHaveBeenCalled();
    expect(savedCheckpoint).not.toHaveBeenCalled();
  });

  it('refuses an empty body too — a bare POST used to wipe the workspace', async () => {
    const { POST } = await import('./route');
    expect((await POST(post())).status).toBe(400);
    expect(saved).not.toHaveBeenCalled();
  });

  it("refuses confirm:'true' — the string is not the boolean", async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ confirm: 'true' }))).status).toBe(400);
    expect(saved).not.toHaveBeenCalled();
  });

  it('409s while the engine is running, the same as checkpoints/load', async () => {
    engineRunning.mockReturnValue(true);
    const { POST } = await import('./route');
    const res = await POST(post({ confirm: true }));

    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/daemon/i);
    expect(saved).not.toHaveBeenCalled();
  });

  it('409s while a run is still in progress', async () => {
    activeRuns.mockResolvedValue({ runs: [{ status: 'running' }] });
    const { POST } = await import('./route');

    expect((await POST(post({ confirm: true }))).status).toBe(409);
    expect(saved).not.toHaveBeenCalled();
  });

  it('takes a checkpoint BEFORE wiping, and reports its id', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ confirm: true }));

    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; checkpointId: string }>(res);
    expect(body.ok).toBe(true);
    expect(body.checkpointId).toMatch(/^snap_\d+$/);
    expect(savedCheckpoint).toHaveBeenCalledTimes(1);
    // Nine stores cleared.
    expect(saved).toHaveBeenCalledTimes(9);
    // The snapshot has to exist before the first store is cleared, or a wipe on
    // a workspace with no checkpoints has no recovery path at all.
    expect(savedCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      saved.mock.invocationCallOrder[0]!,
    );
  });
});
