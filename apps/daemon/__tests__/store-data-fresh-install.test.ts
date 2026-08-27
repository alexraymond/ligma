import fs from 'node:fs/promises';
import path from 'node:path';
/**
 * Walkthrough B1: on a fresh install none of these files exist yet, and seven
 * of the eleven getters below let that ENOENT bubble into the API as
 * "Something went wrong" instead of returning their empty shape like their
 * four siblings already did. `readOrDefault` (src/store/data.ts) is the fix —
 * this pins every getter to the same tolerance so it can't drift back.
 *
 * vitest.setup.ts already points DATA_DIR at a throwaway per-file copy of the
 * dogfood store, so deleting files here reproduces "nothing written yet"
 * without touching anyone's real data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/paths';
import {
  getActiveRuns,
  getActivityLog,
  getAgents,
  getBrainDump,
  getDaemonConfig,
  getDecisions,
  getGoals,
  getInbox,
  getProjects,
  getSkillsLibrary,
  getTasks,
  getTasksArchive,
} from '../src/store/data';

const FILES = [
  'tasks.json',
  'tasks-archive.json',
  'goals.json',
  'projects.json',
  'brain-dump.json',
  'activity-log.json',
  'inbox.json',
  'decisions.json',
  'agents.json',
  'skills-library.json',
  'active-runs.json',
  'daemon-config.json',
];

beforeAll(async () => {
  await Promise.all(FILES.map((f) => fs.rm(path.join(DATA_DIR, f), { force: true })));
});

describe('store/data getters on a fresh install (no files on disk)', () => {
  it('return their empty shape instead of throwing ENOENT', async () => {
    await expect(getTasks()).resolves.toEqual({ tasks: [] });
    await expect(getTasksArchive()).resolves.toEqual({ tasks: [] });
    await expect(getGoals()).resolves.toEqual({ goals: [] });
    await expect(getProjects()).resolves.toEqual({ projects: [] });
    await expect(getBrainDump()).resolves.toEqual({ entries: [] });
    await expect(getActivityLog()).resolves.toEqual({ events: [] });
    await expect(getInbox()).resolves.toEqual({ messages: [] });
    await expect(getDecisions()).resolves.toEqual({ decisions: [] });
    await expect(getAgents()).resolves.toEqual({ agents: [] });
    await expect(getSkillsLibrary()).resolves.toEqual({ skills: [] });
    await expect(getActiveRuns()).resolves.toEqual({ runs: [] });
  });

  it('daemon config falls back to the real default shape, not {}', async () => {
    // The bare `{}` this used to default to is why Runs crashed with
    // "Cannot read properties of undefined (reading 'maxParallelAgents')" on
    // a fresh install — `{}.concurrency` is undefined. The default now has to
    // carry the shape every consumer reads unconditionally.
    const config = (await getDaemonConfig()) as { concurrency?: { maxParallelAgents?: number } };
    expect(config.concurrency?.maxParallelAgents).toEqual(expect.any(Number));
  });
});
