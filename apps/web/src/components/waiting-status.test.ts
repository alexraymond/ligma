import { TooltipProvider } from '@/components/ui/tooltip';
/**
 * `WaitingStatus` — the one waiting/staleness vocabulary (UX spec M8, mechanics F9).
 *
 * No jsdom/@testing-library in this app (vitest.config.ts — `environment:
 * "node"`), so this renders with `react-dom/server`'s `renderToStaticMarkup`,
 * same convention as `question-form.test.ts`, instead of adding a rendering
 * dependency for a handful of markup assertions.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONNECTING_TIMEOUT_MS,
  type WaitingState,
  WaitingStatus,
  connectingTimedOut,
  formatElapsed,
  formatStalled,
  waitingLabel,
} from './waiting-status';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

function markup(state: WaitingState, extra: { tip?: string } = {}) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(WaitingStatus, { state, now: NOW, ...extra }),
    ),
  );
}

describe('formatElapsed', () => {
  it('renders sub-minute elapsed honestly instead of rounding to 0m', () => {
    expect(formatElapsed(new Date(NOW - 30_000).toISOString(), NOW)).toBe('running <1m');
  });

  it('renders minutes under an hour', () => {
    expect(formatElapsed(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe('running 4m');
  });

  it("renders hours and minutes, and drops the minutes when they're zero", () => {
    expect(formatElapsed(new Date(NOW - 65 * 60_000).toISOString(), NOW)).toBe('running 1h 5m');
    expect(formatElapsed(new Date(NOW - 120 * 60_000).toISOString(), NOW)).toBe('running 2h');
  });
});

describe('formatStalled', () => {
  it('is honest with no last-seen timestamp', () => {
    expect(formatStalled(null, NOW)).toBe('stalled — no response');
    expect(formatStalled(undefined, NOW)).toBe('stalled — no response');
  });

  it("carries how long it's been silent when a last-seen timestamp exists", () => {
    expect(formatStalled(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe(
      'stalled — no response 12m',
    );
  });
});

describe('connectingTimedOut / waitingLabel — connecting never spins forever (mechanics F9)', () => {
  it('is not timed out just under the default timeout', () => {
    const state: WaitingState = {
      kind: 'connecting',
      since: new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS - 1)).toISOString(),
    };
    expect(connectingTimedOut(state, NOW)).toBe(false);
    expect(waitingLabel(state, NOW)).toBe('connecting…');
  });

  it('escalates past the default timeout', () => {
    const state: WaitingState = {
      kind: 'connecting',
      since: new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS + 1)).toISOString(),
    };
    expect(connectingTimedOut(state, NOW)).toBe(true);
    expect(waitingLabel(state, NOW)).toBe("couldn't connect");
  });

  it('honours a caller-supplied timeout', () => {
    const state: WaitingState = {
      kind: 'connecting',
      since: new Date(NOW - 2000).toISOString(),
      timeoutMs: 1000,
    };
    expect(connectingTimedOut(state, NOW)).toBe(true);
  });
});

describe('waitingLabel — the other states', () => {
  it('queued', () => {
    expect(waitingLabel({ kind: 'queued' }, NOW)).toBe('queued');
  });

  it('deferred reuses the shared resumeLabel copy (UX spec F5)', () => {
    expect(waitingLabel({ kind: 'deferred', resumeAt: null }, NOW)).toBe(
      'Deferred — resumes when a quota window opens',
    );
    const resumeAt = new Date(NOW).toISOString();
    expect(waitingLabel({ kind: 'deferred', resumeAt }, NOW)).toMatch(
      /^Deferred, resumes ~\d{2}:\d{2}$/,
    );
  });
});

describe('WaitingStatus markup', () => {
  it('renders the running state with elapsed text and a pulsing dot, no retry button', () => {
    const html = markup({ kind: 'running', since: new Date(NOW - 4 * 60_000).toISOString() });
    expect(html).toContain('running 4m');
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('<button');
  });

  it('renders connecting with a spinner and no retry before the timeout', () => {
    const html = markup({
      kind: 'connecting',
      since: new Date(NOW - 1000).toISOString(),
      onRetry: () => {},
    });
    expect(html).toContain('connecting');
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('<button');
  });

  it('escalates to a Retry button once connecting has timed out (mechanics F9)', () => {
    const html = markup({
      kind: 'connecting',
      since: new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS + 1)).toISOString(),
      onRetry: () => {},
    });
    expect(html).toContain('couldn&#x27;t connect');
    expect(html).toContain('<button');
    expect(html).toContain('Retry');
  });

  it('does not offer a retry button once timed out with no onRetry given', () => {
    const html = markup({
      kind: 'connecting',
      since: new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS + 1)).toISOString(),
    });
    expect(html).not.toContain('<button');
  });

  it("renders stalled in the amber malfunction tone, same as ExecutionPill's error class", () => {
    const html = markup({ kind: 'stalled', since: new Date(NOW - 12 * 60_000).toISOString() });
    expect(html).toContain('stalled — no response 12m');
    expect(html).toContain('amber');
  });

  it('carries an optional tooltip', () => {
    const html = markup({ kind: 'queued' }, { tip: 'Waiting for a run slot to open.' });
    expect(html).toContain('queued');
  });
});
