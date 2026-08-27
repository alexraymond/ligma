/**
 * Integration test setup — shared utilities for multi-system test scenarios.
 *
 * This module is loaded automatically via vitest.config.integration.ts `setupFiles`.
 * It provides:
 *   - A throwaway copy of the data store, so no suite writes to the real one
 *   - Data file backup/restore (full isolation per suite)
 *   - Factory helpers for creating linked entities across systems
 *   - Assertion helpers for cross-system verification
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

// The quota governor's ledger is real state about a real subscription window.
// Redirect it into a throwaway dir so a test dispatch never spends (or appears
// to spend) Alex's sessions. Set before any suite imports the governor.
process.env.MC_GOVERNOR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-governor-integ-'));

// A promote on a project with no repo provisions one for real — mkdir, git init,
// a first commit. Point that root at a throwaway dir so a test never lands a
// repo in the user's home, and take it away afterwards.
const productsRoot = mkdtempSync(path.join(os.tmpdir(), 'ligma-products-integ-'));
process.env.LIGMA_PRODUCTS_DIR = productsRoot;

// Ephemeral-env worktrees default to ~/.ligma/envs. A verification run cuts a
// real one; point it at a throwaway dir so a test never writes into the user's
// home, and so the containment guard is exercised against a path we own.
const envsRoot = mkdtempSync(path.join(os.tmpdir(), 'ligma-envs-integ-'));
process.env.LIGMA_ENVS_DIR = envsRoot;

/**
 * The whole store, copied into a throwaway dir.
 *
 * Backup-and-restore covered the JSON files, but suites that create designs,
 * baselines or contracts write DIRECTORIES under `data/projects/<id>/` and
 * `data/contracts/`, and those survived a failed run as litter in the real
 * store. A copy costs a couple of megabytes and makes the isolation total: the
 * suites still see a fully-populated store, and nothing they do reaches the
 * user's data. Set before ANY import resolves `src/paths` — hence the dynamic
 * import of ../helpers below.
 */
const realDataDir = process.env.LIGMA_DATA_DIR ?? path.resolve(__dirname, '../../../../data');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-data-integ-'));
cpSync(realDataDir, dataDir, { recursive: true });
process.env.LIGMA_DATA_DIR = dataDir;

const { backupDataFiles, restoreDataFiles } = await import('../helpers');

// ─── Global Data Isolation ──────────────────────────────────────────────────
// Every integration test suite gets a clean backup/restore cycle automatically.

let globalBackups: Record<string, string>;

beforeAll(async () => {
  globalBackups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(globalBackups);
  rmSync(productsRoot, { recursive: true, force: true });
  rmSync(envsRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});
