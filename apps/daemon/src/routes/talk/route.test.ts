import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previousData: string | undefined;
let projectExists = true;
let agents: Array<{ id: string }> = [];
const dispatched: Array<{ projectId: string; body: string; to: string }> = [];

vi.mock('../projects/_id/_lib', () => ({
  findProject: async (id: string) => (projectExists ? { id, name: 'P', repoPath: null } : null),
  badRequest: (err: unknown) =>
    new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
    }),
}));

// The respond pass is a spawn. It is exercised in run-talk-respond.test.ts with
// an injected agent; here we only assert the route dispatches it and does not
// wait on it.
vi.mock('../../engine/run-talk-respond', () => ({
  runTalkRespond: async (projectId: string, message: { body: string }, to: string) => {
    dispatched.push({ projectId, body: message.body, to });
    return null;
  },
}));

vi.mock('../../store/data', () => ({
  getAgents: async () => ({ agents }),
}));

beforeEach(() => {
  projectExists = true;
  agents = [{ id: 'researcher' }];
  dispatched.length = 0;
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-talk-route-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

function post(id: string, body: unknown) {
  return import('./route').then(({ POST }) =>
    POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    ),
  );
}

function get(id: string) {
  return import('./route').then(({ GET }) =>
    GET(new Request('http://localhost/x'), { params: Promise.resolve({ id }) }),
  );
}

describe('GET/POST /api/projects/:id/talk', () => {
  it('404s for a project that does not exist', async () => {
    projectExists = false;
    expect((await get('nope')).status).toBe(404);
    expect((await post('nope', { body: 'hi' })).status).toBe(404);
  });

  it('appends the human message and returns it', async () => {
    const res = await post('proj_a', { body: 'why is the login task stuck?' });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { message: { author: string; body: string; id: string } };
    expect(payload.message.author).toBe('you');
    expect(payload.message.body).toBe('why is the login task stuck?');

    const listed = (await (await get('proj_a')).json()) as { messages: Array<{ id: string }> };
    expect(listed.messages.map((m) => m.id)).toEqual([payload.message.id]);
  });

  it('dispatches a respond run addressed to the system by default', async () => {
    await post('proj_a', { body: 'hello' });
    expect(dispatched).toEqual([{ projectId: 'proj_a', body: 'hello', to: 'system' }]);
  });

  it('carries an addressed crew member through to the respond run', async () => {
    await post('proj_a', { body: '@researcher what did you find?', to: 'researcher' });
    expect(dispatched[0]?.to).toBe('researcher');
  });

  it('400s on a crew member that does not exist', async () => {
    const res = await post('proj_a', { body: 'hi', to: 'wizard' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'No crew member with id "wizard"',
    });
    expect(dispatched).toHaveLength(0);
  });

  it('400s on an empty body and on invalid JSON', async () => {
    expect((await post('proj_a', { body: '' })).status).toBe(400);
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      { params: Promise.resolve({ id: 'proj_a' }) },
    );
    expect(res.status).toBe(400);
  });

  it('lists an untouched thread as empty rather than 404', async () => {
    const res = await get('proj_a');
    expect(res.status).toBe(200);
    expect((await res.json()) as { messages: unknown[] }).toEqual({
      projectId: 'proj_a',
      messages: [],
    });
  });
});
