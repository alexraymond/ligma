import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Checkpoint restore (F2): the activity log survives a restore, and a restore
 * refuses while the engine is live. Throwaway data dir pattern — LIGMA_DATA_DIR
 * set BEFORE importing modules that read DATA_DIR.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckpointFile } from './data';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-checkpoint-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { loadCoreData } = await import('./data');
const { restoreBlockedReason } = await import('../routes/checkpoints/load/route');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const EMPTY_CHECKPOINT_DATA: CheckpointFile['data'] = {
  tasks: { tasks: [] },
  goals: { goals: [] },
  projects: { projects: [] },
  brainDump: { entries: [] },
  inbox: { messages: [] },
  decisions: { decisions: [] },
  agents: { agents: [] },
  skillsLibrary: { skills: [] },
};

describe('loadCoreData', () => {
  it('preserves the activity log across a restore', async () => {
    const seeded = {
      events: [
        {
          id: 'evt_1',
          type: 'task_created',
          actor: 'system',
          taskId: null,
          summary: 'seeded before restore',
          details: '',
          timestamp: '2026-08-11T00:00:00.000Z',
        },
      ],
    };
    writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify(seeded), 'utf-8');

    await loadCoreData(EMPTY_CHECKPOINT_DATA);

    const onDisk = JSON.parse(readFileSync(path.join(dataDir, 'activity-log.json'), 'utf-8'));
    expect(onDisk.events).toHaveLength(1);
    expect(onDisk.events[0].id).toBe('evt_1');
  });
});

describe('restoreBlockedReason', () => {
  it('blocks while the engine is running', () => {
    expect(restoreBlockedReason(true, [])).not.toBeNull();
  });

  it('blocks while any run is in progress', () => {
    expect(restoreBlockedReason(false, [{ status: 'running' }])).not.toBeNull();
  });

  it('allows the restore when idle', () => {
    expect(restoreBlockedReason(false, [{ status: 'completed' }])).toBeNull();
    expect(restoreBlockedReason(false, [])).toBeNull();
  });
});
