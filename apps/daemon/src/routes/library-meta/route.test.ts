import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-library-meta-route-'));
  process.env.LIGMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/library-meta', () => {
  it('reports no entries for a fresh checkout', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it('lists an entry after a use is recorded through the store', async () => {
    const { mutateLibraryMeta, recordUse } = await import('./store');
    await mutateLibraryMeta((data) => recordUse(data, 'design-system', 'mono'));

    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({
      entries: [{ kind: 'design-system', id: 'mono', useCount: 1, saved: false }],
    });
  });
});
