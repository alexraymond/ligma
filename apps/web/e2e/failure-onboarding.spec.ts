import { expect, test } from '@playwright/test';

/**
 * The one failure-card family and milestone-scoped one-shot onboarding
 * (codebase audit W3 rewrite; UX spec F5, §7, §11).
 *
 * Two things this spec exists to hold:
 *
 *  1. The first-visit onboarding hint — a small dismissible callout, never a
 *     modal — shows exactly once and never again after dismissal, even across
 *     a reload (persisted, not session state).
 *  2. A structured daemon error renders through the `FailureCard` family, not
 *     a bare error string — mocked at the network boundary so this needs no
 *     real daemon failure.
 *
 * The previous version of the second test asserted `data-failure-class="harness"`
 * and "Harness malfunction" for an adoption run's `status: "error"`. That
 * classification changed (`classify.ts`'s `classifyAdoptionStatus`): an
 * adoption dying while standing the repo up is now `"boot"` ("Environment
 * needs a fix"), not `"harness"` — the fix is a boot recipe, not a retry, and
 * `harness` used to tell the human it was ligma's fault when it wasn't.
 */

test.describe('Onboarding hint — first visit', () => {
  // Deliberately no `mc-onboarded` seeding here — that is the exact behaviour
  // under test: an unseeded visitor sees the hint once, a dismissed one never
  // sees it again. `hints.ts` deliberately keeps "mc-onboarded" as the literal
  // legacy key for `id: "first-visit"` for exactly this test.
  test('shows once, and never again once dismissed', async ({ page }) => {
    await page.goto('/');
    const hint = page.getByTestId('onboarding-hint-first-visit');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Welcome to Ligma');

    await hint.getByRole('button', { name: 'Dismiss hint' }).click();
    await expect(hint).not.toBeVisible();

    // Persisted, not component state: a reload must not bring it back.
    await page.reload();
    await expect(page.getByTestId('onboarding-hint-first-visit')).not.toBeVisible();
  });

  test('a returning user (already seeded) never sees it', async ({ page, context }) => {
    await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
    await page.goto('/');
    await expect(page.getByTestId('onboarding-hint-first-visit')).not.toBeVisible();
  });
});

test.describe('Failure card — a structured error renders through the one family', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => window.localStorage.setItem('mc-onboarded', 'true'));
  });

  test("an adoption run's structured 'error' status renders as a boot fix, not a harness malfunction", async ({
    page,
  }) => {
    const fakeRun = {
      id: 'arun_e2e_simulated',
      repoPath: '/tmp/simulated-repo',
      projectId: null,
      status: 'error',
      shape: null,
      boot: null,
      bootRationale: '',
      proposedJourneys: [],
      confusionLog: [],
      envId: null,
      // The classification below comes entirely from `status: "error"` — this
      // message is carried as supplementary detail only, never parsed.
      error: 'the ephemeral env never became healthy',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    await page.route('**/api/adoption/arun_e2e_simulated', async (route) => {
      await route.fulfill({ json: fakeRun });
    });

    await page.goto('/adoption/arun_e2e_simulated');
    // /adoption isn't a project space or the Studio route, so the global rail
    // (`isStudioRoute`/`isProjectSpace`, lib/nav.ts) stays up here.
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();

    const card = page.locator('[data-failure-class]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-failure-class', 'boot');
    await expect(card).toContainText('Environment needs a fix');
    await expect(card).toContainText('the ephemeral env never became healthy');
    // The action offered for a boot failure is fixing the recipe, not a bare retry.
    await expect(card.getByRole('button', { name: 'Correct the boot recipe' })).toBeVisible();
  });

  test('an unknown adoption run explains itself rather than blanking', async ({ page }) => {
    await page.goto('/adoption/arun_does_not_exist');
    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Global navigation' })).toBeVisible();
  });
});
