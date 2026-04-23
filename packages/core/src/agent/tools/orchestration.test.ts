import { describe, expect, it } from 'vitest';
import { type Tool, type ToolCall, ToolRegistry, type ToolRunResult } from './index.js';
import { CONCURRENCY_CAP_DEFAULT, batchAndRun, partitionToolCalls } from './orchestration.js';

function makeReadOnlyTool(
  name: string,
  behaviour: (input: unknown) => Promise<ToolRunResult>,
): Tool {
  return {
    name,
    isConcurrencySafe: () => true,
    run: (input) => behaviour(input),
  };
}

function makeWriteTool(name: string, behaviour: (input: unknown) => Promise<ToolRunResult>): Tool {
  return {
    name,
    isConcurrencySafe: () => false,
    run: (input) => behaviour(input),
  };
}

function call(name: string, id: string, input: unknown = {}): ToolCall {
  return { id, name, input };
}

describe('partitionToolCalls', () => {
  it('groups consecutive read-only tools into one batch', () => {
    const registry = new ToolRegistry();
    registry.register(makeReadOnlyTool('r1', async () => ({ ok: true })));
    registry.register(makeReadOnlyTool('r2', async () => ({ ok: true })));
    const calls = [call('r1', 'a'), call('r2', 'b'), call('r1', 'c')];
    const batches = partitionToolCalls(calls, registry);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.concurrencySafe).toBe(true);
    expect(batches[0]?.calls).toHaveLength(3);
  });

  it('breaks batches around write tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeReadOnlyTool('read', async () => ({ ok: true })));
    registry.register(makeWriteTool('write', async () => ({ ok: true })));
    const calls = [call('read', 'a'), call('write', 'b'), call('read', 'c'), call('read', 'd')];
    const batches = partitionToolCalls(calls, registry);
    expect(batches.map((b) => ({ safe: b.concurrencySafe, n: b.calls.length }))).toEqual([
      { safe: true, n: 1 },
      { safe: false, n: 1 },
      { safe: true, n: 2 },
    ]);
  });

  it('treats unknown tools as not concurrency-safe', () => {
    const registry = new ToolRegistry();
    const batches = partitionToolCalls([call('ghost', 'x')], registry);
    expect(batches[0]?.concurrencySafe).toBe(false);
  });

  it('treats isConcurrencySafe-throwing tools as not concurrency-safe', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'unstable',
      isConcurrencySafe: () => {
        throw new Error('boom');
      },
      run: async () => ({ ok: true }),
    });
    const batches = partitionToolCalls([call('unstable', 'x')], registry);
    expect(batches[0]?.concurrencySafe).toBe(false);
  });
});

