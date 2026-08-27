import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * A verdict for a task that no longer exists (deleted/archived mid-run) must
 * not leak the raw taskId into an inbox report or activity event as if it
 * were a title — before this fix, `applyVerdict` fell through past the
 * "task not found" branch inside the file lock (a bare `return` there only
 * exits that inner callback) and unconditionally wrote
 * `Verified: <raw taskId>` to the inbox and activity log.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-verdict-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(path.join(dataDir, 'inbox.json'), JSON.stringify({ messages: [] }));
  writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify({ events: [] }));
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

function baseVerdict(taskId: string) {
  return {
    runId: 'vrun_1',
    taskId,
    contractId: 'contract_1',
    contractVersion: 1,
    outcome: 'passed' as const,
    criterionVerdicts: [],
    humanDecisions: [],
    judgeModel: 'test',
    createdAt: new Date().toISOString(),
    signature: null,
  };
}

describe('applyVerdict — task vanished before the verdict landed', () => {
  it('writes no inbox report or activity event named after the raw taskId', async () => {
    const { applyVerdict } = await import('./verdict');
    await applyVerdict(baseVerdict('task_gone'));

    const inbox = JSON.parse(readFileSync(path.join(dataDir, 'inbox.json'), 'utf8'));
    const activity = existsSync(path.join(dataDir, 'activity-log.json'))
      ? JSON.parse(readFileSync(path.join(dataDir, 'activity-log.json'), 'utf8'))
      : { events: [] };

    expect(inbox.messages).toEqual([]);
    expect(activity.events).toEqual([]);
  });
});
