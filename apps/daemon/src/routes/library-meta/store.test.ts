import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * `library-meta.json` round-trips through `mutateLibraryMeta`/`readLibraryMeta`:
 * a fresh checkout reads as empty, a use bumps the count without touching
 * `saved`, a bookmark sets `saved` without touching the count, and the two
 * kinds never collide on the same id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-library-meta-store-'));
  process.env.LIGMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('readLibraryMeta / mutateLibraryMeta', () => {
  it('a checkout that never touched the store reads as empty', async () => {
    const { readLibraryMeta } = await import('./store');
    expect(await readLibraryMeta()).toEqual({ entries: {} });
  });

  it('records a use, starting from zero', async () => {
    const { mutateLibraryMeta, recordUse } = await import('./store');
    const entry = await mutateLibraryMeta((data) => recordUse(data, 'design-system', 'mono-1'));
    expect(entry).toEqual({ kind: 'design-system', id: 'mono-1', useCount: 1, saved: false });
  });

  it('accumulates use count across calls without disturbing the bookmark', async () => {
    const { mutateLibraryMeta, recordUse, setBookmark } = await import('./store');
    await mutateLibraryMeta((data) => setBookmark(data, 'skill', 'brand-extract-1', true));
    await mutateLibraryMeta((data) => recordUse(data, 'skill', 'brand-extract-1'));
    const entry = await mutateLibraryMeta((data) => recordUse(data, 'skill', 'brand-extract-1'));
    expect(entry).toEqual({ kind: 'skill', id: 'brand-extract-1', useCount: 2, saved: true });
  });

  it('sets and un-sets a bookmark without disturbing the use count', async () => {
    const { mutateLibraryMeta, recordUse, setBookmark } = await import('./store');
    await mutateLibraryMeta((data) => recordUse(data, 'craft', 'color-1'));
    await mutateLibraryMeta((data) => setBookmark(data, 'craft', 'color-1', true));
    const unset = await mutateLibraryMeta((data) => setBookmark(data, 'craft', 'color-1', false));
    expect(unset).toEqual({ kind: 'craft', id: 'color-1', useCount: 1, saved: false });
  });

  it('keeps two kinds with the same id isolated', async () => {
    const { mutateLibraryMeta, recordUse, listLibraryMeta, readLibraryMeta } = await import(
      './store'
    );
    await mutateLibraryMeta((data) => recordUse(data, 'design-system', 'shared-name'));
    await mutateLibraryMeta((data) => recordUse(data, 'skill', 'shared-name'));
    const entries = listLibraryMeta(await readLibraryMeta()).filter((e) => e.id === 'shared-name');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.kind === 'design-system')?.useCount).toBe(1);
    expect(entries.find((e) => e.kind === 'skill')?.useCount).toBe(1);
  });

  it('round-trips a write across a fresh read', async () => {
    const { mutateLibraryMeta, recordUse, readLibraryMeta } = await import('./store');
    await mutateLibraryMeta((data) => recordUse(data, 'design-system', 'reload-check'));
    const reloaded = await readLibraryMeta();
    expect(reloaded.entries['design-system:reload-check']).toEqual({ useCount: 1, saved: false });
  });
});
