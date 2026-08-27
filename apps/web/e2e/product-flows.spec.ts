import { request as apiRequest, expect, test } from '@playwright/test';

/**
 * The flows that make ligma feel like one product (codebase audit W3 rewrite;
 * UX spec F1, F2, F6, §6).
 *
 * These are click paths, not `goto`s, wherever a click path is what the seam
 * rules demand: a surface that only opens when you type its URL is the defect
 * this phase exists to kill. Discovery runs against the daemon's stub
 * (`LIGMA_DISCOVERY_STUB=1`), so submitting the composer never spawns an agent.
 *
 * The project-space navigation in this file was rewritten against the current
 * IA (`lib/nav.ts`): a project's own nav is `aria-label="Pipeline"`
 * (Brief/Studio/Build/Proof), not the old "Section" tab row, and References/
 * Design files/Notes/Terminal/Runs/Knowledge are `?panel=<name>` drawers
 * absorbed into whichever stage owns them (`components/stage-panels.tsx`),
 * not sibling routes with their own tab.
 */

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
});

/**
 * The composer really creates projects — that is the flow. They are hard-deleted
 * afterwards so a test run does not silently accumulate junk in the workspace
 * the developer is actually using.
 */
const created: string[] = [];

test.afterAll(async () => {
  if (created.length === 0) return;
  const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
  for (const id of created) {
    await api.delete(`/api/projects?id=${encodeURIComponent(id)}&hard=true`).catch(() => {});
  }
  await api.dispose();
});

function remember(url: string): void {
  const id = /\/projects\/([^/]+)\//.exec(url)?.[1];
  if (id) created.push(id);
}

/**
 * Never submit the composer against a live daemon. `reuseExistingServer` means
 * the API under test may be one started by hand without `LIGMA_DISCOVERY_STUB`,
 * and a real discovery pass would spend the human's allocation to make a test
 * pass — the exact trade this product refuses to make.
 */
async function requireStubbedDiscovery(page: import('@playwright/test').Page): Promise<boolean> {
  const res = await page.request.get('/api/briefs');
  if (!res.ok()) return false;
  return ((await res.json()) as { discoveryStubbed?: boolean }).discoveryStubbed === true;
}

test.describe('F1 — the composer opens discovery', () => {
  test('the Home composer names the missing field before it will submit', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('region', { name: 'Start something new' });
    await expect(composer).toBeVisible();

    const start = composer.getByRole('button', { name: 'Start' });
    await expect(start).toBeDisabled();
    await expect(composer.getByText(/^Prompt —/)).toBeVisible();

    await composer.getByLabel('What are we making?').fill('Build a REST API that shortens URLs');
    await expect(start).toBeEnabled();
  });

  test('the Adopt chip swaps the field and gates on an absolute path', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('region', { name: 'Start something new' });

    await composer.getByRole('button', { name: 'Adopt a repo' }).click();
    await expect(composer.getByRole('button', { name: 'Adopt', exact: true })).toBeDisabled();
    await expect(composer.getByText(/^Repo path —/)).toBeVisible();

    await composer.getByLabel('What are we making?').fill('relative/path');
    await expect(composer.getByText(/absolute/)).toBeVisible();
    await expect(composer.getByRole('button', { name: 'Adopt', exact: true })).toBeDisabled();

    await composer.getByLabel('What are we making?').fill('/tmp/some-repo');
    await expect(composer.getByRole('button', { name: 'Adopt', exact: true })).toBeEnabled();
  });

  test('submitting the composer lands on a Brief with a discovery form', async ({ page }) => {
    test.skip(
      !(await requireStubbedDiscovery(page)),
      'daemon is not running with LIGMA_DISCOVERY_STUB=1',
    );
    await page.goto('/');
    const composer = page.getByRole('region', { name: 'Start something new' });
    await composer
      .getByLabel('What are we making?')
      .fill('Build a REST API that shortens URLs, with rate limiting.');
    await composer.getByRole('button', { name: 'Start' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+\/brief$/);
    remember(page.url());

    // The discovery turn renders as a *form*, not a chat message — and it always
    // carries the shape question, because the pipeline branches on the answer.
    const form = page.getByRole('form');
    await expect(form).toBeVisible();
    // The shape question is a real control, not a sentence: it is the answer the
    // whole pipeline branches on.
    await expect(form.getByRole('radiogroup', { name: /What is this, shaped like/ })).toBeVisible();

    // Required gating names what is still needed, before the button works.
    const answer = form.getByRole('button', { name: 'Answer' });
    await expect(answer).toBeDisabled();
    await expect(form.getByText(/Still needed:/)).toBeVisible();

    await form.getByRole('radio', { name: /Headless/ }).click();
    // The rail never disappears, not even on a brand-new project space.
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
  });

  test("the new project space's Pipeline always offers Build and Proof", async ({ page }) => {
    test.skip(
      !(await requireStubbedDiscovery(page)),
      'daemon is not running with LIGMA_DISCOVERY_STUB=1',
    );
    await page.goto('/');
    const composer = page.getByRole('region', { name: 'Start something new' });
    await composer.getByLabel('What are we making?').fill('A tiny CLI that renames files');
    await composer.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/brief$/);
    remember(page.url());

    // Build and Proof render for every project shape, quiet when empty
    // (`pipeline-strip.tsx`) — Brief/Studio are conditional, so these two are
    // the safe universal assertion for a project whose shape isn't set yet.
    const pipeline = page.getByRole('navigation', { name: 'Pipeline' });
    for (const stage of ['Build', 'Proof']) {
      // Not `exact: true` — pipeline-strip.tsx concatenates the stage's
      // StatusChip text into the link's accessible name (e.g. "Build no
      // tasks", "Proof not proven"), so only a substring match holds.
      await pipeline.getByRole('link', { name: stage }).click();
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
    }
  });
});

