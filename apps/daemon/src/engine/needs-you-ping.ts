/**
 * "Needs you" 24h ping — a local desktop notification the first (and only)
 * time a blocking tray item has sat unattended past 24h (UX-REBUILD-BRIEF
 * §Phase 1). One ping per item id, ever: a human who dismisses a notification
 * without acting must not be re-paged for the same card every hour after.
 *
 * Composition reuses the daemon's own `GET /api/deck` handler in-process —
 * the same pattern the deck route already uses for its own sibling routes
 * (see routes/deck/route.ts's `getDesignFiles`/`getVerificationRunsList`
 * imports) — rather than re-deriving "what's blocking" from the underlying
 * stores a second time. That handler takes no request and returns the same
 * `{ cards }` the tray and rail badge already agree on, so this module never
 * has its own opinion on which sources count.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { notifyDesktop } from '../notify';
import { DATA_DIR } from '../paths';
import { GET as getDeck } from '../routes/deck/route';
import { logger } from './logger';

/** Blocking kinds only (UX-REBUID-BRIEF §Phase 1 tray sections). FYI kinds —
 * stale-brief, verdict-spot-check, and inbox (not a deck card kind at all) —
 * deliberately never ping. */
const BLOCKING_KINDS = new Set([
  'decision',
  'design-approval',
  'promote-pending',
  'adoption-review',
]);

export const DEFAULT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const PINGS_FILE = path.join(DATA_DIR, 'needs-you-pings.json');

interface DeckCardLike {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
}

/**
 * Pure decision: which of `cards` are blocking, overdue past `thresholdMs`,
 * and not already pinged. A card whose `createdAt` doesn't parse never pings
 * — absent evidence of age is not evidence of staleness.
 */
export function overdueBlockingItems(
  cards: DeckCardLike[],
  pinged: Set<string>,
  now: number,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  for (const card of cards) {
    if (!BLOCKING_KINDS.has(card.kind)) continue;
    if (pinged.has(card.id)) continue;
    const createdAt = Date.parse(card.createdAt);
    if (Number.isNaN(createdAt)) continue;
    if (now - createdAt < thresholdMs) continue;
    out.push({ id: card.id, title: card.title });
  }
  return out;
}

/** Read defensively: missing or corrupt → nobody has been pinged yet. */
export function readPinged(): Set<string> {
  if (!existsSync(PINGS_FILE)) return new Set();
  try {
    const data = JSON.parse(readFileSync(PINGS_FILE, 'utf-8')) as { pinged?: string[] };
    return new Set(data.pinged ?? []);
  } catch {
    logger.warn('needs-you-ping', `Unreadable ${PINGS_FILE} — treating as empty`);
    return new Set();
  }
}

/** Exported for the persistence roundtrip test; the runner is the only other caller. */
export function writePinged(pinged: Set<string>): void {
  writeFileSync(PINGS_FILE, JSON.stringify({ pinged: Array.from(pinged) }, null, 2), 'utf-8');
}

/**
 * Batching call: >3 overdue items at once fire one rollup notification
 * instead of a burst of individual ones (oldest-first age is what's actually
 * actionable at that point, not which specific card is oldest).
 */
function notifyOverdue(
  items: Array<{ id: string; title: string }>,
  ageMs: (id: string) => number,
  notify: (title: string, message: string) => void,
): void {
  const hoursOf = (id: string) => Math.floor(ageMs(id) / (60 * 60 * 1000));
  if (items.length > 3) {
    const oldestH = Math.max(...items.map((i) => hoursOf(i.id)));
    notify('Needs you', `${items.length} items need you, oldest ${oldestH}h`);
    return;
  }
  for (const item of items) {
    notify('Needs you', `"${item.title}" has waited ${hoursOf(item.id)}h`);
  }
}

/**
 * Composes the blocking deck, notifies once per newly-overdue item, and
 * persists the ping so it never fires twice for the same id. Never throws —
 * a failed check is a missed ping, not a broken poll loop.
 */
export async function checkAndPingOverdue(
  now: number = Date.now(),
  notify: (title: string, message: string) => void = notifyDesktop,
): Promise<void> {
  try {
    const res = await getDeck();
    const { cards } = (await res.json()) as { cards: DeckCardLike[] };
    const pinged = readPinged();
    const overdue = overdueBlockingItems(cards, pinged, now);
    if (overdue.length === 0) return;

    const createdAtById = new Map(cards.map((c) => [c.id, Date.parse(c.createdAt)]));
    notifyOverdue(overdue, (id) => now - (createdAtById.get(id) ?? now), notify);

    for (const item of overdue) pinged.add(item.id);
    writePinged(pinged);
  } catch (err) {
    logger.error(
      'needs-you-ping',
      `Check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
let lastCheck = 0;

/** Throttled entry point for the poll loop: runs at most once per hour. */
export function maybeCheckAndPingOverdue(now: number = Date.now()): void {
  if (now - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = now;
  void checkAndPingOverdue(now);
}
