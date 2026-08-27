import { describe, expect, it } from 'vitest';
import type { AgentEvent, ToolEnd, ToolStart } from './events.js';
import { type ProviderStreamItem, type ProviderTurn, runTurn } from './loop.js';
import type { Tool, ToolCall } from './tools/index.js';
import { ToolRegistry } from './tools/index.js';

function fromItems(items: ProviderStreamItem[]): ProviderTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function makeRegistry(tools: Tool[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register(t);
  return reg;
}

async function collect<T>(
  gen: AsyncGenerator<AgentEvent, T>,
): Promise<{ events: AgentEvent[]; done: T }> {
  const events: AgentEvent[] = [];
  let result: IteratorResult<AgentEvent, T>;
  for (;;) {
    result = await gen.next();
    if (result.done) return { events, done: result.value };
    events.push(result.value);
  }
}

describe('runTurn', () => {
  it('passes text and thinking deltas through to AgentEvents and emits TurnDone', async () => {
    const provider = fromItems([
      { type: 'thinking', delta: 'hmm' },
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'done', stopReason: 'stop' },
    ]);

    const { events, done } = await collect(runTurn({ provider, tools: new ToolRegistry() }));

    expect(events.map((e) => e.type)).toEqual([
      'thinking_chunk',
      'text_chunk',
      'text_chunk',
      'turn_done',
    ]);
    expect(done.stopReason).toBe('stop');
    expect(done.text).toBe('Hello world');
    expect(done.toolCalls).toBe(0);
  });

  it('runs tool_call_batch through orchestration, yields interleaved ToolStart+ToolEnd', async () => {
    const provider: ProviderTurn = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text', delta: 'thinking' };
        yield {
          type: 'tool_call_batch',
          calls: [
            { id: 't1', name: 'read', input: { path: 'a' } },
            { id: 't2', name: 'read', input: { path: 'b' } },
          ],
        };
        yield { type: 'text', delta: 'done' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const tool: Tool = {
      name: 'read',
      isConcurrencySafe: () => true,
      run: async (input) => ({
        ok: true,
        result: { path: (input as { path: string }).path, content: 'x' },
      }),
    };
    const { events, done } = await collect(runTurn({ provider, tools: makeRegistry([tool]) }));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('text_chunk');
    expect(types.slice(1, 3).sort()).toEqual(['tool_start', 'tool_start']);
    expect(types.slice(3, 5).sort()).toEqual(['tool_end', 'tool_end']);
    expect(types[5]).toBe('text_chunk');
    expect(types[6]).toBe('turn_done');
    const toolEnds = events.filter((e) => e.type === 'tool_end') as ToolEnd[];
    expect(toolEnds.every((e) => e.ok)).toBe(true);
    expect(done.toolCalls).toBe(2);
  });

  it('respects pre-aborted AbortSignal and yields TurnDone stopReason=aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fromItems([
      { type: 'text', delta: 'hi' },
      { type: 'done', stopReason: 'stop' },
    ]);
    const { events, done } = await collect(
      runTurn({ provider, tools: new ToolRegistry(), signal: controller.signal }),
    );
    expect(events).toHaveLength(1);
    expect(done.stopReason).toBe('aborted');
    expect(done.text).toBe('');
  });

  it('aborts mid-stream when the signal fires', async () => {
    const controller = new AbortController();
    const provider: ProviderTurn = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text', delta: 'first' };
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.abort();
        yield { type: 'text', delta: 'second' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const { events, done } = await collect(
      runTurn({ provider, tools: new ToolRegistry(), signal: controller.signal }),
    );
    expect(done.stopReason).toBe('aborted');
    const texts = events.filter((e) => e.type === 'text_chunk');
    expect(texts).toHaveLength(1);
  });

  it('feeds tool results back to the provider via provideToolResults', async () => {
    const seen: unknown[][] = [];
    const provider: ProviderTurn = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'tool_call_batch',
          calls: [{ id: 't1', name: 'read', input: {} }],
        };
        yield { type: 'done', stopReason: 'stop' };
      },
      provideToolResults: async (results) => {
        seen.push(results.map((r) => ({ id: r.call.id, ok: r.result.ok })));
      },
    };
    const tool: Tool = {
      name: 'read',
      isConcurrencySafe: () => true,
      run: async () => ({ ok: true, result: 42 }),
    };
    await collect(runTurn({ provider, tools: makeRegistry([tool]) }));
    expect(seen).toEqual([[{ id: 't1', ok: true }]]);
  });

  it('maps provider "done" with error to TurnDone stopReason=error', async () => {
    const provider = fromItems([
      { type: 'text', delta: 'partial' },
      { type: 'done', stopReason: 'error', error: 'oops' },
    ]);
    const { done } = await collect(runTurn({ provider, tools: new ToolRegistry() }));
    expect(done.stopReason).toBe('error');
    expect(done.error).toBe('oops');
    expect(done.text).toBe('partial');
  });

  it('assigns monotonic seq numbers across ToolStart/ToolEnd events', async () => {
    const provider = fromItems([
      {
        type: 'tool_call_batch',
        calls: [
          { id: 't1', name: 'read', input: {} },
          { id: 't2', name: 'read', input: {} },
          { id: 't3', name: 'read', input: {} },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    ]);
    const tool: Tool = {
      name: 'read',
      isConcurrencySafe: () => true,
      run: async () => ({ ok: true }),
    };
    const { events } = await collect(runTurn({ provider, tools: makeRegistry([tool]) }));
    const starts = events.filter((e) => e.type === 'tool_start') as ToolStart[];
    const ends = events.filter((e) => e.type === 'tool_end') as ToolEnd[];
    expect(starts.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(ends.map((e) => e.seq).sort()).toEqual([1, 2, 3]);
  });

  it('enforces maxToolBatches as a runaway guard', async () => {
    const provider: ProviderTurn = {
      async *[Symbol.asyncIterator]() {
        // Three batches back-to-back; the loop should stop at max=2.
        yield { type: 'tool_call_batch', calls: [{ id: 'a', name: 'r', input: {} }] };
        yield { type: 'tool_call_batch', calls: [{ id: 'b', name: 'r', input: {} }] };
        yield { type: 'tool_call_batch', calls: [{ id: 'c', name: 'r', input: {} }] };
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const tool: Tool = {
      name: 'r',
      isConcurrencySafe: () => true,
      run: async () => ({ ok: true }),
    };
    const { done } = await collect(
      runTurn({
        provider,
        tools: makeRegistry([tool]),
        maxToolBatches: 2,
      }),
    );
    expect(done.stopReason).toBe('error');
    expect(done.error).toContain('tool batch cap');
  });
});
