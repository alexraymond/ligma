import { type Page, expect, test } from '@playwright/test';

/**
 * Library — the three master–detail catalogs, against the live daemon.
 *
 * What this guards is the seam, not the styling: the vendored `design-systems/`
 * and `craft/` directories reach the browser through real routes, a design
 * system shows a *live preview* rather than a name, and the list is navigable
 * by keyboard and filterable — the properties that let the upstream catalog
 * stay usable at 150 entries.
 */

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
});

async function openLibrary(page: Page) {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
}

test.describe('Library catalogs', () => {
  test('renders all three catalogs as tabs', async ({ page }) => {
    await openLibrary(page);
    for (const name of ['Design systems', 'Skills', 'Craft rules']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
  });

  test('design systems: master list, live preview, DESIGN.md and swatches', async ({ page }) => {
    await openLibrary(page);

    const list = page.getByRole('listbox', { name: 'design systems' });
    // The vendored catalog, served by the daemon — not a build-time constant.
    await expect(list.getByRole('option').first()).toBeVisible();
    expect(await list.getByRole('option').count()).toBeGreaterThan(10);

    await list.getByRole('option', { name: /Claude \(Anthropic\)/ }).click();
    await expect(page.getByRole('heading', { name: 'Claude (Anthropic)', level: 2 })).toBeVisible();

    // The preview is the package's own components.html, in a sandboxed iframe.
    const preview = page.locator('iframe[title="Claude (Anthropic) preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('sandbox', '');
    await expect(preview).toHaveAttribute('srcdoc', /reference components/i);
    await expect(page.getByText('components.html, rendered in a sandbox')).toBeVisible();

    // Token swatches, straight from tokens.css.
    await expect(page.getByText('--accent #c96442')).toBeVisible();

    // DESIGN.md is rendered markdown, not a wall of source.
    await expect(page.getByRole('heading', { name: /Visual Theme & Atmosphere/ })).toBeVisible();
  });

  test('design systems: the filter narrows the list and keeps a valid selection', async ({
    page,
  }) => {
    await openLibrary(page);
    const list = page.getByRole('listbox', { name: 'design systems' });
    await expect(list.getByRole('option').first()).toBeVisible();
    const before = await list.getByRole('option').count();

    await page.getByLabel('Filter design systems').fill('hacker-chic');
    await expect(list.getByRole('option')).toHaveCount(1);
    expect(before).toBeGreaterThan(1);
    await expect(list.getByRole('option', { name: /Mono/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Mono', level: 2 })).toBeVisible();
  });

  test('design systems: arrow keys move the selection', async ({ page }) => {
    await openLibrary(page);
    const list = page.getByRole('listbox', { name: 'design systems' });
    const options = list.getByRole('option');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');

    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('design systems: a package with no components.html previews its tokens on a specimen', async ({
    page,
  }) => {
    // No vendored package currently ships without components.html, so the
    // fallback is exercised by serving a detail payload that has none — the
    // list still comes from the live daemon.
    await page.route('**/api/design-systems?id=*', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...body, preview: null, hasPreview: false } });
    });

    await openLibrary(page);
    await expect(page.getByText('no components.html — tokens.css on a specimen')).toBeVisible();
    const preview = page.locator('iframe[title$="preview"]').first();
    await expect(preview).toHaveAttribute('srcdoc', /Specimen/);
    await expect(preview).toHaveAttribute('srcdoc', /var\(--accent/);
  });

  test('craft rules: the vendored rulebooks render as markdown', async ({ page }) => {
    await openLibrary(page);
    await page.getByRole('tab', { name: 'Craft rules' }).click();

    const list = page.getByRole('listbox', { name: 'craft rules' });
    await expect(list.getByRole('option').first()).toBeVisible();
    expect(await list.getByRole('option').count()).toBeGreaterThan(5);

    await list.getByRole('option', { name: /Color craft rules/ }).click();
    await expect(page.getByRole('heading', { name: 'Color craft rules', level: 2 })).toBeVisible();
    await expect(page.getByText('craft/color.md')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Palette structure' })).toBeVisible();
  });

  // The crawl's only route to /library/[id]: an agent's skill is a link, not a
  // label (seam rule 8.3 — every object links what it is made of).
  test("an agent's assigned skill links into the library entry", async ({ page }) => {
    await page.goto('/team/researcher');
    const link = page.getByRole('link', { name: 'Web Research' });
    await expect(link).toHaveAttribute('href', '/library/skill_demo_research');
    await link.click();
    await expect(page).toHaveURL(/\/library\/skill_demo_research$/);
  });

  test('skills: the existing catalog is re-homed into the same shell', async ({ page }) => {
    await openLibrary(page);
    await page.getByRole('tab', { name: 'Skills' }).click();

    await expect(page.getByRole('listbox', { name: 'skills' })).toBeVisible();
    await expect(page.getByLabel('Filter skills')).toBeVisible();
    // The slash-command reference stays reachable — no feature lost in the move.
    await expect(page.getByRole('heading', { name: 'AI Commands' })).toBeVisible();
  });
});
