/**
 * The IA in one place (UX spec §4): seven rail sections, and every route mapped
 * to exactly one of them. Both the rail's active state and the per-section tab
 * row read from here, so a new route cannot quietly become an orphan — it either
 * belongs to a section or it doesn't render a home.
 */

export type RailKey = 'home' | 'needs-you' | 'projects' | 'library' | 'crew' | 'settings';

export interface SectionTab {
  href: string;
  label: string;
}

/** Route prefixes owned by each section. Longest match wins. */
const SECTION_ROUTES: Record<RailKey, string[]> = {
  home: ['/', '/runs', '/activity', '/brain-dump'],
  // /deck and /inbox are redirect shells into the tray — mapped so the rail
  // stays highlighted for the instant they're on screen.
  'needs-you': ['/needs-you', '/deck', '/inbox'],
  // Verification reports are project evidence, and an adoption review sheet is a
  // project being born — both live under Projects rather than growing a rail
  // entry of their own. Phase 3: /objectives and /board (matrix included) are
  // redirect shells into the portfolio's own views, mapped here for the same
  // no-flicker reason as /deck and /inbox.
  projects: ['/projects', '/objectives', '/board', '/verification', '/adoption'],
  library: ['/library'],
  crew: ['/crew', '/team'],
  settings: ['/settings'],
};

/** The secondary nav for each section. Empty = the section is a single surface. */
const SECTION_TABS: Record<RailKey, SectionTab[]> = {
  // Home is the no-project state and a door (spec §3 Zone 3): with projects it
  // redirects into the last one. Runs and Activity are still real pages, so
  // they keep a tab; Objectives lost its because it is the portfolio now.
  home: [
    { href: '/', label: 'Overview' },
    { href: '/runs', label: 'Runs' },
    { href: '/activity', label: 'Activity' },
    { href: '/brain-dump', label: 'Capture' },
  ],
  // The tray carries its own internal tabs (Needs you · Running · Activity).
  'needs-you': [],
  // One portfolio surface with its own view switcher (?view=projects|goals|tasks)
  // — a tab row above it would be a second navigation for the same page.
  projects: [],
  library: [],
  crew: [],
  settings: [
    { href: '/settings', label: 'Daemon' },
    { href: '/settings/checkpoints', label: 'Checkpoints' },
  ],
};

function matches(pathname: string, prefix: string): boolean {
  return prefix === '/'
    ? pathname === '/'
    : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function railKeyFor(pathname: string): RailKey | null {
  let best: { key: RailKey; length: number } | null = null;
  for (const [key, prefixes] of Object.entries(SECTION_ROUTES) as [RailKey, string[]][]) {
    for (const prefix of prefixes) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { key, length: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}

/**
 * A project space carries its own pipeline strip and tabs, so the Projects
 * section tabs stand down inside it rather than stacking two nav rows.
 */
export function isProjectSpace(pathname: string): boolean {
  return /^\/projects\/[^/]+/.test(pathname);
}

/**
 * The Studio workspace owns the whole viewport (spec
 * `2026-08-26-studio-fullscreen-workspace-design`): the global rail *and* the
 * project header/stage bar stand down for it. One predicate, read by both
 * layouts — two copies of this regex is exactly how one of them ends up
 * suppressing chrome the other still renders.
 */
export function isStudioRoute(pathname: string): boolean {
  return /^\/projects\/[^/]+\/studio(\/|$)/.test(pathname);
}

export function sectionTabsFor(pathname: string): SectionTab[] {
  if (isProjectSpace(pathname)) return [];
  const key = railKeyFor(pathname);
  return key ? SECTION_TABS[key] : [];
}

/** Record kinds the search surfaces can resolve to a URL. */
export type RecordKind = 'task' | 'project' | 'goal' | 'braindump';

/**
 * Where a search hit opens (D7 DC-3). Search must land on the *record* — the
 * task panel, the project space, the objective — not on the list that contains
 * it, which is what the parent did and what ligma regressed to. Brain-dump
 * entries are the one honest exception: the capture list is their only surface.
 */
export function recordHref(kind: RecordKind, id: string): string {
  switch (kind) {
    // Phase 3: the global Board and Objectives retired *into* the portfolio
    // (spec §16 "Scale by tiers"), so a task opens the cross-project task table
    // with its panel up, and a goal the goals view focused on it.
    case 'task':
      return `/projects?view=tasks&task=${encodeURIComponent(id)}`;
    case 'project':
      return `/projects/${encodeURIComponent(id)}`;
    case 'goal':
      return `/projects?view=goals&goal=${encodeURIComponent(id)}`;
    case 'braindump':
      return '/brain-dump';
  }
}
