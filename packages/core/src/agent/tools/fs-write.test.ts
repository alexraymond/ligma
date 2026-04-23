import { describe, expect, it } from 'vitest';
import type { FsUpdatedAckV1 } from '../_stub-ipc-types.js';
import { makeFsWriteTool } from './fs-write.js';

const ctx = { signal: new AbortController().signal };

describe('makeFsWriteTool', () => {
  it('returns ok result with seq on successful ACK', async () => {
    const tool = makeFsWriteTool(async (input): Promise<FsUpdatedAckV1> => {
      expect(input).toEqual({ path: 'a.html', content: '<p>hi</p>' });
      return { schemaVersion: 1, seq: 7, ok: true };
    });
    const result = await tool.run({ path: 'a.html', content: '<p>hi</p>' }, ctx);
    expect(result).toEqual({
      ok: true,
      result: { path: 'a.html', bytes: 9, seq: 7 },
    });
  });

  it('surfaces ACK failure as error string', async () => {
    const tool = makeFsWriteTool(async () => ({
      schemaVersion: 1,
      seq: 7,
      ok: false,
      error: 'timed out',
    }));
    const result = await tool.run({ path: 'a', content: 'b' }, ctx);
    expect(result).toEqual({ ok: false, error: 'timed out' });
  });

  it('rejects missing path and missing content', async () => {
    const tool = makeFsWriteTool(async () => {
      throw new Error('should not be called');
    });
    expect((await tool.run({ content: 'x' }, ctx)).ok).toBe(false);
    expect((await tool.run({ path: 'a' }, ctx)).ok).toBe(false);
    expect((await tool.run({ path: 'a', content: 123 }, ctx)).ok).toBe(false);
  });

  it('returns aborted short-circuit before delegating', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = makeFsWriteTool(async () => {
      throw new Error('should not be called');
    });
    const result = await tool.run({ path: 'a', content: 'b' }, { signal: controller.signal });
    expect(result).toEqual({ ok: false, error: 'aborted' });
  });

  it('declares itself NOT concurrency-safe', () => {
    const tool = makeFsWriteTool(async () => ({
      schemaVersion: 1,
      seq: 0,
      ok: true,
    }));
    expect(tool.isConcurrencySafe({})).toBe(false);
  });
});
