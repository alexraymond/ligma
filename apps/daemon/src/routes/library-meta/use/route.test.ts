import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-library-meta-use-'));
  process.env.LIGMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

function postJson(body: unknown): Request {
  return new Request('http://localhost/api/library-meta/use', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/library-meta/use', () => {
  it('starts a fresh entry at 1', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ kind: 'skill', id: 'brand-extract' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: 'skill',
      id: 'brand-extract',
      useCount: 1,
      saved: false,
    });
  });

  it('accumulates across repeated calls', async () => {
    const { POST } = await import('./route');
    await POST(postJson({ kind: 'craft', id: 'color' }));
    const res = await POST(postJson({ kind: 'craft', id: 'color' }));
    const body = (await res.json()) as { useCount: number };
    expect(body.useCount).toBe(2);
  });

  it('rejects an unknown kind', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ kind: 'plugin', id: 'x' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing id', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ kind: 'skill' }));
    expect(res.status).toBe(400);
  });
});
