/**
 * `data/library-meta.json` — per-catalog-entry use counts and bookmarks for
 * the Library (OD-156/157).
 *
 * One flat file, one mutex, write-then-rename — the same discipline
 * `store/data.ts` and `references/store.ts` use. Not per-project: a use count
 * or a bookmark is a property of the catalog entry itself, not of any one
 * project, so there is exactly one of these for the whole checkout.
 *
 * ponytail: entries keyed by a `${kind}:${id}` string, not a nested
 * `Record<kind, Record<id, …>>` — one map, one lookup, and the three kinds
 * never collide on id (`design-system:mono` vs `skill:mono` are different
 * strings). Upgrade to nesting only if a kind ever needs a bulk operation
 * ("clear all bookmarks for craft") that a flat map makes annoying.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryCatalogKind, LibraryMetaEntry } from '@ligma/api';
import { Mutex } from 'async-mutex';
import { DATA_DIR } from '../../paths';

interface StoredMeta {
  useCount: number;
  saved: boolean;
}

interface LibraryMetaFile {
  entries: Record<string, StoredMeta>;
}

function emptyFile(): LibraryMetaFile {
  return { entries: {} };
}

function metaFilePath(): string {
  return path.join(DATA_DIR, 'library-meta.json');
}

function keyOf(kind: LibraryCatalogKind, id: string): string {
  return `${kind}:${id}`;
}

function toEntry(key: string, stored: StoredMeta): LibraryMetaEntry {
  const sep = key.indexOf(':');
  return {
    kind: key.slice(0, sep) as LibraryCatalogKind,
    id: key.slice(sep + 1),
    useCount: stored.useCount,
    saved: stored.saved,
  };
}

const mutex = new Mutex();

/** A checkout that has never touched the store gets the empty shape, not an error. */
export async function readLibraryMeta(): Promise<LibraryMetaFile> {
  try {
    return JSON.parse(await readFile(metaFilePath(), 'utf-8')) as LibraryMetaFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw new Error(
      `Library-meta store is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function writeLibraryMeta(data: LibraryMetaFile): Promise<void> {
  const file = metaFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, file);
}

/** Read-modify-write under the store's mutex. `fn` mutates `data` in place. */
export async function mutateLibraryMeta<T>(fn: (data: LibraryMetaFile) => T): Promise<T> {
  return mutex.runExclusive(async () => {
    const data = await readLibraryMeta();
    const result = fn(data);
    await writeLibraryMeta(data);
    return result;
  });
}

/** Every entry that has ever been used or bookmarked — nothing implies a default row. */
export function listLibraryMeta(data: LibraryMetaFile): LibraryMetaEntry[] {
  return Object.entries(data.entries).map(([key, stored]) => toEntry(key, stored));
}

/** Bumps the use count for one entry, creating its row on first use. */
export function recordUse(
  data: LibraryMetaFile,
  kind: LibraryCatalogKind,
  id: string,
): LibraryMetaEntry {
  const key = keyOf(kind, id);
  const stored = data.entries[key] ?? { useCount: 0, saved: false };
  stored.useCount += 1;
  data.entries[key] = stored;
  return toEntry(key, stored);
}

/** Sets the bookmark for one entry, creating its row on first bookmark. */
export function setBookmark(
  data: LibraryMetaFile,
  kind: LibraryCatalogKind,
  id: string,
  saved: boolean,
): LibraryMetaEntry {
  const key = keyOf(kind, id);
  const stored = data.entries[key] ?? { useCount: 0, saved: false };
  stored.saved = saved;
  data.entries[key] = stored;
  return toEntry(key, stored);
}
