import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * `workspace.json` round-trips through `mutateWorkspace`/`readWorkspace`, and
 * a hostile project id is rejected before it ever reaches the filesystem —
 * the same `assertSafeId` guard `studio/paths.ts` uses for design ids.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-workspace-store-'));
  process.env.LIGMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('readWorkspace / mutateWorkspace', () => {
  it('a project that has never touched its workspace gets the empty shape', async () => {
    const { readWorkspace } = await import('./store');
    expect(await readWorkspace('proj_new')).toEqual({ references: [], designFiles: [], notes: [] });
  });

  it('round-trips a write across a fresh read (survives a reload)', async () => {
    const { mutateWorkspace, readWorkspace } = await import('./store');

    await mutateWorkspace('proj_a', (data) => {
      data.notes.push({ id: 'note_1', body: 'hello', createdAt: '2026-01-01T00:00:00.000Z' });
    });

    const reloaded = await readWorkspace('proj_a');
    expect(reloaded.notes).toEqual([
      { id: 'note_1', body: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it("keeps two projects' workspaces isolated", async () => {
    const { mutateWorkspace, readWorkspace } = await import('./store');

    await mutateWorkspace('proj_a', (data) => {
      data.references.push({
        id: 'ref_1',
        kind: 'link',
        url: 'https://example.com',
        title: 'Example',
        domain: 'example.com',
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    expect((await readWorkspace('proj_b')).references).toEqual([]);
    expect((await readWorkspace('proj_a')).references).toHaveLength(1);
  });

  it('rejects a project id that would escape the central store', async () => {
    const { readWorkspace } = await import('./store');
    await expect(readWorkspace('../../etc')).rejects.toThrow(/Invalid projectId/);
  });
});
