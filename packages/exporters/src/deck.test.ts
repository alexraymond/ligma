import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckSlides } from './deck';

/** The vendored upstream templates are the fixture — detection is derived from them. */
const TEMPLATES = join(import.meta.dirname, '../../../design-templates');
const template = (rel: string): string => readFileSync(join(TEMPLATES, rel), 'utf8');

describe('deckSlides', () => {
  it('finds every slide in a vendored html-ppt deck', () => {
    const slides = deckSlides(template('html-ppt-pitch-deck/example.html'));
    expect(slides).not.toBeNull();
    expect(slides).toHaveLength(10);
    expect(slides?.map((s) => s.title)).toEqual([
      'Cover',
      'Problem',
      'Solution',
      'Product',
      'Market',
      'Business Model',
      'Traction',
      'Team',
      'The Ask',
      'Thanks',
    ]);
  });

  it('reads speaker notes off the aside.notes the templates declare', () => {
    const slides = deckSlides(template('html-ppt/templates/deck.html'));
    expect(slides).not.toBeNull();
    expect(slides?.some((s) => s.notes.length > 0)).toBe(true);
  });

  it('handles the single-quoted markup of the landing deck', () => {
    const slides = deckSlides(template('open-design-landing-deck/example.html'));
    expect(slides?.length).toBeGreaterThan(1);
  });

  it('handles scroll decks that carry no data-title', () => {
    const slides = deckSlides(template('simple-deck/example.html'));
    expect(slides?.length).toBeGreaterThan(1);
    expect(slides?.[0]?.title).not.toBe('');
  });

  it('titles a slide from its own heading when data-title is absent', () => {
    const slides = deckSlides('<section class="slide"><h1>Hello</h1></section>');
    expect(slides).toEqual([{ title: 'Hello', html: '<h1>Hello</h1>', notes: '' }]);
  });

  it('prefers the declared data-title over the heading', () => {
    const slides = deckSlides('<section class="slide" data-title="Cover"><h1>Hello</h1></section>');
    expect(slides?.[0]?.title).toBe('Cover');
  });

  it('keeps nested sections inside their slide', () => {
    const slides = deckSlides(
      '<section class="slide"><section class="inner">a</section></section><section class="slide">b</section>',
    );
    expect(slides).toHaveLength(2);
    expect(slides?.[0]?.html).toBe('<section class="inner">a</section>');
  });

  it('ignores sections whose class merely contains "slide" as a substring', () => {
    expect(deckSlides('<section class="slideshow">x</section>')).toBeNull();
  });

  it('is null for a page that declares no slides', () => {
    expect(deckSlides('<section><h1>One</h1></section><section><h2>Two</h2></section>')).toBeNull();
    expect(deckSlides('<h1>Solo</h1>')).toBeNull();
  });
});
