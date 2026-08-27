import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * P22 — a healthy empty install must not greet its owner with red text.
 *
 * A brand-new data root has no `tasks.json` until the first write. Three sites
 * read it anyway on the very first poll: `reconcileStaleInProgressTasks` (fixed
 * earlier), `pruneCheckpointsForDoneTasks` (a WARN) and the verifiable-task scan
 * in `dispatchVerifications` (an ERROR). Nothing was actually wrong in any of
 * them — there was simply nothing there yet.
 *
 * This drives a real poll cycle against an empty `LIGMA_DATA_DIR` with
 * `autoVerify` ON (so the verification scan runs) and asserts the log stays
 * clean. `maxParallelAgents: 0` keeps it cheap: every filter and every
 * housekeeping sweep runs in full, then dispatch returns on "no slots" before
 * anything is spawned.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-fresh-poll-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { Dispatcher, pruneCheckpointsForDoneTasks } = await import('../src/engine/dispatcher');
const { loadConfig } = await import('../src/engine/config');
const { logger } = await import('../src/engine/logger');
const { HealthMonitor } = await import('../src/engine/health');
const { AgentRunner } = await import('../src/engine/runner');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a fresh install's first poll", () => {
  it('logs nothing at WARN or ERROR with no store files on disk', async () => {
    // loadConfig() self-heals daemon-config.json; every other store is absent,
    // which is exactly the state under test.
    expect(readdirSync(dataDir).filter((f) => f === 'tasks.json')).toEqual([]);

    const config = loadConfig();
    config.execution.harness.autoVerify = true;
    config.concurrency.maxParallelAgents = 0;

    const health = {
      getActiveSessions: () => [],
      activeCount: () => 0,
      isTaskRunning: () => false,
      getRetryCount: () => 0,
      setLastPollAt: () => {},
    };

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const dispatcher = new Dispatcher(
        config,
        {} as InstanceType<typeof AgentRunner>,
        health as unknown as InstanceType<typeof HealthMonitor>,
      );
      await dispatcher.pollAndDispatch();

      expect(warn.mock.calls).toEqual([]);
      expect(error.mock.calls).toEqual([]);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('prunes nothing, quietly, when there is no task store to read', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      expect(pruneCheckpointsForDoneTasks()).toBe(0);
      expect(warn.mock.calls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
