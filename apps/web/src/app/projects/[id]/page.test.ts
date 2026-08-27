// The project Overview page retired into a default-stage redirect
// (CONTRACTS-phase3): Studio when design-shaped with nothing built yet,
// Build once there are tasks, Brief otherwise. `defaultStagePath` is the pure
// rule; the fs check below pins that the page actually calls it and redirects
// (`router.replace`) rather than rendering the old health-board/goals content
// inline again. No jsdom in this vitest config (node environment only), so
// wiring is checked by reading the page source, same pattern as the sibling
// board-helpers.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultStagePath } from './default-stage';

describe('defaultStagePath', () => {
  it('goes to Studio when design-shaped with no tasks yet', () => {
    expect(defaultStagePath('proj_1', { designShaped: true, taskCount: 0 })).toBe(
      '/projects/proj_1/studio',
    );
  });

  it('goes to Build once the project has tasks, even if design-shaped', () => {
    expect(defaultStagePath('proj_1', { designShaped: true, taskCount: 3 })).toBe(
      '/projects/proj_1/board',
    );
  });

  it('goes to Build for a non-design-shaped project with tasks', () => {
    expect(defaultStagePath('proj_1', { designShaped: false, taskCount: 1 })).toBe(
      '/projects/proj_1/board',
    );
  });

  it('falls back to Brief for a headless project with nothing yet', () => {
    expect(defaultStagePath('proj_1', { designShaped: false, taskCount: 0 })).toBe(
      '/projects/proj_1/brief',
    );
  });
});

describe('project overview page — wiring', () => {
  const SOURCE = readFileSync(path.resolve(__dirname, './page.tsx'), 'utf-8');

  it('redirects via router.replace and the exported defaultStagePath, not a reimplementation', () => {
    expect(SOURCE).toContain('router.replace');
    expect(SOURCE).toContain('defaultStagePath(');
  });

  it('does not re-home the retired Overview content (health board moved to Proof per L2)', () => {
    expect(SOURCE).not.toContain('ProjectHealthBoard');
    expect(SOURCE).not.toContain('ProjectQuickActions');
  });
});
