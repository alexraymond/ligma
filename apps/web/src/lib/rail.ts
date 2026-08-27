/**
 * The project rail's memory and its pure derivations (UX-REDESIGN §3 Zone 1,
 * §16 "Scale by tiers"; CONTRACTS-phase3 "Rail storage").
 *
 * DOM-free with `Storage`-shaped parameters, for the same reason as
 * `components/onboarding/hints.ts`: the node-environment vitest suite covers
 * the MRU rule and the ring derivation without a browser. The component reads
 * `window.localStorage` and hands it in.
 */

import { studioVisible } from '@/components/studio/api';
import type { Project } from '@ligma/api';

export interface RailStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_PROJECTS_KEY = 'ligma-recent-projects';
export const LAST_PROJECT_KEY = 'ligma-last-project';

/** Past this many avatars the rail overflows into a "+N" chip (spec §16). */
export const RAIL_CAP = 8;

/** Most-recently-visited first, capped. Absent, unreadable or non-array storage all read as "no memory yet". */
export function readRecentProjects(storage: RailStorage): string[] {
  try {
    const raw = storage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .slice(0, RAIL_CAP);
  } catch {
    return [];
  }
}

/**
 * Move a project to the front of the MRU and remember it as the last one open.
 *
 * One write path for both keys: `readLastProject` is what Home's door reads, and
 * a "last project" that disagreed with the head of the MRU would send the door
 * somewhere the rail does not show. Returns the new list so a caller that just
 * recorded a visit does not have to read it back.
 */
export function recordProjectVisit(storage: RailStorage, id: string): string[] {
  if (!id) return readRecentProjects(storage);
  const next = [id, ...readRecentProjects(storage).filter((existing) => existing !== id)].slice(
    0,
    RAIL_CAP,
  );
  try {
    storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
    storage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Private mode / quota — the rail simply forgets, which is not a failure
    // worth interrupting a navigation for.
  }
  return next;
}

export function readLastProject(storage: RailStorage): string | null {
  try {
    const id = storage.getItem(LAST_PROJECT_KEY);
    return id ? id : null;
  } catch {
    return null;
  }
}

/** `window.localStorage`, or null on the server / when the browser refuses it. */
export function browserRailStorage(): RailStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ─── Ring state ──────────────────────────────────────────────────────────────

/**
 * What an avatar's ring says. Four states, no synonyms — and every one of them
 * exists as a word (`RING_WORD`) in the tooltip and in ⌘K, because a ring the
 * user can only decode by colour is not a status (spec §16, "every ring state
 * exists as a word somewhere reachable").
 */
export type RailRingState = 'running' | 'needs-you' | 'quiet' | 'no-signal';

export interface RailSignals {
  /** Projects with a run in flight — `useActiveRuns().runningProjectIds`. */
  runningProjectIds: ReadonlySet<string>;
  /** Blocking Deck cards per project — `needsYouByProject` via the deck queue. */
  blockingByProject: ReadonlyMap<string, number>;
  /** False when the daemon poll is failing: nothing it reported can be trusted. */
  reachable: boolean;
}

/**
 * Precedence mirrors the heartbeat's (`components/machine/heartbeat.tsx`): an
 * unreachable daemon overshadows everything, because "running" and "quiet" are
 * both claims about a machine this app currently cannot see. Below that, a
 * blocking item outranks a run — the human is the bottleneck, not the agent.
 */
export function railRingState(projectId: string, signals: RailSignals): RailRingState {
  if (!signals.reachable) return 'no-signal';
  if ((signals.blockingByProject.get(projectId) ?? 0) > 0) return 'needs-you';
  if (signals.runningProjectIds.has(projectId)) return 'running';
  return 'quiet';
}

export const RING_WORD: Record<RailRingState, string> = {
  running: 'running',
  'needs-you': 'needs you',
  quiet: 'quiet',
  'no-signal': 'no signal',
};

/** The tooltip line, and the same line ⌘K shows beside a project. */
export function railTooltip(name: string, state: RailRingState): string {
  return `${name} — ${RING_WORD[state]}`;
}

// ─── Order and overflow ──────────────────────────────────────────────────────

export interface RailOrder {
  /** The avatars that render, in order: pinned first, then most-recently-visited. */
  visible: Project[];
  /** How many eligible projects did not fit — the "+N" chip, 0 when none. */
  overflow: number;
}

/**
 * Pinned first, then recents, then whatever is left (spec §16 "Scale by
 * tiers"). The tail matters: a fresh browser has no MRU, and a rail with no
 * avatars beside a workspace full of projects would read as "you have none".
 */
export function railOrder(
  projects: Project[],
  recentIds: string[],
  cap: number = RAIL_CAP,
): RailOrder {
  const eligible = projects.filter((p) => p.status !== 'archived' && !p.deletedAt);
  const byId = new Map(eligible.map((p) => [p.id, p]));

  const ordered: Project[] = [];
  const taken = new Set<string>();
  const take = (project: Project | undefined) => {
    if (!project || taken.has(project.id)) return;
    taken.add(project.id);
    ordered.push(project);
  };

  for (const project of eligible) if (project.pinned) take(project);
  for (const id of recentIds) take(byId.get(id));
  for (const project of eligible) take(project);

  return { visible: ordered.slice(0, cap), overflow: Math.max(0, ordered.length - cap) };
}

// ─── Default stage ───────────────────────────────────────────────────────────

/**
 * Which stage an avatar (or ⌘K's "Open <name>") lands on, per
 * CONTRACTS-phase3 "Fixed shapes": Studio when the project is design-shaped and
 * has no tasks yet, Build once it has tasks, Brief otherwise. `studioVisible`
 * is the one predicate for "has a face" — never compared inline here.
 */
export function defaultStageSegment(
  designShaped: boolean,
  hasTasks: boolean,
): 'board' | 'studio' | 'brief' {
  if (hasTasks) return 'board';
  if (designShaped) return 'studio';
  return 'brief';
}

export function defaultStagePath(
  project: Pick<Project, 'id' | 'shape'>,
  hasTasks: boolean,
): string {
  return `/projects/${encodeURIComponent(project.id)}/${defaultStageSegment(studioVisible(project.shape), hasTasks)}`;
}

/** The stage bar's four stages, for ⌘K's "name stage" matches. Same routes as the contract. */
export const STAGES: { key: string; label: string; segment: string }[] = [
  { key: 'brief', label: 'Brief', segment: 'brief' },
  { key: 'studio', label: 'Studio', segment: 'studio' },
  { key: 'build', label: 'Build', segment: 'board' },
  { key: 'proof', label: 'Proof', segment: 'verify' },
];

/** The stages a project actually has — Studio only when it is design-shaped. */
export function stagesFor(project: Pick<Project, 'shape'>): typeof STAGES {
  return STAGES.filter((stage) => stage.key !== 'studio' || studioVisible(project.shape));
}
