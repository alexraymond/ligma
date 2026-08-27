'use client';

/**
 * Thin daemon client for the Studio Terminal tab (OD-135).
 *
 * `/api/pty/**` is registered in `packages/api/src/routes.ts` (`pty`, `ptyId`,
 * `ptyInput`, `ptyStream`); the paths below stay literal for now rather than
 * importing `API_ROUTES`. Everything else follows `studio/api.ts`'s own
 * conventions: `apiFetch`, a `json<T>()` unwrap, relative URLs the web app's
 * own proxy resolves to the daemon.
 */
import { apiFetch } from '@/lib/api-client';

const BASE = '/api/pty';

export interface TerminalSessionRef {
  id: string;
  projectId: string;
}

export interface TerminalFrame {
  event: 'data' | 'exit';
  data: string;
  seq: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Refused (409) for a project with no repoPath — the daemon enforces this, not the UI. */
export async function createTerminal(projectId: string): Promise<TerminalSessionRef> {
  return json<TerminalSessionRef>(
    await apiFetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
      retries: 0,
    }),
  );
}

/** Blocks server-side until the typed line's command finishes — see the daemon route's docblock. */
export async function sendTerminalInput(
  projectId: string,
  id: string,
  data: string,
): Promise<void> {
  await apiFetch(`${BASE}/${encodeURIComponent(id)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, data }),
    retries: 0,
  });
}

/** Kills the pty bridge. Called on Close, and on unmount (`keepalive` survives the tab going away). */
export async function killTerminal(projectId: string, id: string): Promise<void> {
  await apiFetch(`${BASE}/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    retries: 0,
    keepalive: true,
  });
}

export function terminalStreamUrl(projectId: string, id: string): string {
  return `${BASE}/${encodeURIComponent(id)}/stream?projectId=${encodeURIComponent(projectId)}`;
}
