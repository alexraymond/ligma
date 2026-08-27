/**
 * `workspace.json` — one file per project holding everything the fixed
 * References / Design Files / Notes pipeline-strip slots need (OD-048/137/
 * 134/138).
 *
 * Layout (mirrors `studio/paths.ts`'s "central, not in-repo" rule — these are
 * product artifacts, not knowledge that travels with the code):
 *
 *   data/projects/<projectId>/workspace.json
 *
 * ponytail: designs.json's sibling store uses a per-design directory with a
 * content-addressed `blobs/` dir because a design accumulates many versioned
 * snapshots that are worth deduping. A reference board and an uploaded-files
 * list hold a handful of images each, so this stores screenshots and design
 * files as inline `data:` URIs in the one JSON file instead — no blob dir, no
 * content addressing. Upgrade to a blob store if a project's workspace.json
 * ever grows large enough to matter.
 *
 * Writes go through a per-project mutex and land via write-then-rename, same
 * discipline as `store/data.ts` and `studio/store.ts`.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { CENTRAL_PROJECTS_DIR } from '../../paths';
import { generateId } from '../../store/ids';
import { assertSafeId } from '../../studio/paths';

export interface ReferenceLink {
  id: string;
  kind: 'link';
  url: string;
  /** Server-scraped `<title>` at add-time, falling back to the hostname. */
  title: string;
  domain: string;
  note: string;
  createdAt: string;
}

export interface ReferenceScreenshot {
  id: string;
  kind: 'screenshot';
  /** `data:image/<type>;base64,...` — rendered inline, never re-fetched. */
  dataUrl: string;
  mime: string;
  note: string;
  createdAt: string;
}

export type ReferenceItem = ReferenceLink | ReferenceScreenshot;

export interface DesignFileItem {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  /** Decoded byte size, not the base64 string length. */
  size: number;
  createdAt: string;
}

export interface NoteMessage {
  id: string;
  body: string;
  createdAt: string;
}

export interface WorkspaceFile {
  references: ReferenceItem[];
  designFiles: DesignFileItem[];
  notes: NoteMessage[];
}

function emptyWorkspace(): WorkspaceFile {
  return { references: [], designFiles: [], notes: [] };
}

function workspacePath(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, assertSafeId('projectId', projectId), 'workspace.json');
}

const locks = new Map<string, Mutex>();

function lockFor(projectId: string): Mutex {
  let mutex = locks.get(projectId);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(projectId, mutex);
  }
  return mutex;
}

/** A project that has never touched its workspace gets the empty shape, not an error. */
export async function readWorkspace(projectId: string): Promise<WorkspaceFile> {
  try {
    return JSON.parse(await readFile(workspacePath(projectId), 'utf-8')) as WorkspaceFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkspace();
    throw new Error(
      `Workspace store for ${projectId} is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function writeWorkspace(projectId: string, data: WorkspaceFile): Promise<void> {
  const file = workspacePath(projectId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, file);
}

/** Read-modify-write under the project's mutex. `fn` mutates `data` in place. */
export async function mutateWorkspace<T>(
  projectId: string,
  fn: (data: WorkspaceFile) => T,
): Promise<T> {
  return lockFor(projectId).runExclusive(async () => {
    const data = await readWorkspace(projectId);
    const result = fn(data);
    await writeWorkspace(projectId, data);
    return result;
  });
}

export function newWorkspaceId(prefix: string): string {
  return generateId(prefix);
}
