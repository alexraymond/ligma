/**
 * The needs-you tray's classification and threshold logic (UX-REBUILD-BRIEF
 * §Phase 1, UX-REDESIGN §10/§16 "Tray v2").
 *
 * The tray replaces the Deck and the Inbox as the one interrupt surface.
 * Everything in it is either **blocking** (an agent or a project is halted on
 * a human answer) or **FYI** (worth a glance, nothing is halted). This module
 * decides which bucket each item falls in, whether the page shows a
 * card-by-card focus deck or a grouped list, and what counts as "new since
 * you were last here" — all pure and DOM-free so it is testable without a
 * page around it (same convention as `components/onboarding/hints.ts`).
 */
import type { DeckCard, DeckCardKind } from '@/hooks/use-deck-sources';
import type { InboxMessage } from '@ligma/api';

/** The id of the synthetic item inserted when the daemon can't be reached. */
export const MACHINE_UNREACHABLE_ID = 'machine-unreachable';

/**
 * A decision, an approval, a frozen-but-unconfirmed contract, and an adoption
 * review are all halting something right now. A stale brief and a spot-check
 * are calibration — worth answering, halting nothing. A run-blocked card is
 * also halting: the task it names is still waiting to be built (process audit
 * P13) — it just has no answer to give, only a link to the run.
 */
const BLOCKING_KINDS: ReadonlySet<DeckCardKind> = new Set([
  'decision',
  'design-approval',
  'promote-pending',
  'adoption-review',
  'run-blocked',
]);

const FYI_KINDS: ReadonlySet<DeckCardKind> = new Set(['stale-brief', 'verdict-spot-check']);

/** Built from a `DeckCard`, an inbox message, or the synthetic machine item — never a fourth shape. */
export type TrayItem =
  | { kind: 'card'; card: DeckCard }
  | { kind: 'inbox'; message: InboxMessage }
  | { kind: 'machine'; id: typeof MACHINE_UNREACHABLE_ID };

export function trayItemId(item: TrayItem): string {
  switch (item.kind) {
    case 'card':
      return item.card.id;
    case 'inbox':
      return `inbox:${item.message.id}`;
    case 'machine':
      return item.id;
  }
}

/** Null for the machine item — it has no age, and `splitByLastSeen` treats that as "earlier". */
export function trayItemCreatedAt(item: TrayItem): string | null {
  switch (item.kind) {
    case 'card':
      return item.card.createdAt;
    case 'inbox':
      return item.message.createdAt;
    case 'machine':
      return null;
  }
}

/**
 * Sorts the raw sources into blocking vs. FYI. A card of a kind this module
 * does not recognise (there are none today, but `DeckCardKind` is someone
 * else's union) is dropped rather than guessed into a bucket — silence over a
 * wrong urgency.
 */
export function classifyTray(
  cards: readonly DeckCard[],
  inboxMessages: readonly InboxMessage[],
  machineUnreachable: boolean,
): { blocking: TrayItem[]; fyi: TrayItem[] } {
  const blocking: TrayItem[] = [];
  const fyi: TrayItem[] = [];

  for (const card of cards) {
    if (BLOCKING_KINDS.has(card.kind)) blocking.push({ kind: 'card', card });
    else if (FYI_KINDS.has(card.kind)) fyi.push({ kind: 'card', card });
  }

  if (machineUnreachable) {
    blocking.push({ kind: 'machine', id: MACHINE_UNREACHABLE_ID });
  }

  // Read/archived messages already got their look — a tray that keeps
  // surfacing them is the same defect as a decision that never leaves the deck.
  for (const message of inboxMessages) {
    if (message.status === 'unread') fyi.push({ kind: 'inbox', message });
  }

  return { blocking, fyi };
}

/** Hardcoded, not a preference (UX-REDESIGN §16) — the tray has one opinion about when a list beats a stack. */
export const FOCUS_THRESHOLD = 8;

export type TrayMode = 'focus' | 'list';

/**
 * Below the threshold, one card at a time is faster than scanning a list.
 * At or above it, a list you can select-all across is faster than swiping
 * through eight-plus cards one at a time.
 */
export function trayMode(blocking: readonly TrayItem[], fyi: readonly TrayItem[]): TrayMode {
  return blocking.length + fyi.length < FOCUS_THRESHOLD ? 'focus' : 'list';
}

/**
 * The "since you were last here" divider. An absent or unparseable
 * `lastSeenAt` disables the divider honestly — everything renders as
 * "earlier" rather than guessing a boundary that was never recorded.
 */
export function splitByLastSeen(
  items: readonly TrayItem[],
  lastSeenAt: string | null,
): { fresh: TrayItem[]; earlier: TrayItem[] } {
  const lastSeenMs = lastSeenAt === null ? Number.NaN : Date.parse(lastSeenAt);
  if (lastSeenAt === null || Number.isNaN(lastSeenMs)) {
    return { fresh: [], earlier: [...items] };
  }

  const fresh: TrayItem[] = [];
  const earlier: TrayItem[] = [];
  for (const item of items) {
    const createdAt = trayItemCreatedAt(item);
    const createdMs = createdAt === null ? Number.NaN : Date.parse(createdAt);
    if (createdAt !== null && Number.isFinite(createdMs) && createdMs > lastSeenMs)
      fresh.push(item);
    else earlier.push(item);
  }
  return { fresh, earlier };
}

// ─── Project attribution — "which project is this about?" ───────────────────

/** Items with no project — an unlinked decision, an adoption run with no project yet — land here (UX-REDESIGN §10 tray v2). */
export const WORKSPACE_GROUP = 'Workspace';

/**
 * A card carries its project directly. An inbox message carries a task, which
 * carries the project — resolving that is the caller's job (this module has
 * no task collection of its own), so it's passed in as a lookup. The machine
 * item belongs to no project.
 */
export function trayItemProjectId(
  item: TrayItem,
  projectIdForTask: (taskId: string) => string | null,
): string | null {
  switch (item.kind) {
    case 'card':
      return item.card.projectId;
    case 'inbox':
      return item.message.taskId ? projectIdForTask(item.message.taskId) : null;
    case 'machine':
      return null;
  }
}

/**
 * Groups items under their resolved project name so the tray shows "which
 * project is this about?" instead of interleaving cards from everywhere under
 * one thin header (UX bug: multi-project cards with no visible attribution).
 * Named projects sort alphabetically; `WORKSPACE_GROUP` always sorts last.
 */
export function groupByProject<T>(
  items: readonly T[],
  projectIdOf: (item: T) => string | null,
  projectName: (id: string | null) => string,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = projectName(projectIdOf(item));
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === WORKSPACE_GROUP) return 1;
    if (b === WORKSPACE_GROUP) return -1;
    return a.localeCompare(b);
  });
}

// ─── Last-seen storage (hints.ts style — DOM-free, testable) ─────────────────

export interface TrayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LAST_SEEN_KEY = 'ligma-needs-you-last-seen';

export function readLastSeen(storage: TrayStorage): string | null {
  return storage.getItem(LAST_SEEN_KEY);
}

export function markSeen(storage: TrayStorage, isoNow: string): void {
  storage.setItem(LAST_SEEN_KEY, isoNow);
}
