import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * E1: a fresh install must not kill dispatch.
 *
 * On a default `~/.ligma/data` install nothing seeds `decisions.json`. The
 * dispatch filter calls `pendingDecisionBlock` for every pending task, that read
 * threw ENOENT, `pollAndDispatch`'s catch swallowed it, and ALL dispatch and
 * verification pickup died silently on every cycle until something else happened
 * to create the file. No test ever saw it because the unit setup copies the
 * dogfood store, which carries every file.
 *
 * So this suite points DATA_DIR at a genuinely EMPTY directory — the one state
 * the rest of the suite cannot reproduce.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-fresh-store-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  getPendingTasks,
  getTask,
  pendingDecisionBlock,
  hasBlockingPendingDecision,
  isTaskUnblocked,
} = await import('./prompt-builder');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a data root with no store files in it', () => {
  it('is genuinely empty (guards the fixture itself)', () => {
    // `.locks` is created on import by file-lock.ts; nothing else may appear.
    expect(readdirSync(dataDir).filter((f) => f.endsWith('.json'))).toEqual([]);
  });

  it('reads no pending tasks instead of throwing', () => {
    expect(getPendingTasks()).toEqual([]);
  });

  it("answers 'no such task' instead of throwing", () => {
    expect(getTask('task_1')).toBeNull();
  });

  it('does not park a task on decisions it cannot read — the E1 path itself', () => {
    expect(pendingDecisionBlock('task_1')).toBeNull();
    expect(hasBlockingPendingDecision('task_1')).toBe(false);
  });

  it('treats an unknown blocker as not-done rather than crashing the filter', () => {
    expect(isTaskUnblocked({ blockedBy: [] } as never)).toBe(true);
    expect(isTaskUnblocked({ blockedBy: ['task_missing'] } as never)).toBe(false);
  });
});
