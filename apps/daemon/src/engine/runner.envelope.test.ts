/**
 * Token usage, as the three CLIs actually report it.
 *
 * Each fixture below is the shape a real installed binary emits — verified
 * against claude 2.1.232, a codex rollout record, and gemini-cli 0.30's own
 * `JsonFormatter` + `uiTelemetry` metrics — not a shape we hope they use. That
 * is the point of pinning them: when a CLI moves its usage block, this test
 * fails loudly instead of the ledger quietly filling up with nulls.
 */
import { describe, expect, it } from 'vitest';
import { parseEnvelopeUsage } from './runner';

describe('parseEnvelopeUsage — claude', () => {
  // `claude -p --output-format json`: one object, `type: "result"`, Anthropic's
  // own usage block.
  const envelope = (usage: Record<string, number>) =>
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 4210,
      num_turns: 3,
      total_cost_usd: 0.031,
      result: 'done',
      usage,
    });

  it('reads input_tokens and output_tokens', () => {
    expect(
      parseEnvelopeUsage('claude', envelope({ input_tokens: 120, output_tokens: 340 })),
    ).toEqual({
      tokensIn: 120,
      tokensOut: 340,
    });
  });

  it('counts cache reads and writes as input — they are tokens that were read', () => {
    const usage = {
      input_tokens: 120,
      output_tokens: 340,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 5000,
    };
    // 120 + 1000 + 5000. Dropping the cache fields would under-report a cached
    // run by ~50x, which is the difference between "cheap" and "the window".
    expect(parseEnvelopeUsage('claude', envelope(usage))).toEqual({
      tokensIn: 6120,
      tokensOut: 340,
    });
  });

  it('finds the result event inside a JSONL stream', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
      envelope({ input_tokens: 7, output_tokens: 9 }),
    ].join('\n');
    expect(parseEnvelopeUsage('claude', stream)).toEqual({ tokensIn: 7, tokensOut: 9 });
  });

  it('reports nulls for the fake-claude envelope, which carries no usage at all', () => {
    // scripts/acceptance/fake-claude.mjs emits exactly this. A drill must not
    // manufacture token numbers.
    const drill = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      result: 'x',
    });
    expect(parseEnvelopeUsage('claude', drill)).toEqual({ tokensIn: null, tokensOut: null });
  });
});

describe('parseEnvelopeUsage — codex', () => {
  // `codex exec --json`: an event stream whose `token_count` event carries a
  // CUMULATIVE `info.total_token_usage`.
  const tokenCount = (input: number, output: number, wrapper: 'bare' | 'msg' | 'payload') => {
    const event = {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: Math.floor(input / 2),
          output_tokens: output,
          reasoning_output_tokens: 12,
          total_tokens: input + output,
        },
        last_token_usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    if (wrapper === 'bare') return JSON.stringify(event);
    return JSON.stringify(
      wrapper === 'msg' ? { id: '0', msg: event } : { type: 'event_msg', payload: event },
    );
  };

  it.each(['bare', 'msg', 'payload'] as const)(
    'reads total_token_usage nested under %s',
    (wrapper) => {
      expect(parseEnvelopeUsage('codex', tokenCount(4089, 678, wrapper))).toEqual({
        tokensIn: 4089,
        tokensOut: 678,
      });
    },
  );

  it('takes the LAST token_count — the counts are cumulative, not per-turn', () => {
    const stream = [tokenCount(100, 10, 'msg'), tokenCount(900, 90, 'msg')].join('\n');
    expect(parseEnvelopeUsage('codex', stream)).toEqual({ tokensIn: 900, tokensOut: 90 });
  });

  it('reports nulls when the stream never emitted a token_count', () => {
    const stream = [JSON.stringify({ msg: { type: 'agent_message', message: 'hi' } })].join('\n');
    expect(parseEnvelopeUsage('codex', stream)).toEqual({ tokensIn: null, tokensOut: null });
  });
});

describe('parseEnvelopeUsage — gemini', () => {
  // `gemini --output-format json`: JsonFormatter's {session_id, response, stats},
  // stats being uiTelemetry's per-model metrics.
  const model = (prompt: number, candidates: number) => ({
    api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 900 },
    tokens: {
      input: prompt,
      prompt,
      candidates,
      total: prompt + candidates,
      cached: 0,
      thoughts: 0,
      tool: 0,
    },
    roles: {},
  });

  it('reads prompt as input and candidates as output', () => {
    const out = JSON.stringify({
      session_id: 's1',
      response: 'done',
      stats: { models: { 'gemini-2.5-pro': model(500, 60) } },
    });
    expect(parseEnvelopeUsage('gemini', out)).toEqual({ tokensIn: 500, tokensOut: 60 });
  });

  it('sums across models — a run may switch model mid-flight', () => {
    const out = JSON.stringify({
      stats: { models: { 'gemini-2.5-pro': model(500, 60), 'gemini-2.5-flash': model(100, 5) } },
    });
    expect(parseEnvelopeUsage('gemini', out)).toEqual({ tokensIn: 600, tokensOut: 65 });
  });

  it('reports nulls when the reply carries no stats', () => {
    expect(
      parseEnvelopeUsage('gemini', JSON.stringify({ session_id: 's1', response: 'done' })),
    ).toEqual({
      tokensIn: null,
      tokensOut: null,
    });
  });
});

describe('parseEnvelopeUsage — nothing to read', () => {
  it.each(['', '   ', 'not json at all', '{broken'])(
    'returns nulls for %j rather than throwing',
    (stdout) => {
      expect(parseEnvelopeUsage('claude', stdout)).toEqual({ tokensIn: null, tokensOut: null });
    },
  );

  it('never invents a count from output length', () => {
    // The failure mode this whole module exists to prevent: a plausible number
    // is indistinguishable from a measured one once it is in the ledger.
    const prose = 'a'.repeat(50_000);
    expect(parseEnvelopeUsage('claude', prose)).toEqual({ tokensIn: null, tokensOut: null });
  });
});
