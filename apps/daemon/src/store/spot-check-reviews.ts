/**
 * spot-check-reviews.ts — server-side memory for the verdict spot-check card.
 *
 * The card asks the human to audit the judge on a 1-in-10 sample. Its answer
 * used to live in one browser's `localStorage` (the old note in
 * `routes/deck/route.ts` said so plainly): unanswerable from the CLI or an
 * agent, resurrected in every other client, and still on the Deck after the
 * task it named had been wiped (process audit P9). D4's "everything answerable
 * from Deck cards alone" held only inside one browser profile.
 *
 * A flat list under DATA_DIR, written under the same cross-process
 * `withFileLock` the other out-of-store records use, via temp-file + rename so
 * a crash mid-write cannot truncate it. Append-only in practice: a review is a
 * statement someone made, and re-answering the same run replaces that one entry
 * rather than accumulating.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SpotCheckAnswer, SpotCheckReview } from '@ligma/api';
import { withFileLock } from '../engine/file-lock';
import { DATA_DIR } from '../paths';

const LOCK = 'spot-check-reviews';

export function spotCheckReviewsPath(): string {
  return path.join(DATA_DIR, 'spot-check-reviews.json');
}

export function readSpotCheckReviews(): SpotCheckReview[] {
  const file = spotCheckReviewsPath();
  if (!existsSync(file)) return [];
  try {
    return (
      (JSON.parse(readFileSync(file, 'utf-8')) as { reviews?: SpotCheckReview[] }).reviews ?? []
    );
  } catch {
    // An unreadable ledger means the Deck re-asks a question already answered —
    // annoying, never wrong. It must not take the Deck route down with it.
    console.error(`[store/spot-check-reviews] unreadable ${file}`);
    return [];
  }
}

/** Run ids already reviewed — what the Deck filters its sampled cards against. */
export function reviewedRunIds(): Set<string> {
  return new Set(readSpotCheckReviews().map((r) => r.runId));
}

/** Record one answer. Re-answering the same run replaces the earlier review. */
export function recordSpotCheckReview(input: {
  taskId: string | null;
  runId: string;
  answer: SpotCheckAnswer;
}): SpotCheckReview {
  const review: SpotCheckReview = { ...input, reviewedAt: new Date().toISOString() };
  return withFileLock(LOCK, () => {
    const reviews = [...readSpotCheckReviews().filter((r) => r.runId !== input.runId), review];
    const file = spotCheckReviewsPath();
    const tmp = `${file}.${process.pid}.tmp`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify({ reviews }, null, 2)}\n`, 'utf-8');
    renameSync(tmp, file);
    return review;
  });
}
