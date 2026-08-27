/**
 * Content-addressed snapshots for the version rail.
 *
 * Built on a content-addressed blob store, not on a port of ligma-classic's
 * `snapshots-db.ts` — the studio map's finding #2 is explicit about why. The
 * Electron version rail stored the *full* artifact body per row in SQLite,
 * addressed by a random UUID: no dedupe, no integrity, and a native module the
 * daemon cannot use (build brief §5: no SQLite).
 *
 * Here a snapshot is a list of `{path, fingerprint, byteSize}` and the bodies
 * live once each in `blobs/<sha256>`. Forty versions of a design where one file
 * changed cost one new blob, and a restore is a copy out of the store rather
 * than a mutation of history.
 *
 * SHA-256 and not `@ligma/shared`'s FNV-1a `computeFingerprint`: that one is 8
 * hex chars, designed for error-stack bucketing, and hits a 50% birthday
 * collision around 65K entries. A collision in a content-addressed store is
 * silent data loss, so the wide hash is not optional.
 */

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignFileBody, DesignFileRef } from '@ligma/api';
import { toDesignRelative } from './paths';

/** Blob names are the hex SHA-256 and nothing else. */
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

/** SHA-256 of the body, hex. The blob store key. */
export function contentFingerprint(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function blobPath(blobs: string, fingerprint: string): string {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error(`Invalid fingerprint "${fingerprint}" — expected 64 lowercase hex chars`);
  }
  return path.join(blobs, fingerprint);
}

/**
 * Write a blob unless it is already there. Returns true when it wrote.
 *
 * `wx` does the dedupe for free and atomically: identical bodies collapse to
 * one file, and two concurrent turns writing the same content race harmlessly
 * because the loser's EEXIST means "someone already stored exactly these bytes".
 */
export async function writeBlobIfNew(
  blobs: string,
  fingerprint: string,
  body: string | Buffer,
): Promise<boolean> {
  const file = blobPath(blobs, fingerprint);
  await mkdir(blobs, { recursive: true });
  try {
    const handle = await open(file, 'wx');
    try {
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export async function readBlob(blobs: string, fingerprint: string): Promise<Buffer> {
  return readFile(blobPath(blobs, fingerprint));
}

/**
 * A snapshot's bodies, UTF-8. Shared by the files route (which feeds the Wall)
 * and the export route (which feeds the exporters), so a design exports exactly
 * the bytes it renders.
 *
 * A blob that will not read is skipped rather than fatal: a corrupt store costs
 * one screen, not the whole design.
 */
export async function readSnapshotBodies(
  blobs: string,
  files: DesignFileRef[],
): Promise<DesignFileBody[]> {
  const bodies: DesignFileBody[] = [];
  for (const file of files) {
    try {
      bodies.push({
        path: file.path,
        body: (await readBlob(blobs, file.fingerprint)).toString('utf-8'),
      });
    } catch {}
  }
  return bodies;
}

/** Every file under `root`, recursively, as absolute paths. Sorted for determinism. */
async function walk(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);
    // Symlinks are skipped, never followed: a snapshot must describe the design
    // tree, and following a link would silently pull in bytes from outside it.
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Hash every file in the design source tree and store any body not already in
 * the blob store. Returns the file list that *is* the snapshot.
 */
export async function snapshotSource(source: string, blobs: string): Promise<DesignFileRef[]> {
  const files = await walk(source);
  const refs: DesignFileRef[] = [];
  for (const file of files) {
    const body = await readFile(file);
    const fingerprint = contentFingerprint(body);
    await writeBlobIfNew(blobs, fingerprint, body);
    refs.push({ path: toDesignRelative(source, file), fingerprint, byteSize: body.byteLength });
  }
  return refs;
}

/**
 * Materialise a snapshot back into the source tree.
 *
 * Files present in the tree but not in the snapshot are removed, so a restore
 * is a true "the design looked exactly like this", not a merge. History itself
 * is never touched — the caller appends a new version pointing at this content,
 * which is what keeps the rail append-only.
 */
export async function restoreSnapshot(
  source: string,
  blobs: string,
  files: DesignFileRef[],
): Promise<void> {
  const wanted = new Set(files.map((f) => f.path));
  for (const existing of await walk(source)) {
    if (!wanted.has(toDesignRelative(source, existing))) await rm(existing, { force: true });
  }
  for (const file of files) {
    const target = path.join(source, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readBlob(blobs, file.fingerprint));
  }
}

/** Total bytes a snapshot represents (pre-dedupe — what the user sees). */
export function snapshotBytes(files: DesignFileRef[]): number {
  return files.reduce((sum, f) => sum + f.byteSize, 0);
}

/** True when two snapshots hold identical content, regardless of order. */
export function sameSnapshot(a: DesignFileRef[], b: DesignFileRef[]): boolean {
  if (a.length !== b.length) return false;
  const key = (files: DesignFileRef[]): string =>
    files
      .map((f) => `${f.path}:${f.fingerprint}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}
