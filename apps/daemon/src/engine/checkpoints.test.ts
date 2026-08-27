import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The checkpoint store — durable progress an agent recorded mid-task, read back
 * when the next attempt starts cold.
 *
 * The daemon never appends: agents write `task-checkpoints.json` themselves per
 * the prompt protocol (same idiom as decisions.json), so these tests write the
 * file directly, exactly as a spawned agent would.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-checkpoints-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { readCheckpointsForTask, pruneCheckpointsForTasks, checkpointsFilePath } = await import(
  './checkpoints'
);

const FILE = path.join(dataDir, 'task-checkpoints.json');

function seed(raw: string): void {
  writeFileSync(FILE, raw, 'utf-8');
}

function seedCheckpoints(checkpoints: unknown[]): void {
  seed(JSON.stringify({ checkpoints }, null, 2));
}

function checkpoint(
  taskId: string,
  phase: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    taskId,
    agentId: 'developer',
    phase,
    note: `finished ${phase}`,
    createdAt: '2026-08-26T10:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  rmSync(FILE, { force: true });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('readCheckpointsForTask', () => {
  it("resolves the file under the daemon's data dir", () => {
    expect(checkpointsFilePath()).toBe(FILE);
  });

  it('round-trips what an agent wrote, for that task only', () => {
    seedCheckpoints([
      checkpoint('task_1', 'schema', { artifacts: ['db/schema.sql'] }),
      checkpoint('task_2', 'other'),
      checkpoint('task_1', 'migration'),
    ]);

    const got = readCheckpointsForTask('task_1');
    expect(got.map((c) => c.phase)).toEqual(['schema', 'migration']);
    expect(got[0].artifacts).toEqual(['db/schema.sql']);
    expect(got[0].agentId).toBe('developer');
  });

  it('is empty when the file does not exist', () => {
    expect(readCheckpointsForTask('task_1')).toEqual([]);
  });

  it('is empty when the file is corrupt', () => {
    seed('{not json');
    expect(readCheckpointsForTask('task_1')).toEqual([]);
  });

  it('is empty when the file has no checkpoints array', () => {
    seed(JSON.stringify({ checkpoints: 'nope' }));
    expect(readCheckpointsForTask('task_1')).toEqual([]);
  });

  it('drops entries an agent malformed rather than handing them to the prompt', () => {
    seedCheckpoints([null, { phase: 'no task id' }, checkpoint('task_1', 'real')]);
    expect(readCheckpointsForTask('task_1').map((c) => c.phase)).toEqual(['real']);
  });
});

describe('pruneCheckpointsForTasks', () => {
  it('removes only the given task ids', () => {
    seedCheckpoints([
      checkpoint('task_done', 'a'),
      checkpoint('task_live', 'b'),
      checkpoint('task_done', 'c'),
      checkpoint('task_other', 'd'),
    ]);

    expect(pruneCheckpointsForTasks(['task_done', 'task_other'])).toBe(3);
    expect(readCheckpointsForTask('task_done')).toEqual([]);
    expect(readCheckpointsForTask('task_other')).toEqual([]);
    expect(readCheckpointsForTask('task_live').map((c) => c.phase)).toEqual(['b']);
  });

  it('is a no-op for an empty id list', () => {
    seedCheckpoints([checkpoint('task_1', 'a')]);
    expect(pruneCheckpointsForTasks([])).toBe(0);
    expect(readCheckpointsForTask('task_1')).toHaveLength(1);
  });

  it('is a no-op when none of the ids have checkpoints', () => {
    seedCheckpoints([checkpoint('task_1', 'a')]);
    expect(pruneCheckpointsForTasks(['task_nope'])).toBe(0);
    expect(readCheckpointsForTask('task_1')).toHaveLength(1);
  });

  it('does not throw on a missing or corrupt file', () => {
    expect(pruneCheckpointsForTasks(['task_1'])).toBe(0);
    seed('{not json');
    expect(pruneCheckpointsForTasks(['task_1'])).toBe(0);
  });
});
