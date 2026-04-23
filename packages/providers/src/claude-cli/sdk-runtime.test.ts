/**
 * Unit tests for the Claude CLI SDK adapter.
 *
 * Exercises: executable path prewarm (single `which claude` invocation per
 * process), parameterised path injection, tool allow-list passthrough,
 * stream-truncation detection, and heartbeat warn. The live subscription
 * path is covered by sdk-runtime.live.test.ts (gated on LIVE_CLAUDE_CLI=1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => {
  const execFileSync = vi.fn((_cmd: string, args: readonly string[]) => {
    if (args[0] === 'claude') return '/mock/bin/claude\n';
    return '';
  });
  return { execFileSync };
});

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}));

import { execFileSync } from 'node:child_process';
import {
  completeViaClaudeCli,
  prewarmClaudeExecutable,
  resolveClaudeExecutableForTest,
} from './sdk-runtime';

async function* stream<T>(items: Iterable<T>): AsyncIterable<T> {
  for (const item of items) yield item;
}

function assistantEvent(text: string) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  };
}

function resultEvent(subtype: 'success' | 'error_during_execution' = 'success') {
  return {
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    usage: { input_tokens: 1, output_tokens: 2 },
    total_cost_usd: 0,
  };
}

describe('prewarmClaudeExecutable', () => {
  beforeEach(() => {
    resolveClaudeExecutableForTest.reset();
    vi.mocked(execFileSync).mockClear();
  });

  it('resolves `claude` via `which` exactly once across repeated calls', () => {
    prewarmClaudeExecutable();
    prewarmClaudeExecutable();
    prewarmClaudeExecutable();
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith('which', ['claude'], expect.any(Object));
  });

  it('returns the resolved path', () => {
    const path = prewarmClaudeExecutable();
    expect(path).toBe('/mock/bin/claude');
  });

  it('returns null when `which` throws', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(prewarmClaudeExecutable()).toBeNull();
  });
});

describe('completeViaClaudeCli — parameterised path', () => {
  beforeEach(() => {
    resolveClaudeExecutableForTest.reset();
    vi.mocked(execFileSync).mockClear();
    queryMock.mockReset();
  });

  it('uses the caller-supplied executable path without calling `which`', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('hello'), resultEvent()]));
    const result = await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'ping' }],
      claudePath: '/custom/bin/claude',
    });
    expect(execFileSync).not.toHaveBeenCalled();
    expect(result.content).toBe('hello');
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: { pathToClaudeCodeExecutable: string };
    };
    expect(callArgs.options.pathToClaudeCodeExecutable).toBe('/custom/bin/claude');
  });

  it('forwards allowedTools default of [] when not specified', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('hi'), resultEvent()]));
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: { allowedTools: string[] };
    };
    expect(callArgs.options.allowedTools).toEqual([]);
  });

  it('forwards allowedTools when supplied', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('hi'), resultEvent()]));
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
      allowedTools: ['str_replace_editor', 'bash'],
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: { allowedTools: string[] };
    };
    expect(callArgs.options.allowedTools).toEqual(['str_replace_editor', 'bash']);
  });

  it('forwards cwd and additionalDirectories when supplied', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('ok'), resultEvent()]));
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
      cwd: '/Users/alice/project',
      additionalDirectories: ['/etc/config', '/var/shared'],
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: { cwd?: string; additionalDirectories?: string[] };
    };
    expect(callArgs.options.cwd).toBe('/Users/alice/project');
    expect(callArgs.options.additionalDirectories).toEqual(['/etc/config', '/var/shared']);
  });

  it('omits cwd / additionalDirectories from options when not supplied', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('ok'), resultEvent()]));
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: Record<string, unknown>;
    };
    expect('cwd' in callArgs.options).toBe(false);
    expect('additionalDirectories' in callArgs.options).toBe(false);
    expect('canUseTool' in callArgs.options).toBe(false);
  });

  it('adapts canUseTool: forwards tool name + input to host callback, returns SDK allow shape', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('ok'), resultEvent()]));
    const hostCallback = vi.fn().mockResolvedValue({
      requestId: 'ignored-by-sdk',
      behavior: 'allow',
    });
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
      canUseTool: hostCallback,
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: {
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
          options: { signal: AbortSignal; toolUseID: string },
        ) => Promise<{ behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown> }>;
      };
    };
    expect(typeof callArgs.options.canUseTool).toBe('function');
    const result = await callArgs.options.canUseTool(
      'Read',
      { path: '/some/file' },
      { signal: new AbortController().signal, toolUseID: 'tu_1' },
    );
    expect(hostCallback).toHaveBeenCalledTimes(1);
    const hostArg = hostCallback.mock.calls[0]?.[0] as {
      toolName: string;
      input: { path: string };
      requestId: string;
    };
    expect(hostArg.toolName).toBe('Read');
    expect(hostArg.input).toEqual({ path: '/some/file' });
    expect(typeof hostArg.requestId).toBe('string');
    expect(hostArg.requestId.length).toBeGreaterThan(0);
    expect(result).toEqual({ behavior: 'allow', updatedInput: { path: '/some/file' } });
  });

  it('adapts canUseTool: deny decision becomes SDK deny with message', async () => {
    queryMock.mockReturnValue(stream([assistantEvent('ok'), resultEvent()]));
    const hostCallback = vi.fn().mockResolvedValue({
      requestId: 'r1',
      behavior: 'deny',
      message: 'User declined to grant /etc/shadow access.',
    });
    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      claudePath: '/custom/bin/claude',
      canUseTool: hostCallback,
    });
    const callArgs = queryMock.mock.calls[0]?.[0] as {
      options: {
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
          options: { signal: AbortSignal; toolUseID: string },
        ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;
      };
    };
    const result = await callArgs.options.canUseTool(
      'Bash',
      { command: 'cat /etc/shadow' },
      { signal: new AbortController().signal, toolUseID: 'tu_2' },
    );
    expect(result).toEqual({
      behavior: 'deny',
      message: 'User declined to grant /etc/shadow access.',
    });
  });
});

describe('completeViaClaudeCli — stream validation', () => {
  beforeEach(() => {
    resolveClaudeExecutableForTest.reset();
    vi.mocked(execFileSync).mockClear();
    queryMock.mockReset();
  });

  it('throws PROVIDER_STREAM_TRUNCATED when no assistant event arrives', async () => {
    queryMock.mockReturnValue(stream([resultEvent()]));
    await expect(
      completeViaClaudeCli({
        modelId: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'ping' }],
        claudePath: '/mock/bin/claude',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_STREAM_TRUNCATED' });
  });

  it('throws PROVIDER_STREAM_TRUNCATED when assistant blocks contain no text', async () => {
    const emptyAssistant = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use' }] },
    };
    queryMock.mockReturnValue(stream([emptyAssistant, resultEvent()]));
    await expect(
      completeViaClaudeCli({
        modelId: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'ping' }],
        claudePath: '/mock/bin/claude',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_STREAM_TRUNCATED' });
  });

  it('throws PROVIDER_STREAM_TRUNCATED when the stream is empty', async () => {
    queryMock.mockReturnValue(stream([] as unknown as Iterable<never>));
    await expect(
      completeViaClaudeCli({
        modelId: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'ping' }],
        claudePath: '/mock/bin/claude',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_STREAM_TRUNCATED' });
  });
});

describe('completeViaClaudeCli — heartbeat', () => {
  beforeEach(() => {
    resolveClaudeExecutableForTest.reset();
    vi.mocked(execFileSync).mockClear();
    queryMock.mockReset();
  });

  it('logs a warn through the injected logger when no event arrives within the heartbeat window', async () => {
    const warn = vi.fn();
    const logger = { warn };

    // Generator that takes real time on the first .next() — long enough for
    // a 10ms heartbeat interval to tick, then yields and completes.
    async function* slowStream(): AsyncIterable<unknown> {
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      yield assistantEvent('late reply');
      yield resultEvent();
    }
    queryMock.mockReturnValue(slowStream());

    await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'ping' }],
      claudePath: '/mock/bin/claude',
      logger,
      heartbeatMs: 10,
    });

    expect(warn).toHaveBeenCalledWith(
      'claude-cli.stream.heartbeat',
      expect.objectContaining({ sinceLastEventMs: expect.any(Number) }),
    );
  });
});
