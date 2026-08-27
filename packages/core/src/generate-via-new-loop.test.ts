import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @ligma/providers BEFORE importing the subject. Both imports the
// dispatcher reaches for (streamViaClaudeCli + adaptSdkStreamToProviderTurn)
// need to return test-controlled async iterables so we can exercise the
// translation path without hitting the real claude CLI.
vi.mock('@ligma/providers', async (importOriginal) => {
  // Partial mock: the skill-injector helpers (filterActive /
  // formatSkillsForPrompt) are pure and must stay real, because the
  // dispatcher now composes the same system prompt the legacy path does.
  const actual = await importOriginal<typeof import('@ligma/providers')>();
  return {
    ...actual,
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
import { type NewLoopStreamEvent, generateViaNewLoop } from './generate-via-new-loop.js';
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

    // turn_start → text_delta → turn_end → error → agent_end. P33: exactly
    // ONE error event — translateEvent used to emit a second one for the same
    // failure, so the renderer showed the error twice.
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'turn_end',
      'error',
      'agent_end',
    ]);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent?.message).toContain('upstream blew up');
  });

  // P4 — this path used to send `[...history, prompt]` and nothing else, so
  // the model generated with none of the product's design brain.
  it('composes the system prompt, skills and context sections', async () => {
    vi.mocked(streamViaClaudeCli).mockResolvedValueOnce(
      iterable([
        { type: 'text', delta: 'ok' },
        { type: 'done', stopReason: 'stop' },
      ]) as unknown as Awaited<ReturnType<typeof streamViaClaudeCli>>,
    );

    await generateViaNewLoop(
      buildInput({
        designSystem: {
          schemaVersion: 1,
          rootPath: '/repo',
          summary: 'brandy',
          extractedAt: '2026-08-27T00:00:00.000Z',
          colors: ['#CC785C'],
          fonts: [],
          spacing: [],
          radius: [],
          shadows: [],
          sourceFiles: [],
        },
        attachments: [{ name: 'brief.md', path: '/repo/brief.md', excerpt: 'ship it' }],
      } as Partial<GenerateInput>),
      { sendAgentEvent: () => {} },
    );

    const sent = vi.mocked(streamViaClaudeCli).mock.calls[0]?.[0];
    const system = sent?.messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('You are ligma');
    expect(system?.content).toContain('# Available Skills');

    const user = sent?.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('Design system to follow');
    expect(user?.content).toContain('Attached local references');
    expect(user?.content).toContain('brief.md');
  });

  // P4 — a clean stop that produced no text is a truncated pipe, not an
  // empty answer. It used to return successfully with `message: ''`.
  it('treats a text-less clean stop as truncation', async () => {
    vi.mocked(streamViaClaudeCli).mockResolvedValueOnce(
      iterable([{ type: 'done', stopReason: 'stop' }]) as unknown as Awaited<
        ReturnType<typeof streamViaClaudeCli>
      >,
    );
    const events: NewLoopStreamEvent[] = [];
    await expect(
      generateViaNewLoop(buildInput(), { sendAgentEvent: (e) => events.push(e) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_STREAM_TRUNCATED' });
    expect(events.find((e) => e.type === 'error')?.code).toBe('PROVIDER_STREAM_TRUNCATED');
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
