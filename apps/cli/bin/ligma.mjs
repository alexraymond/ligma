#!/usr/bin/env node
/**
 * Runs src/cli.ts through tsx rather than a compiled dist/.
 *
 * @ligma/api's package.json exports raw TS (`./src/index.ts`) with
 * extensionless relative imports — the shape tsx/esbuild resolve (same as
 * apps/daemon's tsx-run scripts) but plain `node` ESM resolution rejects.
 * Compiling this package to a dist/ wouldn't fix that upstream shape, so the
 * CLI runs the same way the daemon does: through tsx, not `tsc` + `node`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const entryDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(entryDir, '../src/cli.ts');
const tsxCli = require.resolve('tsx/cli');

const child = spawn(process.execPath, [tsxCli, cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 0;
  }
});
