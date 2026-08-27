/**
 * `design.json` — read, mutate, snapshot.
 *
 * JSON files stay the source of truth (merger spec, governing principle 2), so
 * the manifest *is* the design session: reload the daemon and the rail, the
 * staged pins, the tweak values and the critique are all still there because
 * they were never anywhere else.
 *
 * Writes go through a per-design mutex and land via write-then-rename, the same
 * discipline `store/data.ts` uses for the core stores. A design is only ever
 * touched by this process, so an in-process mutex is enough — no cross-process
 * file lock is warranted here, and claiming one would imply a sharing model
 * that does not exist.
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import type {
  DesignFileRef,
  DesignManifest,
  DesignSnapshotSummary,
  DesignStatus,
  DesignSummary,
  DesignVersion,
  DesignVersionOrigin,
} from '@ligma/api';
import { Mutex } from 'async-mutex';
import { mutateActivityLog } from '../store/data';
import { generateId } from '../store/ids';
import { blobsDir, designDir, designsDir, manifestPath, sourceDir } from './paths';
import { restoreSnapshot, snapshotBytes, snapshotSource } from './snapshots';

const locks = new Map<string, Mutex>();

function lockFor(projectId: string, designId: string): Mutex {
  const key = `${projectId}/${designId}`;
  let mutex = locks.get(key);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(key, mutex);
  }
  return mutex;
}

async function writeManifest(
  projectId: string,
  designId: string,
  manifest: DesignManifest,
): Promise<void> {
  const file = manifestPath(projectId, designId);
  const tmp = `${file}.tmp`;
  await mkdir(designDir(projectId, designId), { recursive: true });
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  await rename(tmp, file);
}

/** Null when the design does not exist. A corrupt manifest throws — loudly. */
export async function readManifest(
  projectId: string,
  designId: string,
): Promise<DesignManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath(projectId, designId), 'utf-8')) as DesignManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `Design ${designId} has an unreadable manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Read-modify-write under the design's mutex. Returns whatever `fn` returns. */
export async function mutateManifest<T>(
  projectId: string,
  designId: string,
  fn: (manifest: DesignManifest) => Promise<T> | T,
): Promise<T> {
  return lockFor(projectId, designId).runExclusive(async () => {
    const manifest = await readManifest(projectId, designId);
    if (!manifest) throw new Error(`Design not found: ${designId}`);
    const result = await fn(manifest);
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(projectId, designId, manifest);
    return result;
  });
}

export interface CreateDesignInput {
  projectId: string;
  title: string;
  prompt: string;
  designSystem: string | null;
}

export async function createDesign(input: CreateDesignInput): Promise<DesignManifest> {
  const designId = generateId('dsn');
  const now = new Date().toISOString();
  await mkdir(sourceDir(input.projectId, designId), { recursive: true });
  await mkdir(blobsDir(input.projectId, designId), { recursive: true });

  const manifest: DesignManifest = {
    id: designId,
    projectId: input.projectId,
    title: input.title,
    status: 'drafting',
    createdAt: now,
    updatedAt: now,
    designSystem: input.designSystem,
    sourcePrompt: input.prompt,
    versions: [],
    pins: [],
    tweaks: null,
    tweakValues: {},
    critique: null,
    approvedAt: null,
    promotedContractId: null,
  };
  await writeManifest(input.projectId, designId, manifest);
  return manifest;
}

export async function listDesigns(projectId: string): Promise<DesignManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(designsDir(projectId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: DesignManifest[] = [];
  for (const id of entries.sort()) {
    const manifest = await readManifest(projectId, id).catch(() => null);
    if (manifest) out.push(manifest);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Versions ────────────────────────────────────────────────────────────────

export function latestVersion(manifest: DesignManifest): DesignVersion | null {
  return manifest.versions.length > 0
    ? (manifest.versions[manifest.versions.length - 1] ?? null)
    : null;
}

export function findVersion(manifest: DesignManifest, versionId: string): DesignVersion | null {
  return manifest.versions.find((v) => v.id === versionId) ?? null;
}

/**
 * Snapshot the current source tree and append it to the rail.
 *
 * Returns null when the content is byte-identical to the previous version: a
 * turn that changed nothing should not grow the rail, or the version list turns
 * into a log of attempts rather than a history of states.
 */
export async function recordVersion(
  manifest: DesignManifest,
  origin: DesignVersionOrigin,
  label: string,
  restoredFrom: string | null = null,
): Promise<DesignVersion | null> {
  const files = await snapshotSource(
    sourceDir(manifest.projectId, manifest.id),
    blobsDir(manifest.projectId, manifest.id),
  );
  if (files.length === 0) return null;

  const previous = latestVersion(manifest);
  if (previous && restoredFrom === null && sameFiles(previous.files, files)) return null;

  const version: DesignVersion = {
    id: generateId('dv'),
    n: (previous?.n ?? 0) + 1,
    createdAt: new Date().toISOString(),
    origin,
    label,
    files,
    restoredFrom,
  };
  return appendVersion(manifest, version);
}

/**
 * Push a version onto the rail and record the turn on the activity timeline.
 *
 * The two are one operation on purpose. There are two places a version is ever
 * appended (a generated turn and a restore), and a timeline that only knew about
 * one of them would show a design history with holes in it. Anything that adds a
 * third append site gets the event for free by calling this.
 *
 * Both callers reach here only AFTER their own "did anything actually change?"
 * checks, so this never logs a turn that produced no new state.
 */
async function appendVersion(
  manifest: DesignManifest,
  version: DesignVersion,
): Promise<DesignVersion> {
  manifest.versions.push(version);
  await mutateActivityLog(async (log) => {
    log.events.push({
      id: generateId('evt'),
      type: 'design_turn',
      actor: 'system',
      taskId: null,
      projectId: manifest.projectId,
      summary: `Design v${version.n} (${version.origin}): ${version.label}`,
      details: `design:${manifest.id} version:${version.id}, ${version.files.length} file(s)`,
      timestamp: version.createdAt,
    });
  });
  return version;
}

function sameFiles(a: DesignFileRef[], b: DesignFileRef[]): boolean {
  if (a.length !== b.length) return false;
  const key = (files: DesignFileRef[]): string =>
    files
      .map((f) => `${f.path}:${f.fingerprint}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}

