import { isProjectSpace, railKeyFor, recordHref, sectionTabsFor } from '@/lib/nav';
/**
 * The route map is the seam rule in code: if a surface has no rail section, it
 * is an orphan. These checks fail the moment one appears.
 */
import { describe, expect, it } from 'vitest';

const SURFACES: [string, ReturnType<typeof railKeyFor>][] = [
  ['/', 'home'],
  // Phase 3: Objectives, the global Board and the matrix retired into the
  // portfolio's views; their old URLs are redirect shells that stay mapped to
  // Projects so the rail never flickers inactive on the way through.
  ['/objectives', 'projects'],
  ['/runs', 'home'],
  ['/activity', 'home'],
  // Phase 1: Deck and Inbox folded into the /needs-you tray; their old URLs
  // are redirect shells that stay mapped so the rail never flickers inactive.
  ['/needs-you', 'needs-you'],
  ['/deck', 'needs-you'],
  ['/inbox', 'needs-you'],
  ['/brain-dump', 'home'],
  ['/projects', 'projects'],
  ['/projects/proj_1', 'projects'],
  ['/projects/proj_1/verify', 'projects'],
  ['/projects/proj_1/brief', 'projects'],
  ['/projects/proj_1/knowledge', 'projects'],
  ['/adoption/arun_1', 'projects'],
  ['/board', 'projects'],
  ['/board/matrix', 'projects'],
  ['/verification/vrun_1', 'projects'],
  ['/library', 'library'],
  ['/library/skill_1', 'library'],
  ['/crew', 'crew'],
  ['/crew/new', 'crew'],
  ['/team/developer', 'crew'],
  ['/settings', 'settings'],
  ['/settings/checkpoints', 'settings'],
];

describe('railKeyFor', () => {
  it('gives every routable surface a rail home', () => {
    for (const [pathname, key] of SURFACES) {
      expect([pathname, railKeyFor(pathname)]).toEqual([pathname, key]);
    }
  });

  it('matches whole segments, so /boarding-pass is not the Board', () => {
    expect(railKeyFor('/boarding-pass')).toBeNull();
  });

  it('keeps Home to the root exactly', () => {
    expect(railKeyFor('/')).toBe('home');
    expect(railKeyFor('/nope')).toBeNull();
  });
});

describe('sectionTabsFor', () => {
  it('offers every sibling surface from any tab in the section', () => {
    const hrefs = sectionTabsFor('/runs').map((t) => t.href);
    expect(hrefs).toEqual(['/', '/runs', '/activity', '/brain-dump']);
  });

  it('stands down inside a project space, which brings its own stage bar', () => {
    expect(isProjectSpace('/projects/proj_1')).toBe(true);
    expect(isProjectSpace('/projects')).toBe(false);
    expect(sectionTabsFor('/projects/proj_1/board')).toEqual([]);
  });

  // The portfolio is one surface with its own view switcher (?view=), so a tab
  // row above it would be a second navigation for the same page.
  it('gives the portfolio no tab row of its own', () => {
    expect(sectionTabsFor('/projects')).toEqual([]);
  });

  it('points every tab at a route inside its own section', () => {
    for (const [pathname] of SURFACES) {
      const key = railKeyFor(pathname);
      for (const tab of sectionTabsFor(pathname)) {
        expect([tab.href, railKeyFor(tab.href)]).toEqual([tab.href, key]);
      }
    }
  });
});

// D7 DC-3 (MC-150, MC-152, OD-166): search used to router.push the containing
// list — /board for a task, /projects for a project — so the user had to find
// the record again. Both surfaces route through recordHref now.
describe('recordHref', () => {
  // Phase 3 retargets two of the three: the global Board and Objectives retired
  // into the portfolio, which owns the cross-project task table and the goals
  // view. The record still opens, just inside its new home.
  it('opens the record, not its list', () => {
    expect(recordHref('task', 'task_1')).toBe('/projects?view=tasks&task=task_1');
    expect(recordHref('project', 'proj_1')).toBe('/projects/proj_1');
    expect(recordHref('goal', 'goal_1')).toBe('/projects?view=goals&goal=goal_1');
  });

  it('keeps every target inside the section that owns it', () => {
    for (const kind of ['task', 'project', 'goal', 'braindump'] as const) {
      const href = recordHref(kind, 'id_1');
      expect([kind, railKeyFor(href.split('?')[0])]).not.toContain(null);
    }
  });

  it('escapes ids so a crafted id cannot smuggle a second query param', () => {
    expect(recordHref('task', 'a&b=c')).toBe('/projects?view=tasks&task=a%26b%3Dc');
    expect(recordHref('project', '../settings')).toBe('/projects/..%2Fsettings');
  });

  it('leaves brain-dump entries on the capture list — their only surface', () => {
    expect(recordHref('braindump', 'bd_1')).toBe('/brain-dump');
  });
});
