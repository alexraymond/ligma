import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previousData: string | undefined;
let projectExists = true;

vi.mock('../../../projects/_id/_lib', () => ({
  findProject: async (id: string) => (projectExists ? { id, name: 'P', repoPath: null } : null),
  badRequest: (err: unknown) =>
    new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
    }),
}));

beforeEach(() => {
  projectExists = true;
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-notes-route-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET/POST /api/references/:id/notes', () => {
  it('404s for a project that does not exist', async () => {
    projectExists = false;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('appends a note and lists the thread in order', async () => {
    const { GET, POST } = await import('./route');
    const post = (body: unknown) =>
      POST(
        new Request('http://localhost/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: 'proj_a' }) },
      );

    await post({ body: 'first' });
    await post({ body: 'second' });

    const res = await GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    const body = (await res.json()) as { notes: Array<{ body: string }> };
    expect(body.notes.map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('rejects an empty note', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      }),
      { params: Promise.resolve({ id: 'proj_a' }) },
    );
    expect(res.status).toBe(400);
  });
});
