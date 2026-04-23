import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @ligma/providers BEFORE importing the subject. Both imports the
// dispatcher reaches for (streamViaClaudeCli + adaptSdkStreamToProviderTurn)
// need to return test-controlled async iterables so we can exercise the
// translation path without hitting the real claude CLI.
vi.mock('@ligma/providers', async () => {
  return {
    streamViaClaudeCli: vi.fn(),
    adaptSdkStreamToProviderTurn: vi.fn(
      (opts: {
        stream: AsyncIterable<unknown>;
      }): AsyncIterable<unknown> => ({
        [Symbol.asyncIterator]() {
          return opts.stream[Symbol.asyncIterator]();
        },
      }),
    ),
  };
});

import { streamViaClaudeCli } from '@ligma/providers';
import { generateViaNewLoop, type NewLoopStreamEvent } from './generate-via-new-loop.js';
import type { GenerateInput } from './index.js';

type ProviderItem =
  | { type: 'text'; delta: string }
  | { type: 'done'; stopReason: 'stop' | 'max_turns' | 'error'; error?: string };

function iterable(items: ProviderItem[]): AsyncIterable<ProviderItem> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function buildInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    prompt: 'hello',
    history: [],
    model: { provider: 'claude-max', modelId: 'claude-sonnet-4-5' },
    apiKey: '',
    wire: 'claude-cli',
    useNewLoop: true,
    ...overrides,
  } as GenerateInput;
}

describe('generateViaNewLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits turn_start, text_delta, turn_end, agent_end on a successful stream', async () => {
    vi.mocked(streamViaClaudeCli).mockResolvedValueOnce(
      iterable([
        { type: 'text', delta: 'Hel' },
        { type: 'text', delta: 'lo!' },
        { type: 'done', stopReason: 'stop' },
      ]) as unknown as Awaited<ReturnType<typeof streamViaClaudeCli>>,
    );

    const events: NewLoopStreamEvent[] = [];
    const result = await generateViaNewLoop(buildInput(), {
      sendAgentEvent: (e) => events.push(e),
      designId: 'design-1',
      generationId: 'gen-1',
    });

    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'text_delta',
      'turn_end',
      'agent_end',
    ]);
    expect(events[1]?.delta).toBe('Hel');
    expect(events[2]?.delta).toBe('lo!');
    expect(events[3]?.finalText).toBe('Hello!');
    expect(events.every((e) => e.designId === 'design-1')).toBe(true);
    expect(events.every((e) => e.generationId === 'gen-1')).toBe(true);

    expect(result).toEqual({
      message: 'Hello!',
      artifacts: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });

  it('maps stopReason=error to an error event and throws', async () => {
    vi.mocked(streamViaClaudeCli).mockResolvedValueOnce(
      iterable([
        { type: 'text', delta: 'partial' },
        { type: 'done', stopReason: 'error', error: 'upstream blew up' },
      ]) as unknown as Awaited<ReturnType<typeof streamViaClaudeCli>>,
    );

    const events: NewLoopStreamEvent[] = [];
    await expect(
      generateViaNewLoop(buildInput(), {
        sendAgentEvent: (e) => events.push(e),
      }),
    ).rejects.toThrow(/upstream blew up/);

    // turn_start → text_delta → turn_end (error) → inline error event from
    // translateEvent → top-level error event from the stopReason branch →
    // agent_end. We check the set of event types fired rather than the exact
    // ordering so a tweak to the error-emit ordering doesn't cause churn.
    expect(events.map((e) => e.type)).toContain('error');
    expect(events.map((e) => e.type)).toContain('agent_end');
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent?.message).toContain('upstream blew up');
  });

  it('rejects when the wire is not claude-cli', async () => {
    const events: NewLoopStreamEvent[] = [];
    await expect(
      generateViaNewLoop(buildInput({ wire: 'anthropic' }), {
        sendAgentEvent: (e) => events.push(e),
      }),
    ).rejects.toThrow(/claude-cli/);
  });

  it('rejects an empty prompt before touching the provider', async () => {
    await expect(
      generateViaNewLoop(buildInput({ prompt: '   ' }), {
        sendAgentEvent: () => {},
      }),
    ).rejects.toThrow(/empty/i);
    expect(streamViaClaudeCli).not.toHaveBeenCalled();
  });

  it('surfaces streamViaClaudeCli failures as error events and re-throws', async () => {
    vi.mocked(streamViaClaudeCli).mockRejectedValueOnce(new Error('cli not found'));
    const events: NewLoopStreamEvent[] = [];
    await expect(
      generateViaNewLoop(buildInput(), {
        sendAgentEvent: (e) => events.push(e),
      }),
    ).rejects.toThrow(/cli not found/);
    // turn_start fires before the stream open attempt; error fires when it
    // fails. agent_end is NOT emitted here — the caller's finally block
    // in the desktop dispatcher owns cleanup.
    expect(events.map((e) => e.type)).toEqual(['turn_start', 'error']);
  });
});