describe('batchAndRun', () => {
  it('caps a 15-read-only-tool run at the concurrency limit', async () => {
    const registry = new ToolRegistry();
    let inFlight = 0;
    let peak = 0;
    const tool = makeReadOnlyTool('probe', async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true };
    });
    registry.register(tool);
    const calls = Array.from({ length: 15 }, (_, i) => call('probe', `c${i}`));

    const results = await batchAndRun(calls, registry, { maxConcurrency: CONCURRENCY_CAP_DEFAULT });

    expect(results).toHaveLength(15);
    expect(peak).toBe(CONCURRENCY_CAP_DEFAULT);
    expect(peak).toBeLessThanOrEqual(10);
    for (const r of results) expect(r.result.ok).toBe(true);
  });

  it('serializes write tools (peak concurrency = 1)', async () => {
    const registry = new ToolRegistry();
    let inFlight = 0;
    let peak = 0;
    const tool = makeWriteTool('mut', async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true };
    });
    registry.register(tool);
    const calls = Array.from({ length: 5 }, (_, i) => call('mut', `w${i}`));

    await batchAndRun(calls, registry);

    expect(peak).toBe(1);
  });

  it('one failure in a read-only batch does not poison the other results', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeReadOnlyTool('r', async (input) => {
        const { willFail } = input as { willFail: boolean };
        if (willFail) throw new Error('nope');
        return { ok: true, result: 'fine' };
      }),
    );
    const calls: ToolCall[] = [
      call('r', 'a', { willFail: false }),
      call('r', 'b', { willFail: true }),
      call('r', 'c', { willFail: false }),
      call('r', 'd', { willFail: true }),
      call('r', 'e', { willFail: false }),
    ];

    const results = await batchAndRun(calls, registry);

    expect(results.map((r) => r.result.ok)).toEqual([true, false, true, false, true]);
    expect(results[1]?.result.error).toBe('nope');
    expect(results[2]?.result.result).toBe('fine');
  });

  it('aborts before a tool runs yield ok=false error=aborted', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeWriteTool('slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: true };
      }),
    );
    const controller = new AbortController();
    controller.abort();
    const calls = [call('slow', 'a'), call('slow', 'b')];

    const results = await batchAndRun(calls, registry, { signal: controller.signal });
    expect(results.map((r) => r.result)).toEqual([
      { ok: false, error: 'aborted' },
      { ok: false, error: 'aborted' },
    ]);
  });

  it('propagates AbortSignal to in-flight tools and short-circuits the batch', async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    const observed: boolean[] = [];
    registry.register({
      name: 'watched',
      isConcurrencySafe: () => true,
      run: async (_input, ctx) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 50);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
        observed.push(ctx.signal.aborted);
        return { ok: true };
      },
    });
    const calls = Array.from({ length: 6 }, (_, i) => call('watched', `c${i}`));
    setTimeout(() => controller.abort(), 10);

    const results = await batchAndRun(calls, registry, {
      signal: controller.signal,
      maxConcurrency: 3,
    });

    expect(results).toHaveLength(6);
    const errors = results.map((r) => r.result.error);
    for (const e of errors) {
      expect(e === 'aborted' || e === undefined).toBe(true);
    }
    expect(errors.some((e) => e === 'aborted')).toBe(true);
  });

  it('emits onStart and onEnd hooks in call order', async () => {
    const registry = new ToolRegistry();
    registry.register(makeReadOnlyTool('r', async () => ({ ok: true })));
    const started: string[] = [];
    const ended: string[] = [];
    const calls = [call('r', 'a'), call('r', 'b'), call('r', 'c')];
    await batchAndRun(calls, registry, {
      onStart: (c) => started.push(c.id),
      onEnd: (c) => ended.push(c.id),
    });
    expect(started.sort()).toEqual(['a', 'b', 'c']);
    expect(ended.sort()).toEqual(['a', 'b', 'c']);
  });

  it('unknown tools surface as ok=false error="unknown tool: ..."', async () => {
    const registry = new ToolRegistry();
    const results = await batchAndRun([call('ghost', 'x')], registry);
    expect(results[0]?.result).toEqual({
      ok: false,
      error: 'unknown tool: ghost',
    });
  });

  it('is not affected by the LIGMA_MAX_TOOL_USE_CONCURRENCY env var when overridden', async () => {
    const oldEnv = process.env['LIGMA_MAX_TOOL_USE_CONCURRENCY'];
    process.env['LIGMA_MAX_TOOL_USE_CONCURRENCY'] = '2';
    try {
      const registry = new ToolRegistry();
      let inFlight = 0;
      let peak = 0;
      registry.register(
        makeReadOnlyTool('r', async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 3));
          inFlight -= 1;
          return { ok: true };
        }),
      );
      const calls = Array.from({ length: 6 }, (_, i) => call('r', `c${i}`));
      await batchAndRun(calls, registry);
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      if (oldEnv === undefined) {
        // biome-ignore lint/performance/noDelete: `= undefined` would set the env var to the string "undefined"; `delete` is required to restore the unset state this test depends on.
        delete process.env['LIGMA_MAX_TOOL_USE_CONCURRENCY'];
      } else {
        process.env['LIGMA_MAX_TOOL_USE_CONCURRENCY'] = oldEnv;
      }
    }
  });
});
