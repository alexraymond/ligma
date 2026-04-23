/**
 * End-to-end spine test: a mocked Claude-Agent SDK stream flows through
 * the W2 adapter into the agent loop and produces the expected
 * AgentEvent sequence. Confirms every seam (SDK shape → adapter →
 * orchestration → loop → event schema) speaks the same dialect.
 */

import { describe, expect, it } from 'vitest';
// NOTE: direct relative import into the providers package is intentional:
// `@open-codesign/providers` only re-exports its public barrel, and adding
// a subpath export would require modifying providers/package.json (W3
// territory). The e2e test is the one caller that needs the adapter from
// core; production code keeps the adapter consumption inside providers/.
import {
  type SdkStreamMessage,
  adaptSdkStreamToProviderTurn,
} from '../../../providers/src/claude-cli/sdk-to-agent-events.js';
import type { AgentEvent } from './events.js';
import { runTurn } from './loop.js';
import { makeFsWriteTool } from './tools/fs-write.js';
import { ToolRegistry } from './tools/index.js';

async function* stream(messages: SdkStreamMessage[]): AsyncGenerator<SdkStreamMessage> {
  for (const m of messages) yield m;
}

async function collect(gen: AsyncGenerator<AgentEvent, unknown>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) break;
    out.push(n.value);
  }
  return out;
}

describe('end-to-end: SDK stream -> adapter -> loop -> AgentEvent[]', () => {
  it('routes a single-turn text-only response correctly', async () => {
    const provider = adaptSdkStreamToProviderTurn({
      stream: stream([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'reasoning' },
              { type: 'text', text: 'Hello!' },
            ],
          },
        },
        { type: 'result', subtype: 'success', result: 'done' },
      ]),
    });
    const events = await collect(runTurn({ provider, tools: new ToolRegistry() }));
    expect(events.map((e) => e.type)).toEqual(['thinking_chunk', 'text_chunk', 'turn_done']);
    const done = events.at(-1);
    expect(done && done.type === 'turn_done' && done.stopReason).toBe('stop');
    expect(done && done.type === 'turn_done' && done.text).toBe('Hello!');
  });

  it('executes a tool_use block end-to-end via the real fs_write tool', async () => {
    const written = new Map<string, string>();
    let ackSeq = 0;
    const fsWrite = makeFsWriteTool(async (input) => {
      written.set(input.path, input.content);
      ackSeq += 1;
      return { schemaVersion: 1, seq: ackSeq, ok: true };
    });
    const registry = new ToolRegistry();
    registry.register(fsWrite);

    const provider = adaptSdkStreamToProviderTurn({
      stream: stream([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: "I'll write the file." },
              {
                type: 'tool_use',
                id: 'u1',
                name: 'fs_write',
                input: { path: 'index.html', content: '<p>hi</p>' },
              },
            ],
          },
        },
        { type: 'result', subtype: 'success' },
      ]),
    });

    const events = await collect(runTurn({ provider, tools: registry }));

    expect(events.map((e) => e.type)).toEqual([
      'text_chunk',
      'tool_start',
      'tool_end',
      'turn_done',
    ]);
    expect(written.get('index.html')).toBe('<p>hi</p>');
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd && toolEnd.type === 'tool_end' && toolEnd.ok).toBe(true);
  });

  it('propagates SDK error_during_execution to TurnDone stopReason=error', async () => {
    const provider = adaptSdkStreamToProviderTurn({
      stream: stream([{ type: 'result', subtype: 'error_during_execution', result: 'boom' }]),
    });
    const events = await collect(runTurn({ provider, tools: new ToolRegistry() }));
    const done = events.at(-1);
    expect(done && done.type === 'turn_done').toBe(true);
    expect(done && done.type === 'turn_done' && done.stopReason).toBe('error');
    expect(done && done.type === 'turn_done' && done.error).toBe('boom');
  });
});
