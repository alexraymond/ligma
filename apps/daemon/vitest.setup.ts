/**
 * Unit-suite setup. One job: no test resolves a root inside anybody's real store.
 *
 * Until 2026-08-13 `DATA_DIR` defaulted to `<repo>/data`, so every suite that
 * did not pin `LIGMA_DATA_DIR` itself read *and wrote* the dogfood store. That
 * is not a hypothetical: ten `test_*.jsonl` contracts written by
 * harness-contract.test.ts had leaked into `data/contracts/` and been committed.
 * Now that the default is `~/.ligma/data`, the same suites would write into the
 * user's real install instead — worse, not better. So the suite gets a
 * throwaway COPY of the dogfood store, the isolation the integration suite has
 * had all along (__tests__/integration/setup.ts).
 *
 * A suite that pins `LIGMA_DATA_DIR` at module scope still wins: setup files run
 * before test modules are imported.
 *
 * ponytail: a whole-directory copy per test file, minus the two heavy evidence
 * trees. ~4MB and a few ms. Ceiling — if the store grows a large directory that
 * a unit test genuinely needs, copy lazily or point the read-only suites at the
 * source; do not start hand-listing files.
 */

import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/** Evidence and logs. Megabytes, and no unit test reads them. */
const SKIP = new Set(['verification-runs', 'run-outputs', 'pty-sessions', '.locks']);

// `data/` is untracked (it's a local dogfood store, never committed) — a fresh
// clone has none, and every store is fail-soft on an empty root, so an empty
// temp dir is a valid seed.
const dogfoodStore = path.resolve(__dirname, '../../data');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-data-unit-'));
if (existsSync(dogfoodStore)) {
  cpSync(dogfoodStore, dataDir, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)),
  });
}
process.env.LIGMA_DATA_DIR = dataDir;

// An ephemeral env is a full git worktree. A unit test that cuts one must never
// cut it into ~/.ligma/envs.
const envsDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-envs-unit-'));
process.env.LIGMA_ENVS_DIR = envsDir;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(envsDir, { recursive: true, force: true });
});
