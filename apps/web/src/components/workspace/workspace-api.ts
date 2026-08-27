'use client';

/**
 * Thin daemon client for the References / Design Files / Notes panels
 * (OD-048, OD-137, OD-134, OD-138).
 *
 * `/api/references/**` is registered in `packages/api/src/routes.ts`
 * (`references`, `referencesRef`, `referencesDesignFiles`,
 * `referencesDesignFile`, `referencesNotes`); the paths below stay literal
 * for now, same situation `studio/terminal-api.ts` documents for
 * `/api/pty/**`. Everything else follows that file's own conventions:
 * `apiFetch`, a `json<T>()` unwrap, relative URLs the web app's proxy
 * resolves to the daemon.
 */
import { apiFetch } from '@/lib/api-client';

const BASE = '/api/references';

export interface ReferenceLink {
  id: string;
  kind: 'link';
  url: string;
  title: string;
  domain: string;
  note: string;
  createdAt: string;
}

export interface ReferenceScreenshot {
  id: string;
  kind: 'screenshot';
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
  size: number;
  createdAt: string;
}

export interface NoteMessage {
  id: string;
  body: string;
  createdAt: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function post(path: string, body: unknown) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    retries: 0,
  });
}

// ─── References ────────────────────────────────────────────────────────────

export async function listReferences(projectId: string): Promise<ReferenceItem[]> {
  const { references } = await json<{ references: ReferenceItem[] }>(
    await apiFetch(`${BASE}/${projectId}`),
  );
  return references;
}

export async function addLinkReference(
  projectId: string,
  url: string,
  note = '',
): Promise<ReferenceItem[]> {
  const { references } = await json<{ references: ReferenceItem[] }>(
    await post(`${BASE}/${projectId}`, { kind: 'link', url, note }),
  );
  return references;
}

export async function addScreenshotReference(
  projectId: string,
  dataUrl: string,
  note = '',
): Promise<ReferenceItem[]> {
  const { references } = await json<{ references: ReferenceItem[] }>(
    await post(`${BASE}/${projectId}`, { kind: 'screenshot', dataUrl, note }),
  );
  return references;
}

export async function deleteReference(projectId: string, refId: string): Promise<void> {
  await json(
    await apiFetch(`${BASE}/${projectId}/${encodeURIComponent(refId)}`, {
      method: 'DELETE',
      retries: 0,
    }),
  );
}

// ─── Design files (OD-138) — same store, a second view ─────────────────────

export async function listDesignFiles(projectId: string): Promise<DesignFileItem[]> {
  const { designFiles } = await json<{ designFiles: DesignFileItem[] }>(
    await apiFetch(`${BASE}/${projectId}/design-files`),
  );
  return designFiles;
}

export async function uploadDesignFile(
  projectId: string,
  name: string,
  dataUrl: string,
): Promise<DesignFileItem[]> {
  const { designFiles } = await json<{ designFiles: DesignFileItem[] }>(
    await post(`${BASE}/${projectId}/design-files`, { name, dataUrl }),
  );
  return designFiles;
}

export async function deleteDesignFile(projectId: string, fileId: string): Promise<void> {
  await json(
    await apiFetch(`${BASE}/${projectId}/design-files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      retries: 0,
    }),
  );
}

// ─── Notes (OD-134 v1 — see notes-panel.tsx's docblock) ─────────────────────

export async function listNotes(projectId: string): Promise<NoteMessage[]> {
  const { notes } = await json<{ notes: NoteMessage[] }>(
    await apiFetch(`${BASE}/${projectId}/notes`),
  );
  return notes;
}

export async function addNote(projectId: string, body: string): Promise<NoteMessage[]> {
  const { notes } = await json<{ notes: NoteMessage[] }>(
    await post(`${BASE}/${projectId}/notes`, { body }),
  );
  return notes;
}
