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
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-design-files-route-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function post(id: string, body: unknown) {
  return new Request(`http://localhost/api/references/${id}/design-files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/references/:id/design-files', () => {
  it('404s for a project that does not exist', async () => {
    projectExists = false;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/references/nope/design-files'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('starts empty', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/references/proj_a/design-files'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect((await res.json()) as unknown).toEqual({ projectId: 'proj_a', designFiles: [] });
  });
});

describe('POST /api/references/:id/design-files', () => {
  it('uploads a small base64 file and lists it back', async () => {
    const { POST } = await import('./route');
    const { GET } = await import('./route');
    const uploadRes = await POST(
      post('proj_a', { name: 'mock.png', dataUrl: `data:image/png;base64,${tinyPngBase64}` }),
      {
        params: Promise.resolve({ id: 'proj_a' }),
      },
    );
    expect(uploadRes.status).toBe(201);

    const listRes = await GET(new Request('http://localhost/api/references/proj_a/design-files'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    const body = (await listRes.json()) as {
      designFiles: Array<{ name: string; mime: string; size: number }>;
    };
    expect(body.designFiles).toHaveLength(1);
    expect(body.designFiles[0]).toMatchObject({ name: 'mock.png', mime: 'image/png' });
    expect(body.designFiles[0].size).toBeGreaterThan(0);
  });

  it("rejects a payload that isn't a data: URL", async () => {
    const { POST } = await import('./route');
    const res = await POST(post('proj_a', { name: 'x.png', dataUrl: 'nope' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a file over the size cap', async () => {
    const { POST } = await import('./route');
    const huge = 'A'.repeat(15_000_000);
    const res = await POST(
      post('proj_a', { name: 'huge.bin', dataUrl: `data:application/octet-stream;base64,${huge}` }),
      {
        params: Promise.resolve({ id: 'proj_a' }),
      },
    );
    expect(res.status).toBe(413);
  });
});

describe('DELETE /api/references/:id/design-files/:fileId', () => {
  it('removes a file and 404s deleting it again', async () => {
    const { POST } = await import('./route');
    const { DELETE } = await import('./_fileId/route');

    const created = await POST(
      post('proj_a', { name: 'mock.png', dataUrl: `data:image/png;base64,${tinyPngBase64}` }),
      {
        params: Promise.resolve({ id: 'proj_a' }),
      },
    );
    const fileId = ((await created.json()) as { designFiles: Array<{ id: string }> }).designFiles[0]
      .id;

    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'proj_a', fileId }),
    });
    expect(res.status).toBe(200);

    const again = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'proj_a', fileId }),
    });
    expect(again.status).toBe(404);
  });
});
