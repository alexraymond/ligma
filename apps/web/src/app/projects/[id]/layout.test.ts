/**
 * Pins the wiring for the single stage bar (CONTRACTS-phase3, UX-REDESIGN §11
 * "one header row"): the project layout must render the four fixed stages via
 * `PipelineStrip`/`projectStages`, must not resurrect the old sibling
 * `TabRow`, and must record the visit for the rail (`lib/rail.ts`, Agent K).
 * No jsdom in this vitest config (node environment only), so this reads the
 * layout source with fs rather than rendering it — same pattern as the
 * sibling board-helpers.test.ts wiring proof.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isStudioRoute } from '@/lib/nav';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './layout.tsx'), 'utf-8');
const SHELL = readFileSync(
  path.resolve(__dirname, '../../../components/layout-shell.tsx'),
  'utf-8',
);

describe('project layout — stage bar wiring', () => {
  it('renders the stage bar via PipelineStrip/projectStages', () => {
    expect(SOURCE).toContain('PipelineStrip');
    expect(SOURCE).toContain('projectStages(');
  });

  it('does not render the old sibling TabRow — the bar is the only nav now', () => {
    expect(SOURCE).not.toContain('TabRow');
    expect(SOURCE).not.toContain('section-tabs');
  });

  it('records the visit for the rail', () => {
    expect(SOURCE).toContain('recordProjectVisit(');
  });

  it('keeps the header row: dot, name, status, Talk, Run', () => {
    expect(SOURCE).toContain('TalkLauncher');
    expect(SOURCE).toContain('RunButton');
    expect(SOURCE).toContain('project.status');
  });
});

/**
 * The Studio workspace's shell escape hatch (spec
 * 2026-08-26-studio-fullscreen-workspace-design). One predicate, two layouts —
 * a second copy is how the rail and the header end up disagreeing about
 * whether Studio is full-screen.
 */
describe('isStudioRoute', () => {
  it('matches the studio stage of any project, with or without a trailing path', () => {
    expect(isStudioRoute('/projects/proj_ligma/studio')).toBe(true);
    expect(isStudioRoute('/projects/proj_ligma/studio/')).toBe(true);
    expect(isStudioRoute('/projects/p1/studio/anything')).toBe(true);
  });

  it('does not match the other stages, the portfolio, or a lookalike segment', () => {
    expect(isStudioRoute('/projects/proj_ligma/board')).toBe(false);
    expect(isStudioRoute('/projects/proj_ligma')).toBe(false);
    expect(isStudioRoute('/projects')).toBe(false);
    expect(isStudioRoute('/projects/proj_ligma/studious')).toBe(false);
    expect(isStudioRoute('/studio')).toBe(false);
  });
});

describe('studio full-screen — both layouts stand down', () => {
  it('the project layout suppresses its chrome before the not-found branch', () => {
    expect(SOURCE).toContain('isStudioRoute(pathname)');
    // Before the not-found render (not the effect's early `return`), so a
    // studio route never flashes a breadcrumb while the project list loads.
    expect(SOURCE.indexOf('isStudioRoute(pathname)')).toBeLessThan(
      SOURCE.indexOf('if (!project) {'),
    );
  });

  it('the global shell suppresses the rail and command bar, keeping the providers', () => {
    expect(SHELL).toContain('isStudioRoute(pathname)');
    const branch = SHELL.slice(
      SHELL.indexOf('if (isStudioRoute(pathname))'),
      SHELL.indexOf('<div className="min-h-screen'),
    );
    expect(branch).not.toContain('AppSidebar');
    expect(branch).not.toContain('CommandBar');
    expect(branch).not.toContain('SectionTabs');
    expect(branch).toContain('ActiveRunsProvider');
    expect(branch).toContain('TooltipProvider');
  });
});
