/**
 * Unit tests for the FsAckTracker — the coordination primitive between
 * main and renderer for `fs_updated` IPC events. Pure logic, no Electron.
 */

import type { CoreLogger } from '@open-codesign/core';
import { describe, expect, it, vi } from 'vitest';
import { createFsAckTracker } from './fs-ack';

function mkLogger(): CoreLogger & {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('createFsAckTracker', () => {
  it('allocates monotonic sequence ids starting at 0', () => {
    const tracker = createFsAckTracker({
      logger: mkLogger(),
      timeoutMs: 50,
      generationId: 'gen-1',
    });
    expect(tracker.nextSeq()).toBe(0);
    expect(tracker.nextSeq()).toBe(1);
    expect(tracker.nextSeq()).toBe(2);
  });

  it('resolves `wait` when a matching `ack` arrives before the timeout', async () => {
    const tracker = createFsAckTracker({
      logger: mkLogger(),
      timeoutMs: 2000,
      generationId: 'gen-2',
    });
    const seq = tracker.nextSeq();
    const p = tracker.wait(seq);
    queueMicrotask(() => tracker.ack(seq));
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves (does NOT reject) after the timeout and logs a warn', async () => {
    const logger = mkLogger();
    const tracker = createFsAckTracker({
      logger,
      timeoutMs: 20,
      generationId: 'gen-3',
    });
    const seq = tracker.nextSeq();
    await expect(tracker.wait(seq)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'claude-cli.fs_ack.timeout',
      expect.objectContaining({ generationId: 'gen-3', seq: 0, timeoutMs: 20 }),
    );
  });

  it('ignores duplicate acks', () => {
    const tracker = createFsAckTracker({
      logger: mkLogger(),
      timeoutMs: 100,
      generationId: 'gen-4',
    });
    const seq = tracker.nextSeq();
    const p = tracker.wait(seq);
    tracker.ack(seq);
    tracker.ack(seq);
    return expect(p).resolves.toBeUndefined();
  });

  it('abort() resolves all pending waiters without warn', async () => {
    const logger = mkLogger();
    const tracker = createFsAckTracker({
      logger,
      timeoutMs: 10_000,
      generationId: 'gen-5',
    });
    const p1 = tracker.wait(tracker.nextSeq());
    const p2 = tracker.wait(tracker.nextSeq());
    tracker.abort();
    await expect(Promise.all([p1, p2])).resolves.toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
