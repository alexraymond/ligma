/**
 * Content-addressed snapshots and the version rail.
 *
 * Two properties carry the whole feature: identical content stores one blob
 * (otherwise a 40-version design pays 40× for a file nobody touched), and a
 * restore appends rather than rewrites (otherwise the rail is an undo button
 * with extra steps, and the state you restored away from is gone).
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// A throwaway data dir, set before anything resolves `src/paths` — the suite
// used to write real project directories under the repo's own data/projects/
// and rely on an afterAll to take them away again, which a failing run skips.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-studio-snap-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  contentFingerprint,
  restoreSnapshot,
  sameSnapshot,
  snapshotBytes,
  snapshotSource,
  writeBlobIfNew,
} = await import('../src/studio/snapshots');
const { blobsDir, designDir, sourceDir } = await import('../src/studio/paths');
const { createDesign, latestVersion, readManifest, recordVersion, restoreVersion } = await import(
  '../src/studio/store'
);
const { CENTRAL_PROJECTS_DIR } = await import('../src/paths');

const projectId = 'test_studio_snap';

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function write(
  design: { projectId: string; id: string },
  file: string,
  body: string,
): Promise<void> {
  const target = path.join(sourceDir(design.projectId, design.id), file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, 'utf-8');
}

describe('content addressing', () => {
  it('is SHA-256 of the body, so two spellings of the same bytes collide by design', () => {
    const fingerprint = contentFingerprint('<h1>hello</h1>');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(contentFingerprint(Buffer.from('<h1>hello</h1>'))).toBe(fingerprint);
  });

  it('writes a blob once and reports the repeat as a no-op', async () => {
    const blobs = path.join(CENTRAL_PROJECTS_DIR, projectId, 'blob-test');
    const fingerprint = contentFingerprint('body');
    expect(await writeBlobIfNew(blobs, fingerprint, 'body')).toBe(true);
    expect(await writeBlobIfNew(blobs, fingerprint, 'body')).toBe(false);
    expect(await readdir(blobs)).toEqual([fingerprint]);
  });

  it('refuses a fingerprint that is not 64 hex chars — a blob name is a path segment', async () => {
    const blobs = path.join(CENTRAL_PROJECTS_DIR, projectId, 'blob-test');
    await expect(writeBlobIfNew(blobs, '../escape', 'x')).rejects.toThrow(/Invalid fingerprint/);
  });
});

describe('snapshotSource', () => {
  it('dedupes identical bodies across files into one blob', async () => {
    const design = await createDesign({
      projectId,
      title: 'dedupe',
      prompt: 'p',
      designSystem: null,
    });
    await write(design, 'a.html', 'SAME');
    await write(design, 'nested/b.html', 'SAME');
    await write(design, 'c.html', 'DIFFERENT');

    const files = await snapshotSource(
      sourceDir(projectId, design.id),
      blobsDir(projectId, design.id),
    );
    expect(files.map((f) => f.path).sort()).toEqual(['a.html', 'c.html', 'nested/b.html']);
    // Three files, two distinct bodies, two blobs.
    expect(new Set(files.map((f) => f.fingerprint)).size).toBe(2);
    expect((await readdir(blobsDir(projectId, design.id))).length).toBe(2);
    expect(snapshotBytes(files)).toBe(4 + 4 + 9);
  });

  it('reports paths POSIX-style regardless of platform separators', async () => {
    const design = await createDesign({
      projectId,
      title: 'posix',
      prompt: 'p',
      designSystem: null,
    });
    await write(design, path.join('deep', 'nest', 'x.html'), 'X');
    const files = await snapshotSource(
      sourceDir(projectId, design.id),
      blobsDir(projectId, design.id),
    );
    expect(files[0]?.path).toBe('deep/nest/x.html');
  });
});

describe('restoreSnapshot', () => {
  it('removes files the snapshot never had, so a restore is a state and not a merge', async () => {
    const design = await createDesign({
      projectId,
      title: 'restore',
      prompt: 'p',
      designSystem: null,
    });
    const source = sourceDir(projectId, design.id);
    const blobs = blobsDir(projectId, design.id);

    await write(design, 'keep.html', 'V1');
    const v1 = await snapshotSource(source, blobs);

    await write(design, 'keep.html', 'V2');
    await write(design, 'added-later.html', 'NEW');
    await snapshotSource(source, blobs);

    await restoreSnapshot(source, blobs, v1);
    expect(await readFile(path.join(source, 'keep.html'), 'utf-8')).toBe('V1');
    expect(await readdir(source)).toEqual(['keep.html']);
  });
});

describe('the version rail', () => {
  it('appends a version per changed turn and skips one that changed nothing', async () => {
    const design = await createDesign({
      projectId,
      title: 'rail',
      prompt: 'p',
      designSystem: null,
    });
    const manifest = (await readManifest(projectId, design.id))!;

    await write(design, 'index.html', 'one');
    expect(await recordVersion(manifest, 'prompt', 'first')).not.toBeNull();
    expect(manifest.versions).toHaveLength(1);

    // Same bytes: a turn that produced nothing must not grow the rail.
    expect(await recordVersion(manifest, 'prompt', 'no-op')).toBeNull();
    expect(manifest.versions).toHaveLength(1);

    await write(design, 'index.html', 'two');
    const v2 = await recordVersion(manifest, 'prompt', 'second');
    expect(v2?.n).toBe(2);
    expect(manifest.versions).toHaveLength(2);
  });

  it('restores by appending a new version that points at the old content', async () => {
    const design = await createDesign({
      projectId,
      title: 'restore-rail',
      prompt: 'p',
      designSystem: null,
    });
    const manifest = (await readManifest(projectId, design.id))!;

    await write(design, 'index.html', 'V1');
    const v1 = (await recordVersion(manifest, 'prompt', 'v1'))!;
    await write(design, 'index.html', 'V2');
    await recordVersion(manifest, 'prompt', 'v2');

    const restored = await restoreVersion(manifest, v1.id);

    // History kept: v1 and v2 are both still on the rail, plus the restore.
    expect(manifest.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(restored.origin).toBe('restore');
    expect(restored.restoredFrom).toBe(v1.id);
    expect(sameSnapshot(restored.files, v1.files)).toBe(true);
    expect(latestVersion(manifest)?.id).toBe(restored.id);
    // And the working tree really is back at V1.
    expect(await readFile(path.join(sourceDir(projectId, design.id), 'index.html'), 'utf-8')).toBe(
      'V1',
    );
  });

  it('keeps design.json and the blob store outside the agent-writable tree', async () => {
    const design = await createDesign({
      projectId,
      title: 'layout',
      prompt: 'p',
      designSystem: null,
    });
    const entries = await readdir(designDir(projectId, design.id));
    expect(entries.sort()).toEqual(['blobs', 'design.json', 'src']);
    // The tools' root is `src/` — neither the manifest nor the blobs are under it.
    expect(sourceDir(projectId, design.id).endsWith(path.join(design.id, 'src'))).toBe(true);
  });
});
