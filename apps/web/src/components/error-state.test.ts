/**
 * `ErrorState` — the one plain-fetch-failure presentation (mechanics F18,
 * walkthrough m2). No jsdom/@testing-library in this app (vitest.config.ts —
 * `environment: "node"`), so this renders with `react-dom/server`'s
 * `renderToStaticMarkup`, same convention as `question-form.test.ts`.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './error-state';

function markup(props: Parameters<typeof ErrorState>[0]) {
  return renderToStaticMarkup(createElement(ErrorState, props));
}

describe('ErrorState — legacy message/compact props keep working (Wave 1: no existing call site changes)', () => {
  it('renders the historical default heading and message text with no props', () => {
    const html = markup({});
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Failed to load data. Please try again.');
  });

  it("renders a caller's raw message as the body, under the default heading", () => {
    const html = markup({ message: 'ECONNREFUSED' });
    expect(html).toContain('Something went wrong');
    expect(html).toContain('ECONNREFUSED');
  });

  it('compact=true still yields the compact sizing classes', () => {
    const html = markup({ message: 'x', compact: true });
    expect(html).toContain('py-6');
    expect(html).not.toContain('py-12');
  });

  it('compact=false (default) yields full sizing', () => {
    const html = markup({ message: 'x' });
    expect(html).toContain('py-12');
  });

  it('renders a retry button only when onRetry is given', () => {
    expect(markup({ message: 'x' })).not.toContain('<button');
    expect(markup({ message: 'x', onRetry: vi.fn() })).toContain('Try again');
  });
});

describe('ErrorState — new title/detail/variant API (honest wording, walkthrough m2)', () => {
  it("an explicit title replaces the generic 'Something went wrong'", () => {
    const html = markup({ title: "Couldn't load runs" });
    expect(html).toContain('Couldn&#x27;t load runs');
    expect(html).not.toContain('Something went wrong');
  });

  it("a title with no detail renders no body paragraph — honest absence isn't dressed up with filler text", () => {
    const html = markup({ title: "Couldn't load runs" });
    expect(html).not.toContain('Failed to load data');
  });

  it('detail renders as supplementary text under an explicit title', () => {
    const html = markup({ title: "Couldn't load runs", detail: 'The daemon is unreachable.' });
    expect(html).toContain('Couldn&#x27;t load runs');
    expect(html).toContain('The daemon is unreachable.');
  });

  it("variant='compact' matches the legacy compact=true sizing", () => {
    expect(markup({ title: 't', variant: 'compact' })).toContain('py-6');
  });

  it('variant overrides a conflicting legacy compact value', () => {
    const html = markup({ title: 't', compact: true, variant: 'full' });
    expect(html).toContain('py-12');
    expect(html).not.toContain('py-6');
  });
});
