/**
 * Client-side history of export attempts, for the Export diagnostics panel
 * (OD-115).
 *
 * There is no daemon route that records exports (the export route streams
 * bytes and is done — see `designs/_did/export/route.ts`), so this persists
 * to `localStorage` instead, same as the reference's diagnostics export was a
 * local-only affordance. Newest first, capped so the list stays a glance, not
 * a log.
 */

import { generateId } from '@/lib/utils';
import type { ExportFormat } from './api';

const STORAGE_KEY = 'ligma:studio:export-history:v1';
const MAX_ENTRIES = 20;

export interface ExportAttempt {
  id: string;
  format: ExportFormat;
  /** ISO timestamp. */
  at: string;
  ok: boolean;
  /** "OK" on success; an `EXPORTER_*` code or "UNKNOWN" on failure. */
  code: string;
  message: string;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readExportHistory(): ExportAttempt[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExportAttempt[]) : [];
  } catch {
    return [];
  }
}

/** Records one attempt (newest first) and returns the updated, capped history. */
export function recordExportAttempt(attempt: Omit<ExportAttempt, 'id' | 'at'>): ExportAttempt[] {
  const entry: ExportAttempt = {
    ...attempt,
    id: generateId('exp'),
    at: new Date().toISOString(),
  };
  const next = [entry, ...readExportHistory()].slice(0, MAX_ENTRIES);
  if (hasStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or unavailable (private browsing) — the in-memory
      // return value still lets the panel update for this session.
    }
  }
  return next;
}
