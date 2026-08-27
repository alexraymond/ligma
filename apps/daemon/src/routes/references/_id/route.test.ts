import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previousData: string | undefined;
let projectExists = true;

vi.mock('../../projects/_id/_lib', () => ({
  findProject: async (id: string) => (projectExists ? { id, name: 'P', repoPath: null } : null),
  badRequest: (err: unknown) =>
    new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
    }),
}));

beforeEach(() => {
  projectExists = true;
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-references-route-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  vi.resetModules();
  // Default stub so link-adding tests that don't care about the scrape never
  // make a real network call; tests that do care override this per-case.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<title>Stub</title>')),
  );
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function post(id: string, body: unknown) {
  return new Request(`http://localhost/api/references/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/references/:id', () => {
  it('404s for a project that does not exist', async () => {
    projectExists = false;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/references/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('starts empty for a project that has never added a reference', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/references/proj_a'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { references: unknown[] }).toEqual({
      projectId: 'proj_a',
      references: [],
    });
  });
});

describe('POST /api/references/:id — link', () => {
  it('scrapes the title server-side and derives the domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><head><title>  Cool Site  </title></head></html>')),
    );
    const { POST } = await import('./route');
    const res = await POST(post('proj_a', { kind: 'link', url: 'https://example.com/page' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      references: Array<{ title: string; domain: string; kind: string }>;
    };
    expect(body.references[0]).toMatchObject({
      kind: 'link',
      title: 'Cool Site',
      domain: 'example.com',
    });
  });

  it('falls back to the hostname when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const { POST } = await import('./route');
    const res = await POST(post('proj_a', { kind: 'link', url: 'https://example.com/page' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { references: Array<{ title: string }> };
    expect(body.references[0].title).toBe('example.com');
  });

  it('rejects a malformed url', async () => {
    const { POST } = await import('./route');
    const res = await POST(post('proj_a', { kind: 'link', url: 'not-a-url' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/references/:id — screenshot', () => {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('accepts a small base64 image', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post('proj_a', {
        kind: 'screenshot',
        dataUrl: `data:image/png;base64,${tinyPngBase64}`,
        note: 'hero shot',
      }),
      { params: Promise.resolve({ id: 'proj_a' }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      references: Array<{ kind: string; mime: string; note: string }>;
    };
    expect(body.references[0]).toMatchObject({
      kind: 'screenshot',
      mime: 'image/png',
      note: 'hero shot',
    });
  });

  it("rejects a payload that isn't a data: URL", async () => {
    const { POST } = await import('./route');
    const res = await POST(post('proj_a', { kind: 'screenshot', dataUrl: 'not-a-data-url' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an image over the size cap', async () => {
    const { POST } = await import('./route');
    // ~7.5MB of decoded bytes, base64-encoded — over the 5MB cap.
    const huge = 'A'.repeat(10_000_000);
    const res = await POST(
      post('proj_a', { kind: 'screenshot', dataUrl: `data:image/png;base64,${huge}` }),
      {
        params: Promise.resolve({ id: 'proj_a' }),
      },
    );
    expect(res.status).toBe(413);
  });
});

describe('DELETE /api/references/:id/:refId', () => {
  it('removes a reference and 404s deleting it again', async () => {
    const { POST } = await import('./route');
    const { DELETE } = await import('./_refId/route');

    const created = await POST(post('proj_a', { kind: 'link', url: 'https://example.com' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    const refId = ((await created.json()) as { references: Array<{ id: string }> }).references[0]
      .id;

    const res = await DELETE(
      new Request(`http://localhost/api/references/proj_a/${refId}`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: 'proj_a', refId }),
      },
    );
    expect(res.status).toBe(200);

    const again = await DELETE(
      new Request(`http://localhost/api/references/proj_a/${refId}`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: 'proj_a', refId }),
      },
    );
    expect(again.status).toBe(404);
  });
});