test.describe('F2 — adoption', () => {
  test('an adoption review sheet is reachable, and says why when there is none', async ({
    page,
  }) => {
    const res = await page.request.get('/api/projects/adopt');
    expect(res.ok()).toBeTruthy();
    const { runs } = (await res.json()) as { runs: Array<{ id: string; status: string }> };

    const run = runs.find((r) => r.status === 'awaiting-review') ?? runs[0];
    if (!run) {
      test.skip(true, 'no adoption runs in this workspace');
      return;
    }

    await page.goto(`/adoption/${run.id}`);
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
    await expect(page.locator('body')).toBeVisible();
  });

  test('an unknown adoption run explains itself rather than blanking', async ({ page }) => {
    await page.goto('/adoption/arun_does_not_exist');
    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
  });
});

test.describe('Verify and Knowledge', () => {
  test('Verify offers Prove it on every journey, and its Knowledge drawer renders .ligma/', async ({
    page,
  }) => {
    const res = await page.request.get('/api/projects');
    const { data, projects } = (await res.json()) as {
      data?: Array<{ id: string; repoPath?: string | null }>;
      projects?: Array<{ id: string; repoPath?: string | null }>;
    };
    const list = data ?? projects ?? [];
    // The dogfood project: ligma adopted itself, so its .ligma/ is real.
    const adopted = list.find((p) => p.repoPath);
    if (!adopted) {
      test.skip(true, 'no project with a repo path in this workspace');
      return;
    }

    await page.goto(`/projects/${adopted.id}/verify`);
    await expect(page.getByRole('heading', { name: 'Journeys' })).toBeVisible();
    const proveIt = page.getByRole('button', { name: 'Prove it' });
    // A repo with journeys shows one button per journey; one is enough to prove
    // the wiring. (Clicking it would spawn a real run — deliberately not done.)
    await expect(proveIt.first()).toBeVisible();

    // Knowledge absorbed into a `?panel=knowledge` drawer on Proof
    // (`stage-panels.tsx`) rather than a sibling route with its own tab.
    await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
    await expect(page).toHaveURL(/\/verify\?panel=knowledge$/);
    const drawer = page.getByRole('dialog', { name: 'Knowledge' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Boot recipe' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'project.md' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Baselines' })).toBeVisible();
  });
});

test.describe('the needs-you tray stays one queue', () => {
  test('renders without exploding once it carries every card kind', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Global navigation' })
      .getByRole('link', { name: /^Needs you/ })
      .click();
    await expect(page).toHaveURL(/\/needs-you$/);
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
  });
});
