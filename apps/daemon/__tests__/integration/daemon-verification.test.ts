/**
 * Integration test: a daemon run that exits 0 does NOT mean "done".
 *
 * Spawns the real run-task.ts against a stub `claude` binary (exit 0, one JSON
 * result) and asserts the task lands in awaiting-verification / unverified with
 * no completedAt. No Claude quota is used.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTask, findTask } from './test-utils';

import { DAEMON_ROOT, DATA_DIR } from '../../src/paths';
const CONFIG_FILE = path.join(DATA_DIR, 'daemon-config.json');

let stubDir: string;
let originalConfig: string;
/** The auto-compiled contract this run produces; contracts are git-tracked. */
let contractFile = '';

beforeAll(() => {
  stubDir = mkdtempSync(path.join(tmpdir(), 'mc-stub-claude-'));
  const stub = path.join(stubDir, 'claude');
  writeFileSync(
    stub,
    `#!/bin/sh\necho '{"type":"result","subtype":"success","is_error":false,"result":"I did the thing (not really)"}'\nexit 0\n`,
    'utf-8',
  );
  chmodSync(stub, 0o755);

  originalConfig = readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(originalConfig) as {
    execution: { claudeBinaryPath: string | null; harness: { autoVerify: boolean } };
  };
  config.execution.claudeBinaryPath = stub;
  // The builder now compiles a contract on completion, which makes the task
  // genuinely verifiable — and a real run would boot an env and a browser.
  config.execution.harness.autoVerify = false;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
});

afterAll(() => {
  writeFileSync(CONFIG_FILE, originalConfig, 'utf-8');
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(contractFile, { force: true });
});

describe('daemon run exiting 0', () => {
  it('lands the task in awaiting-verification, not done', async () => {
    const task = await createTask({
      title: 'Stub run for verification gate',
      assignedTo: 'developer',
      kanban: 'not-started',
      acceptanceCriteria: ['This task is deliberately fake'],
    });
    contractFile = path.join(DATA_DIR, 'contracts', `${task.id}.jsonl`);

    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/engine/run-task.ts', task.id, '--source', 'manual'],
      { cwd: DAEMON_ROOT, stdio: 'ignore' },
    );

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('awaiting-verification');
    expect(after?.verificationStatus).toBe('unverified');
    expect(after?.completedAt).toBeNull();
  });
});
