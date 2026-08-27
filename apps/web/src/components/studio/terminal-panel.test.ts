/**
 * TerminalPanel's pure logic: bounding the transcript buffer, and the
 * `connecting` badge's wiring into `WaitingStatus` (walkthrough M8 — the
 * Terminal used to say `connecting…` forever with no escalation). DOM-free,
 * same convention as `studio/api.test.ts` — no rendering, except the one
 * markup check below which follows `waiting-status.test.ts`'s
 * `renderToStaticMarkup` convention (no jsdom in this app's vitest config).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DEFAULT_CONNECTING_TIMEOUT_MS,
  WaitingStatus,
  connectingTimedOut,
} from '@/components/waiting-status';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MAX_BUFFER_CHARS, appendOutput, connectingWaitingState } from './terminal-panel';

const SOURCE = readFileSync(path.resolve(__dirname, './terminal-panel.tsx'), 'utf-8');

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

describe('appendOutput', () => {
  it('concatenates under the limit', () => {
    expect(appendOutput('a', 'b')).toBe('ab');
  });

  it('trims from the front once the buffer exceeds the cap', () => {
    const huge = 'x'.repeat(MAX_BUFFER_CHARS);
    const result = appendOutput(huge, 'TAIL');
    expect(result.length).toBe(MAX_BUFFER_CHARS);
    expect(result.endsWith('TAIL')).toBe(true);
  });
});

describe('connectingWaitingState — the M8 fix wired, not just built', () => {
  it("carries the retry callback so a session that never opens isn't a dead-end spinner", () => {
    const onRetry = vi.fn();
    const since = new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS + 1)).toISOString();
    const state = connectingWaitingState(since, onRetry);

    expect(state.kind).toBe('connecting');
    expect(connectingTimedOut(state as Extract<typeof state, { kind: 'connecting' }>, NOW)).toBe(
      true,
    );

    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(WaitingStatus, { state, now: NOW })),
    );
    expect(html).toContain('couldn&#x27;t connect');
    expect(html).toContain('Retry');
  });

  it('shows no retry affordance before the shared timeout', () => {
    const state = connectingWaitingState(new Date(NOW - 1000).toISOString(), vi.fn());
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(WaitingStatus, { state, now: NOW })),
    );
    expect(html).toContain('connecting');
    expect(html).not.toContain('Retry');
  });
});

// W11: `submit()` used to clear the input immediately, before the send
// resolved, and had no catch — a failed send silently lost whatever the user
// typed with no error shown.
describe('submit — keeps the line and reports failure (W11)', () => {
  const body = SOURCE.slice(
    SOURCE.indexOf('const submit = async'),
    SOURCE.indexOf('const stopped ='),
  );

  it('only clears the input after a successful send', () => {
    const sendCall = body.indexOf('await sendTerminalInput(projectId, id, line);');
    const clearCall = body.indexOf("setInput('');");
    expect(sendCall).toBeGreaterThan(-1);
    expect(clearCall).toBeGreaterThan(sendCall);
  });

  it('shows an error toast instead of swallowing a failed send', () => {
    expect(body).toContain('} catch (err) {');
    expect(body).toContain(
      "showError(err instanceof Error ? err.message : 'Failed to send to the terminal');",
    );
  });
});
