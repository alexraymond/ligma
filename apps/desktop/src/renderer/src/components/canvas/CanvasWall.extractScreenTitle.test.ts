import { describe, expect, it } from 'vitest';
import { extractScreenTitle } from './CanvasWall';

describe('extractScreenTitle', () => {
  it('returns null when no convention is present', () => {
    expect(extractScreenTitle('<div>plain</div>')).toBeNull();
    expect(extractScreenTitle('')).toBeNull();
  });

  it('reads data-screen-title from the JSX path', () => {
    const src = 'function App() { return <div data-screen-title="Dashboard">…</div>; }';
    expect(extractScreenTitle(src)).toBe('Dashboard');
  });

  it('reads data-screen-title with single quotes', () => {
    const src = "<section data-screen-title='Sign Up'>…</section>";
    expect(extractScreenTitle(src)).toBe('Sign Up');
  });

  it('falls back to the meta-tag convention for full HTML', () => {
    const src =
      '<!doctype html><meta name="ligma:screen-title" content="Onboarding · Step 2"><body></body>';
    expect(extractScreenTitle(src)).toBe('Onboarding · Step 2');
  });

  it('prefers data-screen-title over the meta tag when both exist', () => {
    const src =
      '<meta name="ligma:screen-title" content="From Meta"><div data-screen-title="From Data">…</div>';
    expect(extractScreenTitle(src)).toBe('From Data');
  });

  it('caps title length at the regex bound (defends against HTML injection runaways)', () => {
    const long = 'a'.repeat(200);
    const src = `<div data-screen-title="${long}">…</div>`;
    // Bound is 80 chars in the regex; over-length attribute fails the match.
    expect(extractScreenTitle(src)).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const src = '<div data-screen-title="  Dashboard  ">…</div>';
    expect(extractScreenTitle(src)).toBe('Dashboard');
  });
});