/**
 * Restore an earlier version.
 *
 * History is append-only: this materialises the old content and records a NEW
 * version pointing at it. The rail keeps every state the design was ever in,
 * including the one you restored away from — which is the difference between a
 * version rail and an undo button.
 */
export async function restoreVersion(
  manifest: DesignManifest,
  versionId: string,
): Promise<DesignVersion> {
  const target = findVersion(manifest, versionId);
  if (!target) throw new Error(`Version not found: ${versionId}`);

  await restoreSnapshot(
    sourceDir(manifest.projectId, manifest.id),
    blobsDir(manifest.projectId, manifest.id),
    target.files,
  );

  const version: DesignVersion = {
    id: generateId('dv'),
    n: (latestVersion(manifest)?.n ?? 0) + 1,
    createdAt: new Date().toISOString(),
    origin: 'restore',
    label: `restored v${target.n}`,
    files: target.files,
    restoredFrom: target.id,
  };
  return appendVersion(manifest, version);
}

// ─── API views ───────────────────────────────────────────────────────────────

export function toSnapshotSummary(version: DesignVersion): DesignSnapshotSummary {
  return {
    versionId: version.id,
    n: version.n,
    createdAt: version.createdAt,
    origin: version.origin,
    label: version.label,
    fileCount: version.files.length,
    totalBytes: snapshotBytes(version.files),
    restoredFrom: version.restoredFrom,
  };
}

export function toSummary(manifest: DesignManifest): DesignSummary {
  return {
    id: manifest.id,
    projectId: manifest.projectId,
    title: manifest.title,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    designSystem: manifest.designSystem,
    versionCount: manifest.versions.length,
    files: latestVersion(manifest)?.files ?? [],
    // Only a `scored` critique has a score. An errored one contributes null,
    // never a number — a malfunction must not read as a bad design.
    critiqueScore: manifest.critique?.status === 'scored' ? manifest.critique.score : null,
    pendingPinCount: manifest.pins.filter((p) => p.status === 'pending').length,
  };
}

/** Status transitions the daemon performs. Kept in one place so the SSE agrees. */
export function setStatus(manifest: DesignManifest, status: DesignStatus): void {
  manifest.status = status;
  if (status === 'approved') manifest.approvedAt = new Date().toISOString();
}
