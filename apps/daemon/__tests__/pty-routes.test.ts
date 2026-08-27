/**
 * `/api/pty/**` — the Studio terminal route layer (OD-135).
 *
 * The pty-bridge core (spawn, timeout, credential-scrubbing, the loopback HTTP
 * surface) is mocked here on purpose: these tests are about the route layer's
 * own job — refusing repo-less projects, scoping sessions to the project that
 * opened them, and relaying typed lines to whatever the bridge returns — not
 * about re-proving pty-bridge.ts's own spawn behaviour (that lives in
 * harness-pty-bridge.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonRequest } from '../src/http';

const sessionMock = vi.fn(async (name: string) => ({
  url: `http://127.0.0.1:9999/s/${name}/test-token`,
  token: 'test-token',
  stepsPath: `personas/${name}/steps.jsonl`,
}));
const closeMock = vi.fn(async () => undefined);
const startPtyBridgeMock = vi.fn(async () => ({
  url: 'http://127.0.0.1:9999',
  session: sessionMock,
  close: closeMock,
}));

vi.mock('../src/harness/pty-bridge', () => ({
  startPtyBridge: startPtyBridgeMock,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rm: vi.fn(async () => undefined) };
});

let repoOk = true;
vi.mock('../src/routes/projects/_id/_lib', () => ({
  requireRepo: async () =>
    repoOk
      ? { ok: true, project: { id: 'proj_1', repoPath: '/repo' }, repoPath: '/repo' }
      : {
          ok: false,
          response: new Response(JSON.stringify({ error: 'no repo' }), { status: 409 }),
        },
}));

const { POST: createPty } = await import('../src/routes/pty/route');
const { DELETE: killPty } = await import('../src/routes/pty/_id/route');
const { POST: inputPty } = await import('../src/routes/pty/_id/input/route');
const { GET: streamPty } = await import('../src/routes/pty/_id/stream/route');

function post(url: string, body: unknown): DaemonRequest {
  return new DaemonRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Each `enqueue()` call is its own queued chunk, so this drains `count` of them. */
async function readSseFrames(
  res: Response,
  count: number,
): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (let i = 0; i < count; i++) {
    const { value } = await reader.read();
    text += decoder.decode(value);
  }
  await reader.cancel();
  return text
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice('event: '.length);
      const data = JSON.parse(
        lines.find((l) => l.startsWith('data: '))!.slice('data: '.length),
      ) as unknown;
      return { event, data };
    });
}

async function create(projectId = 'proj_1'): Promise<string> {
  const res = await createPty(await post('http://127.0.0.1/api/pty', { projectId }));
  const body = (await res.json()) as { id: string };
  return body.id;
}

beforeEach(() => {
  repoOk = true;
  startPtyBridgeMock.mockClear();
  sessionMock.mockClear();
  closeMock.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            exitCode: 0,
            signal: null,
            timedOut: false,
            stdout: 'hi\n',
            stderr: '',
            outputTruncated: false,
            durationMs: 1,
            spawnError: null,
          }),
          { status: 200 },
        ),
    ),
  );
});

describe('POST /api/pty', () => {
  it('refuses a project with no repo — no shell for repo-less projects', async () => {
    repoOk = false;
    const res = await createPty(await post('http://127.0.0.1/api/pty', { projectId: 'proj_1' }));
    expect(res.status).toBe(409);
    expect(startPtyBridgeMock).not.toHaveBeenCalled();
  });

  it('requires a projectId', async () => {
    const res = await createPty(await post('http://127.0.0.1/api/pty', {}));
    expect(res.status).toBe(400);
  });

  it("starts a bridge rooted at the project's repoPath and returns a session id", async () => {
    const res = await createPty(await post('http://127.0.0.1/api/pty', { projectId: 'proj_1' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; projectId: string };
    expect(body.id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.projectId).toBe('proj_1');
    expect(startPtyBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo', productUrl: null }),
    );
  });
});

describe('session scoping', () => {
  it('404s input for the wrong projectId — a session never leaks across projects', async () => {
    const id = await create('proj_1');
    const res = await inputPty(
      await post(`http://127.0.0.1/api/pty/${id}/input`, {
        projectId: 'proj_OTHER',
        data: 'echo hi',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('404s kill and stream for an unknown id', async () => {
    const killRes = await killPty(
      new DaemonRequest('http://127.0.0.1/api/pty/nope?projectId=proj_1', { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: 'nope' }),
      },
    );
    expect(killRes.status).toBe(404);

    const streamRes = await streamPty(
      new DaemonRequest('http://127.0.0.1/api/pty/nope/stream?projectId=proj_1'),
      {
        params: Promise.resolve({ id: 'nope' }),
      },
    );
    expect(streamRes.status).toBe(404);
  });
});

describe('POST /api/pty/:id/input', () => {
  it('relays the typed line as `sh -lc <line>` — never a hand-split shell string', async () => {
    const id = await create('proj_1');
    const res = await inputPty(
      await post(`http://127.0.0.1/api/pty/${id}/input`, { projectId: 'proj_1', data: 'echo hi' }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/s/shell/test-token/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ argv: ['sh', '-lc', 'echo hi'] }),
      }),
    );
  });

  it('rejects an empty line', async () => {
    const id = await create('proj_1');
    const res = await inputPty(
      await post(`http://127.0.0.1/api/pty/${id}/input`, { projectId: 'proj_1', data: '' }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pty/:id/stream', () => {
  it("replays the command echo and the bridge's stdout as SSE frames", async () => {
    const id = await create('proj_1');
    await inputPty(
      await post(`http://127.0.0.1/api/pty/${id}/input`, { projectId: 'proj_1', data: 'echo hi' }),
      {
        params: Promise.resolve({ id }),
      },
    );

    const res = await streamPty(
      new DaemonRequest(`http://127.0.0.1/api/pty/${id}/stream?projectId=proj_1`),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const frames = await readSseFrames(res, 2);
    expect(frames.map((f) => f.data)).toEqual(['$ echo hi\n', 'hi\n']);
  });
});

describe('DELETE /api/pty/:id', () => {
  it('kills the bridge and forgets the session', async () => {
    const id = await create('proj_1');
    const res = await killPty(
      new DaemonRequest(`http://127.0.0.1/api/pty/${id}?projectId=proj_1`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(res.status).toBe(200);
    expect(closeMock).toHaveBeenCalledOnce();

    const again = await killPty(
      new DaemonRequest(`http://127.0.0.1/api/pty/${id}?projectId=proj_1`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(again.status).toBe(404);
  });
});
