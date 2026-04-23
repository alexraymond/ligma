/**
 * Live integration test for the Claude CLI adapter. Skipped unless
 * LIVE_CLAUDE_CLI=1 is set because it spawns a real Claude Code SDK call
 * against the user's local subscription (~7s, real tokens/cost).
 *
 * Run with:
 *   LIVE_CLAUDE_CLI=1 pnpm --filter @open-codesign/providers test sdk-runtime.live
 */

import { describe, expect, it } from 'vitest';
import { completeViaClaudeCli } from './sdk-runtime';

const live = process.env['LIVE_CLAUDE_CLI'] === '1' ? describe : describe.skip;

live('completeViaClaudeCli (live, subscription auth)', () => {
  it('returns a text reply from the subscription auth path', async () => {
    const result = await completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: 'You are a terse oracle. Reply with one word.' },
        { role: 'user', content: 'Return exactly the word PING and nothing else.' },
      ],
    });
    expect(result.content.toUpperCase()).toContain('PING');
    expect(result.outputTokens).toBeGreaterThan(0);
  }, 60_000);

  it('honors AbortSignal', async () => {
    const controller = new AbortController();
    const promise = completeViaClaudeCli({
      modelId: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'Write a 500-word essay about the history of typography.' },
      ],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    await expect(promise).rejects.toThrow();
  }, 30_000);
});
