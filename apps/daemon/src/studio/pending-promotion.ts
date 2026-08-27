/**
 * pending-promotion.ts — a promote preview that was generated and never
 * confirmed.
 *
 * The gap this closes: previewing a promotion is the moment a contract becomes
 * one click from being frozen, and until now that click lived only on a sheet
 * the user had to remember to navigate back to. A contract waiting on the human
 * is exactly what the Deck is for (UX spec §6: "contract promotions"), so the
 * preview leaves a record behind and the queue picks it up.
 *
 * Only a *summary* is kept — task count, criteria count, holdout note, spawn
 * estimate. The breakdown itself is re-derived by the sheet, because a stored
 * preview would go stale against a brief the user edited in the meantime, and a
 * Deck card offering a confirm on stale bytes is worse than no card.
 *
 * Central, beside the evidence pins: what is waiting on the reviewer is review
 * material, not repo knowledge.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PendingPromotion, PromotePreview } from '@ligma/api';
import { withFileLock } from '../engine/file-lock';
import { CENTRAL_PROJECTS_DIR } from '../paths';

function safe(id: string): string {
  const base = path.basename(id);
  if (!base || base === '.' || base === '..') throw new Error(`Unsafe id: ${id}`);
  return base;
}

export function pendingPromotionsPath(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, safe(projectId), 'pending-promotions.json');
}

/** The entrance a preview came through — one pending record per entrance. */
export function promotionKey(designId: string | null): string {
  return designId ?? 'brief';
}

interface PendingFile {
  pending?: PendingPromotion[];
  /** Preview nonces already committed — see `claimPromoteNonce`. */
  committed?: string[];
}

function read(projectId: string): PendingFile {
  const file = pendingPromotionsPath(projectId);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as PendingFile;
  } catch {
    // An unreadable record is one missing Deck card, never a broken queue.
    console.error(`[studio/pending-promotion] unreadable ${file}`);
    return {};
  }
}

export function readPendingPromotions(projectId: string): PendingPromotion[] {
  return read(projectId).pending ?? [];
}

function write(projectId: string, file: PendingFile): void {
  const target = pendingPromotionsPath(projectId);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
}

/** How many committed nonces to remember per project. */
const NONCE_HISTORY = 200;

/**
 * Burn a preview's nonce, or report that it was already burned.
 *
 * `true` = this commit is the first for that preview and may proceed. `false` =
 * the same reviewed preview is being committed twice, which lands duplicate
 * tasks and duplicate signed contracts (process audit P5) — the caller answers
 * 409 instead.
 *
 * ponytail: a bounded list beside the pending records, under the same
 * cross-process lock. Upgrade path if promotions ever get frequent enough for
 * 200 to be a real window: key the ledger by day and prune by age.
 */
export function claimPromoteNonce(projectId: string, nonce: string): boolean {
  return withFileLock(`pending-promotions-${safe(projectId)}`, () => {
    const file = read(projectId);
    const committed = file.committed ?? [];
    if (committed.includes(nonce)) return false;
    write(projectId, { ...file, committed: [...committed, nonce].slice(-NONCE_HISTORY) });
    return true;
  });
}

/**
 * Remember that this preview is waiting on a confirm.
 *
 * Returns null — and records nothing — for a preview that failed or proposed no
 * work: there is nothing for the human to confirm, so putting a card in the
 * queue would spend attention on an empty sheet.
 *
 * Previewing the same entrance twice replaces rather than accumulates; the
 * original `createdAt` survives, because what the queue orders by is how long
 * this promotion has been waiting, not when it was last looked at.
 */
export function recordPendingPromotion(preview: PromotePreview): PendingPromotion | null {
  if (preview.error !== null || preview.tasks.length === 0) return null;

  const key = promotionKey(preview.designId);
  return withFileLock(`pending-promotions-${safe(preview.projectId)}`, () => {
    const file = read(preview.projectId);
    const existing = file.pending ?? [];
    const record: PendingPromotion = {
      projectId: preview.projectId,
      key,
      source: preview.source,
      designId: preview.designId,
      taskCount: preview.tasks.length,
      criteriaCount: preview.criteria.length,
      holdoutNote: preview.holdoutNote,
      estimatedSpawns: preview.governor.estimatedSpawns,
      createdAt: existing.find((p) => p.key === key)?.createdAt ?? new Date().toISOString(),
    };
    write(preview.projectId, {
      ...file,
      pending: [...existing.filter((p) => p.key !== key), record],
    });
    return record;
  });
}

/** Forget one entrance's pending promotion — it was confirmed, or cancelled. */
export function clearPendingPromotion(projectId: string, key: string): boolean {
  return withFileLock(`pending-promotions-${safe(projectId)}`, () => {
    const file = read(projectId);
    const existing = file.pending ?? [];
    const next = existing.filter((p) => p.key !== key);
    if (next.length === existing.length) return false;
    write(projectId, { ...file, pending: next });
    return true;
  });
}
