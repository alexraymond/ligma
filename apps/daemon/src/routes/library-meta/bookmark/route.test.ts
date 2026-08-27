import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-library-meta-bookmark-'));
  process.env.LIGMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

function postJson(body: unknown): Request {
  return new Request('http://localhost/api/library-meta/bookmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/library-meta/bookmark', () => {
  it('saves an entry', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ kind: 'design-system', id: 'mono', saved: true }));
    expect(await res.json()).toEqual({
      kind: 'design-system',
      id: 'mono',
      useCount: 0,
      saved: true,
    });
  });

  it('un-saves an entry (saved is the target state, not a toggle)', async () => {
    const { POST } = await import('./route');
    await POST(postJson({ kind: 'design-system', id: 'mono', saved: true }));
    const res = await POST(postJson({ kind: 'design-system', id: 'mono', saved: false }));
    const body = (await res.json()) as { saved: boolean };
    expect(body.saved).toBe(false);
  });

  it('rejects a missing `saved` field', async () => {
    const { POST } = await import('./route');
    const res = await POST(postJson({ kind: 'design-system', id: 'mono' }));
    expect(res.status).toBe(400);
  });
});
