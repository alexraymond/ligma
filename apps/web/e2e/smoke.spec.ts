import { expect, test } from '@playwright/test';

/**
 * The nav crawl (codebase audit W3 rewrite — the previous version asserted a
 * retired IA: a flat "Home/Deck/Inbox/Projects/Library/Crew/Settings" rail
 * with a "Section" tab row inside every project space).
 *
 * The current rail (`apps/web/src/components/app-sidebar.tsx`, `lib/nav.ts`)
 * is: the logo mark (home), a "Needs you" link, per-project avatars (no
 * generic "Projects" link), and an icon-only Library/Crew/Settings row. A
 * project space's own nav is `aria-label="Pipeline"` (Brief/Studio/Build/
 * Proof), not "Section" — "Section" now exists only for Home and Settings.
 * `/deck` and `/inbox` are redirect shells into `/needs-you`; the old global
 * `/board`/`/priority-matrix`/`/objectives` are redirect shells into the
 * portfolio's own `?view=` switcher.
 */

test.describe('Smoke tests', () => {
  // A returning user has already dismissed the one-shot onboarding hint —
  // "mc-onboarded" is the literal legacy key `hints.ts` keeps for exactly
  // this (`localStorage.setItem("mc-onboarded", "true")` in a `beforeEach`).
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
  });

  test('homepage loads and shows the app title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ligma/i);
  });

  test("the rail's fixed destinations are reachable by clicking", async ({ page }) => {
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Global navigation' });
    await expect(rail).toBeVisible();

    await rail.getByRole('link', { name: 'Ligma — home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(rail).toBeVisible();

    await rail.getByRole('link', { name: /^Needs you/ }).click();
    await expect(page).toHaveURL(/\/needs-you$/);
    await expect(rail).toBeVisible();

    // Library/Crew/Settings are icon-only, named by aria-label rather than
    // visible text — but they live in the footer housekeeping row
    // (app-sidebar.tsx's `footer` div), a SIBLING of the `<nav aria-label="Global
    // navigation">` block, not a descendant of it. Query the page directly
    // rather than scoping to `rail`; each name is unique on "/" (the other
    // "Library"/"Crew"/"Settings" occurrences on other pages are headings,
    // not links, and aren't rendered here).
    for (const [label, path] of [
      ['Library', '/library'],
      ['Crew', '/crew'],
      ['Settings', '/settings'],
    ] as const) {
      await page.goto('/');
      await page.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator('body')).toBeVisible();
      await expect(rail).toBeVisible();
    }
  });

  test("Home's section tabs reach Runs, Activity and Capture", async ({ page }) => {
    await page.goto('/');
    const section = page.getByRole('navigation', { name: 'Section' });
    await expect(section).toBeVisible();

    for (const [tab, path] of [
      ['Runs', '/runs'],
      ['Activity', '/activity'],
      ['Capture', '/brain-dump'],
    ] as const) {
      await page.goto('/');
      await section.getByRole('link', { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test("Settings' section tabs reach Checkpoints and back", async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('navigation', { name: 'Section' });
    await section.getByRole('link', { name: 'Checkpoints', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/checkpoints$/);
    await section.getByRole('link', { name: 'Daemon', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('a project space keeps the global rail and offers its Pipeline stages', async ({ page }) => {
    const response = await page.request.get('/api/projects');
    expect(response.ok()).toBeTruthy();
    const { data, projects } = await response.json();
    const list = data ?? projects ?? [];
    test.skip(list.length === 0, 'no projects in the workspace to open');

    await page.goto(`/projects/${list[0].id}`);
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();

    // Build and Proof always render for every project shape (quiet when
    // empty); Brief/Studio are conditional on shape, so only these two are a
    // safe universal assertion.
    const pipeline = page.getByRole('navigation', { name: 'Pipeline' });
    await expect(pipeline).toBeVisible();
    for (const stage of ['Build', 'Proof']) {
      // Not `exact: true` — pipeline-strip.tsx concatenates the stage's
      // StatusChip text into the link's accessible name (e.g. "Build no
      // tasks", "Proof not proven"), so only a substring match holds.
      await pipeline.getByRole('link', { name: stage }).click();
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
      await expect(pipeline).toBeVisible();
    }
  });

  test('old URLs redirect into the current IA rather than 404ing', async ({ page }) => {
    const redirects: [string, RegExp][] = [
      ['/decisions', /\/needs-you$/], // /decisions -> /deck -> /needs-you
      ['/deck', /\/needs-you$/],
      ['/inbox', /\/needs-you$/],
      ['/status-board', /\/projects\?view=tasks$/],
      ['/priority-matrix', /\/projects\?view=tasks$/],
      ['/board', /\/projects\?view=tasks$/],
      ['/board/matrix', /\/projects\?view=tasks$/],
      ['/objectives', /\/projects\?view=goals$/],
      ['/launch', /\/runs$/],
      ['/checkpoints', /\/settings\/checkpoints$/],
      ['/skills', /\/library$/],
    ];
    for (const [oldUrl, newUrl] of redirects) {
      await page.goto(oldUrl);
      await expect(page).toHaveURL(newUrl);
    }
  });

  test('the needs-you tray renders with its Running/Activity tabs', async ({ page }) => {
    await page.goto('/needs-you');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Needs you', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Running', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeVisible();
  });

  test("the portfolio's view switcher reaches Projects, Goals and Tasks", async ({ page }) => {
    await page.goto('/projects');
    for (const view of ['Projects', 'Goals', 'Tasks']) {
      await page.getByRole('tab', { name: view, exact: true }).click();
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('API health check — tasks endpoint', async ({ request }) => {
    const response = await request.get('/api/tasks');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('tasks');
  });
});
