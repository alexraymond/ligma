import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests.
 *
 * Runs against the built Next.js app (pnpm build + pnpm start).
 * In CI, the webServer block auto-starts the app on port 3000.
 * Screenshots are captured on failure for CI artifact upload.
 */

/**
 * A throwaway store, outside the repo, never the maintainer's dogfood data.
 *
 * `pnpm --filter @ligma/daemon serve` (apps/daemon/package.json) hardcodes
 * `LIGMA_DATA_DIR=../../data` inline in the script string — that shell
 * assignment wins over any `env` this config passes to the spawned process,
 * so the daemon is started directly via `exec tsx` instead of through that
 * script, letting our own LIGMA_DATA_DIR reach it unshadowed. An e2e run must
 * never read or write the live checkout store.
 */
const e2eDataDir = process.env.LIGMA_E2E_DATA_DIR ?? join(tmpdir(), 'ligma-e2e-data');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // The daemon serves /api/* (web proxies to it), so both come up before the
  // run. `serve` is the API alone — an e2e run must never spawn agents.
  webServer: [
    {
      // `exec tsx src/server.ts` (not the `serve` script) so LIGMA_DATA_DIR
      // below actually reaches the process — see e2eDataDir's comment.
      command: 'pnpm --filter @ligma/daemon exec tsx src/server.ts',
      url: 'http://127.0.0.1:4477/api/daemon',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        // Discovery answers from a fixed stub instead of a model: the composer
        // flow is exercised end to end, and an e2e run still spawns no agents.
        LIGMA_DISCOVERY_STUB: '1',
        LIGMA_DATA_DIR: e2eDataDir,
      },
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
