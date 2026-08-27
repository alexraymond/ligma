import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clampSlide, isDeckInfoMessage, isDeckSlideMessage, withDeckNav } from './slide-nav';

const TEMPLATES = join(import.meta.dirname, '../../../../../design-templates');

describe('withDeckNav', () => {
  it('splices the bridge in before </body>', () => {
    const doc = withDeckNav(
      '<!doctype html><html><body><section class="slide">a</section></body></html>',
    );
    expect(doc.indexOf('LIGMA_DECK_NAV')).toBeGreaterThan(doc.indexOf('<section'));
    expect(doc.indexOf('LIGMA_DECK_NAV')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('appends when the document has no </body>', () => {
    expect(withDeckNav('<section class="slide">a</section>')).toContain('LIGMA_DECK_NAV');
  });

  it('is idempotent — a re-wrapped document keeps one bridge', () => {
    const once = withDeckNav('<body>x</body>');
    expect(withDeckNav(once)).toBe(once);
  });

  it("leaves a vendored deck's own markup untouched ahead of the splice", () => {
    const html = readFileSync(join(TEMPLATES, 'html-ppt-pitch-deck/example.html'), 'utf8');
    const doc = withDeckNav(html);
    expect(doc.slice(0, doc.indexOf('LIGMA_DECK_NAV'))).toContain(html.slice(0, 2000));
  });

  it('carries no </script> that would close its own tag early', () => {
    expect(withDeckNav('<body></body>').split('</script>')).toHaveLength(2);
  });
});

describe('clampSlide', () => {
  it('keeps the index inside the deck', () => {
    expect(clampSlide(-3, 5)).toBe(0);
    expect(clampSlide(9, 5)).toBe(4);
    expect(clampSlide(2, 5)).toBe(2);
  });

  it('is 0 for an empty deck rather than -1', () => {
    expect(clampSlide(0, 0)).toBe(0);
  });
});

describe('deck message guards', () => {
  it("accepts the bridge's own envelope", () => {
    expect(
      isDeckInfoMessage({
        __ligma: true,
        type: 'DECK_INFO',
        index: 0,
        slides: [{ title: 'Cover', notes: '' }],
      }),
    ).toBe(true);
    expect(isDeckSlideMessage({ __ligma: true, type: 'DECK_SLIDE', index: 3 })).toBe(true);
  });

  it('rejects anything else on the same channel', () => {
    expect(isDeckInfoMessage({ __ligma: true, type: 'ELEMENT_RECTS', entries: [] })).toBe(false);
    expect(isDeckInfoMessage({ type: 'DECK_INFO', index: 0, slides: [] })).toBe(false);
    expect(isDeckInfoMessage({ __ligma: true, type: 'DECK_INFO', index: 0, slides: 'nope' })).toBe(
      false,
    );
    expect(isDeckInfoMessage({ __ligma: true, type: 'DECK_INFO', slides: [] })).toBe(false);
    expect(isDeckSlideMessage({ __ligma: true, type: 'DECK_SLIDE' })).toBe(false);
    expect(isDeckInfoMessage(null)).toBe(false);
  });
});
