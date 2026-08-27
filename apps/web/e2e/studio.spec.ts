import { type Page, expect, test } from '@playwright/test';

/**
 * The Studio surface (codebase audit W3 rewrite). Four things this spec
 * exists to hold:
 *
 *  1. The Studio renders for a project whose shape carries a design stage, and
 *     is **absent** — not stubbed, not disabled — for one that does not.
 *  2. The Studio workspace owns the whole viewport (spec
 *     2026-08-26-studio-fullscreen-workspace-design, `lib/nav.ts`'s
 *     `isStudioRoute`): the global rail and command bar **stand down** for
 *     it — the previous version of this spec asserted the opposite (that the
 *     rail stays visible), which was true before the full-screen redesign
 *     and false after it.
 *  3. The critique lane is visible by default, with no setting that reveals it
 *     (seamlessness principle 2: "nothing load-bearing hides in Settings").
 *  4. The Promote-to-build affordance is present, and honest about needing an
 *     approved design first — the oracle must be frozen before it compiles.
 *
 * Generation itself is not driven here: the daemon's studio provider stub is an
 * in-process seam (`setStudioProvider`), not reachable over HTTP, and an e2e run
 * must never spawn a real agent. So this asserts the surface and its
 * affordances; the compiled-instruction preview, the throttled render and the
 * rail's selection maths are covered by the unit suites next to their code.
 */

interface ProjectRow {
  id: string;
  name: string;
  shape?: 'ui' | 'headless' | 'mixed';
}

async function projects(page: Page): Promise<ProjectRow[]> {
  const response = await page.request.get('/api/projects');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return (body.data ?? body.projects ?? []) as ProjectRow[];
}

test.describe('Studio', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
  });

  test('owns the whole viewport — no global rail, no command bar', async ({ page }) => {
    const list = await projects(page);
    const uiProject = list.find((p) => p.shape === 'ui' || p.shape === 'mixed');
    test.skip(uiProject === undefined, 'no ui/mixed-shape project in the workspace');

    await page.goto(`/projects/${uiProject!.id}/studio`);

    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toHaveCount(0);
    // The command bar's quick-capture input is gone too — only the invisible
    // ⌘K / shortcut-sheet listeners survive the full-screen swap.
    await expect(page.getByPlaceholder('Brain dump — capture anything')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Wall' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Focus' })).toBeVisible();
    await expect(page.getByLabel('Prompt')).toBeVisible();
  });

  test('the critique lane is visible by default, not behind a setting', async ({ page }) => {
    const list = await projects(page);
    const uiProject = list.find((p) => p.shape === 'ui' || p.shape === 'mixed');
    test.skip(uiProject === undefined, 'no ui/mixed-shape project in the workspace');

    await page.goto(`/projects/${uiProject!.id}/studio`);

    const lane = page.getByRole('region', { name: 'Critique' });
    await expect(lane).toBeVisible();
    // Expanded on arrival: the theater is the point, hiding it was the defect.
    await expect(lane.getByRole('button', { name: 'Critique' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('promote is offered, and refuses to run before the design is approved', async ({ page }) => {
    const list = await projects(page);
    const uiProject = list.find((p) => p.shape === 'ui' || p.shape === 'mixed');
    test.skip(uiProject === undefined, 'no ui/mixed-shape project in the workspace');

    await page.goto(`/projects/${uiProject!.id}/studio`);

    await expect(page.getByRole('button', { name: /Approve/ })).toBeVisible();
    const promote = page.getByRole('button', { name: 'Promote to build' });
    await expect(promote).toBeVisible();
    // An unapproved design cannot be promoted — the oracle must freeze first.
    await expect(promote).toBeDisabled();
  });

  test('is absent for a project with no design stage', async ({ page }) => {
    const list = await projects(page);
    const headless = list.find((p) => p.shape !== 'ui' && p.shape !== 'mixed');
    test.skip(headless === undefined, 'every project in the workspace has a design stage');

    await page.goto(`/projects/${headless!.id}/studio`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wall' })).toHaveCount(0);
  });
});
