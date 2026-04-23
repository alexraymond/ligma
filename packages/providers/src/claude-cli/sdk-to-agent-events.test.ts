import { describe, expect, it } from 'vitest';
import {
  type ProviderStreamItem,
  type SdkStreamMessage,
  adaptSdkStreamToProviderTurn,
  assistantMessageToReplayEvents,
} from './sdk-to-agent-events.js';

async function* streamOf(messages: SdkStreamMessage[]): AsyncGenerator<SdkStreamMessage> {
  for (const m of messages) yield m;
}

async function collect(turn: AsyncIterable<ProviderStreamItem>): Promise<ProviderStreamItem[]> {
  const out: ProviderStreamItem[] = [];
  for await (const item of turn) out.push(item);
  return out;
}

describe('adaptSdkStreamToProviderTurn', () => {
  it('maps assistant text blocks to text items', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hi' }] },
        },
        { type: 'result', subtype: 'success', result: 'done' },
      ]),
    });
    const items = await collect(turn);
    expect(items).toEqual([
      { type: 'text', delta: 'hi' },
      { type: 'done', stopReason: 'stop' },
    ]);
  });

  it('maps thinking blocks to thinking items', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([
        {
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'pondering' }] },
        },
        { type: 'result', subtype: 'success' },
      ]),
    });
    const items = await collect(turn);
    expect(items[0]).toEqual({ type: 'thinking', delta: 'pondering' });
  });

  it('maps tool_use blocks in a single assistant message to one tool_call_batch', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: "I'll read." },
              { type: 'tool_use', id: 'u1', name: 'fs_read', input: { path: 'a' } },
              { type: 'tool_use', id: 'u2', name: 'fs_read', input: { path: 'b' } },
            ],
          },
        },
        { type: 'result', subtype: 'success' },
      ]),
    });
    const items = await collect(turn);
    expect(items).toEqual([
      { type: 'text', delta: "I'll read." },
      {
        type: 'tool_call_batch',
        calls: [
          { id: 'u1', name: 'fs_read', input: { path: 'a' } },
          { id: 'u2', name: 'fs_read', input: { path: 'b' } },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    ]);
  });

  it('maps error_max_turns to stopReason=max_turns', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([{ type: 'result', subtype: 'error_max_turns' }]),
    });
    const items = await collect(turn);
    expect(items).toEqual([{ type: 'done', stopReason: 'max_turns' }]);
  });

  it('maps other error subtypes to stopReason=error with the error result', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([
        {
          type: 'result',
          subtype: 'error_during_execution',
          result: 'tool exploded',
        },
      ]),
    });
    const items = await collect(turn);
    expect(items).toEqual([{ type: 'done', stopReason: 'error', error: 'tool exploded' }]);
  });

  it('ignores unknown envelope types silently', async () => {
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([
        { type: 'system' },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'x' }] },
        },
        { type: 'result', subtype: 'success' },
      ]),
    });
    const items = await collect(turn);
    expect(items.map((i) => i.type)).toEqual(['text', 'done']);
  });

  it('preserves the provideToolResults callback on the returned object', async () => {
    const cb = async () => {};
    const turn = adaptSdkStreamToProviderTurn({
      stream: streamOf([{ type: 'result', subtype: 'success' }]),
      provideToolResults: cb,
    });
    expect((turn as { provideToolResults?: unknown }).provideToolResults).toBe(cb);
  });
});

describe('assistantMessageToReplayEvents', () => {
  it('produces ToolStart + ToolEnd pairs from resolved tool_use blocks', () => {
    const events = assistantMessageToReplayEvents(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Working.' },
            { type: 'tool_use', id: 'u1', name: 'fs_write', input: { path: 'a' } },
          ],
        },
      },
      new Map([['u1', { ok: true, result: 'wrote' }]]),
    );
    expect(events.map((e) => e.type)).toEqual(['text_chunk', 'tool_start', 'tool_end']);
    expect(events[2]).toMatchObject({
      type: 'tool_end',
      toolUseId: 'u1',
      ok: true,
      result: 'wrote',
    });
  });

  it('marks unresolved tool_use blocks as ok=false', () => {
    const events = assistantMessageToReplayEvents(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'u1', name: 'fs_read', input: {} }],
        },
      },
      new Map(),
    );
    expect(events[1]).toMatchObject({ type: 'tool_end', ok: false });
  });
});
