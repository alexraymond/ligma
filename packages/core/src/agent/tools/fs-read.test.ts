import { describe, expect, it } from 'vitest';
import type { FsViewAckV1 } from '@ligma/shared';
import { makeFsReadTool } from './fs-read.js';

const ctx = { signal: new AbortController().signal };

describe('makeFsReadTool', () => {
  it('returns ok result with content + numLines on successful ACK', async () => {
    const tool = makeFsReadTool(async (input): Promise<FsViewAckV1> => {
      expect(input.path).toBe('a.html');
      return {
        schemaVersion: 1,
        seq: 1,
        ok: true,
        content: '<html></html>',
        numLines: 1,
      };
    });
    const result = await tool.run({ path: 'a.html' }, ctx);
    expect(result).toEqual({
      ok: true,
      result: { path: 'a.html', content: '<html></html>', numLines: 1 },
    });
  });

  it('surfaces ACK failure as error string', async () => {
    const tool = makeFsReadTool(async () => ({
      schemaVersion: 1,
      seq: 1,
      ok: false,
      error: 'no such file',
    }));
    const result = await tool.run({ path: 'missing' }, ctx);
    expect(result).toEqual({ ok: false, error: 'no such file' });
  });

  it('rejects missing path before delegating', async () => {
    const tool = makeFsReadTool(async () => {
      throw new Error('should not be called');
    });
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('path is required');
  });

  it('passes viewRange through when valid', async () => {
    const seen: unknown[] = [];
    const tool = makeFsReadTool(async (input): Promise<FsViewAckV1> => {
      seen.push(input);
      return { schemaVersion: 1, seq: 1, ok: true, content: '', numLines: 0 };
    });
    await tool.run({ path: 'a', viewRange: [1, 10] }, ctx);
    expect(seen[0]).toEqual({ path: 'a', viewRange: [1, 10] });
  });

  it('rejects malformed viewRange', async () => {
    const tool = makeFsReadTool(async () => {
      throw new Error('should not be called');
    });
    const result = await tool.run({ path: 'a', viewRange: [1] }, ctx);
    expect(result.ok).toBe(false);
  });

  it('returns aborted short-circuit before delegating', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = makeFsReadTool(async () => {
      throw new Error('should not be called');
    });
    const result = await tool.run({ path: 'a' }, { signal: controller.signal });
    expect(result).toEqual({ ok: false, error: 'aborted' });
  });

  it('declares itself concurrency-safe', () => {
    const tool = makeFsReadTool(async () => ({
      schemaVersion: 1,
      seq: 0,
      ok: true,
    }));
    expect(tool.isConcurrencySafe({})).toBe(true);
  });
});
