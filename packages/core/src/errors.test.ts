import { LigmaError } from '@ligma/shared';
import { describe, expect, it } from 'vitest';
import { remapProviderError, rewriteUpstreamMessage } from './errors';

const LEAKED =
  'Incorrect API key provided: sk-AAA. You can find your API key at https://platform.openai.com/account/api-keys.';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('rewriteUpstreamMessage', () => {
  it('keeps openai URL when active provider is openai', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'openai', 401);
    expect(result.rewritten).toBe(false);
    expect(result.message).toContain('platform.openai.com/account/api-keys');
  });

  it('rewrites leaked openai URL to anthropic billing URL', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'anthropic', 401);
    expect(result.rewritten).toBe(true);
    expect(result.message).not.toContain('openai.com');
    expect(result.message).toContain('console.anthropic.com/settings/keys');
  });

  it('rewrites leaked openai URL to openrouter URL', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'openrouter', 401);
    expect(result.message).toContain('openrouter.ai/settings/keys');
  });

  it('rewrites to deepseek URL even though it is not in the typed enum', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'deepseek', 401);
    expect(result.message).toContain('platform.deepseek.com/api_keys');
  });

  it('strips URL and adds generic hint for unknown providers', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'mystery-llm', 401);
    expect(result.rewritten).toBe(true);
    expect(result.message).not.toContain('openai.com');
    expect(result.message).toContain("Check your provider's API key settings");
  });

  it('does not rewrite 5xx errors', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'anthropic', 503);
    expect(result.rewritten).toBe(false);
  });

  it('does not rewrite when no openai URL is present', () => {
    const result = rewriteUpstreamMessage('Bad request: model not found', 'anthropic', 400);
    expect(result.rewritten).toBe(false);
  });
});

describe('remapProviderError', () => {
  it('passes openai 401 through verbatim', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'openai');
    expect(out).toBe(err);
  });

  it('rewrites anthropic 401 with leaked openai URL into a LigmaError', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBeInstanceOf(LigmaError);
    expect((out as LigmaError).message).toContain('console.anthropic.com/settings/keys');
    expect((out as LigmaError).message).not.toContain('openai.com');
    expect((out as LigmaError).code).toBe('PROVIDER_HTTP_4XX');
  });

  it('strips the URL when provider is unknown', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'mystery-llm');
    expect(out).toBeInstanceOf(LigmaError);
    expect((out as LigmaError).message).not.toContain('openai.com');
    expect((out as LigmaError).message).toContain("Check your provider's API key settings");
  });

  it('passes 5xx errors through unchanged', () => {
    const err = httpError(503, 'upstream unavailable');
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBe(err);
  });

  // P8 — the status now travels on the error, not inside its prose. A
  // LigmaError raised at a boundary that knew the status carries it.
  it('uses the status carried on a LigmaError', () => {
    const err = new LigmaError(
      'see https://platform.openai.com/account/api-keys',
      'PROVIDER_ERROR',
      { status: 401 },
    );
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBeInstanceOf(LigmaError);
    expect((out as LigmaError).message).toContain('console.anthropic.com/settings/keys');
  });

  it('does not scrape a status out of message prose', () => {
    // "512" is a token count, not an HTTP status — scraping it used to rewrite
    // a message that had nothing to do with API keys.
    const err = new LigmaError(
      'exceeded 512 tokens — see https://platform.openai.com/account/api-keys',
      'PROVIDER_ERROR',
    );
    expect(remapProviderError(err, 'anthropic')).toBe(err);
  });
});
