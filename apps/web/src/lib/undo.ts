/**
 * The take-back window — one call path, one clock.
 *
 * Every deck disposition goes through `PATCH /api/decisions`, and only that
 * endpoint writes the server's undo journal. The journal is the authority on how
 * long an answer stays undoable, and it says so in `undoExpiresAt`. The UI must
 * therefore *read* that deadline rather than compute one: a countdown built from
 * `answeredAt + <a constant>` and the browser's own clock drifts against the
 * server (the d4 run showed "Undo · 26s" and "Undo · 87s" beside copy promising
 * ten seconds) and then offers a button the server will refuse.
 *
 * Pure and fetch-injectable so the derivation is testable without a DOM.
 */

import { apiFetch } from '@/lib/api-client';
import type { DeckAction } from '@ligma/api';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What the deck endpoint answers with. `undoExpiresAt` is absent on undo itself. */
interface DeckPatchBody {
  error?: string;
  undoExpiresAt?: string;
}

/**
 * The server's deadline as epoch ms, or null when it opened no window.
 *
 * Null is not "assume ten seconds": an answer with no server window cannot be
 * taken back, and offering the button anyway is the lie this replaces.
 */
export function parseUndoExpiry(body: unknown): number | null {
  const raw = (body as DeckPatchBody | null)?.undoExpiresAt;
  if (typeof raw !== 'string') return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/** Whole seconds left on the window; 0 once it has closed or was never opened. */
export function undoSecondsLeft(expiresAt: number | null, now: number = Date.now()): number {
  if (expiresAt === null) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** Whether the take-back is still on offer. */
export function isUndoLive(expiresAt: number | null, now: number = Date.now()): boolean {
  return expiresAt !== null && expiresAt > now;
}

/**
 * Apply a disposition. Returns the server's undo deadline so the caller can
 * count down the real window instead of inventing one.
 *
 * Throws with the server's own wording — a rejected disposition must never be
 * reported as a generic failure, because "no longer pending" and "network down"
 * ask the human for different things.
 */
export async function patchDecision(
  body: { id: string; action: DeckAction | 'undo'; answer?: string },
  fetcher: Fetcher = apiFetch,
): Promise<{ undoExpiresAt: number | null }> {
  const res = await fetcher('/api/decisions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as DeckPatchBody | null;
  if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
  return { undoExpiresAt: parseUndoExpiry(payload) };
}

/**
 * Take an answer back. Idempotent from the caller's side: a second undo of the
 * same decision is a no-op rather than an error, because the human clicking
 * twice meant it once.
 */
export async function undoDecision(id: string, fetcher: Fetcher = apiFetch): Promise<void> {
  try {
    await patchDecision({ id, action: 'undo' }, fetcher);
  } catch (err) {
    if (err instanceof Error && /nothing to undo/i.test(err.message)) return;
    throw err;
  }
}
