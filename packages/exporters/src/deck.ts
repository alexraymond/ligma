/**
 * Structural deck detection.
 *
 * Every deck template in `design-templates/` — the html-ppt family and its 36
 * themes, guizang-ppt, simple-deck, replit-deck, the landing deck — declares
 * exactly the same two markers, and nothing else does:
 *
 *  - `<section class="slide …">` at the top level of the deck container. The
 *    html-ppt runtime itself finds slides with `deck.querySelectorAll('.slide')`
 *    (`design-templates/html-ppt/assets/runtime.js`), so this is the contract
 *    the templates already keep, not a guess about the prose.
 *  - `class="notes"` inside a slide for speaker notes — `<aside class="notes">`,
 *    which every deck stylesheet hides with `.notes{display:none!important}`
 *    and only presenter mode reveals. Only the html-ppt family carries it;
 *    decks without notes simply report empty strings.
 *
 * Titles come from the `data-title` attribute the overview grid reads, falling
 * back to the slide's own first heading.
 */

export interface DeckSlide {
  /** `data-title`, else the first h1–h3, else empty. */
  title: string;
  /** The slide's inner HTML, speaker notes included. */
  html: string;
  /** Text of the slide's `.notes` element(s); empty when it declares none. */
  notes: string;
}

const SECTION_TAG_RE = /<(\/?)section\b([^>]*)>/gi;
const SLIDE_CLASS_RE = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
const DATA_TITLE_RE = /\bdata-title\s*=\s*("([^"]*)"|'([^']*)')/i;
const HEADING_RE = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i;
const NOTES_RE =
  /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*(?:"[^"]*\bnotes\b[^"]*"|'[^']*\bnotes\b[^']*')[^>]*>([\s\S]*?)<\/\1>/gi;

function attr(tag: string, re: RegExp): string | null {
  const m = re.exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? '';
}

function hasSlideClass(tag: string): boolean {
  const value = attr(tag, SLIDE_CLASS_RE);
  return value ? value.split(/\s+/).includes('slide') : false;
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text of every `.notes` element inside one slide, joined. */
export function slideNotes(fragment: string): string {
  const parts: string[] = [];
  NOTES_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NOTES_RE.exec(fragment)) !== null) {
    const note = text(m[2] ?? '');
    if (note) parts.push(note);
  }
  return parts.join('\n\n');
}

/** Everything but the `.notes` — what a slide actually shows an audience. */
export function withoutNotes(fragment: string): string {
  return fragment.replace(NOTES_RE, '');
}

/**
 * The slides of `html`, or `null` when it is not a deck.
 *
 * Depth-counted rather than pattern-sliced: a slide may nest `<section>`s of
 * its own, and the naive non-greedy match would cut the slide short at the
 * first inner `</section>`.
 */
export function deckSlides(html: string): DeckSlide[] | null {
  const slides: DeckSlide[] = [];
  let depth = 0;
  let openTag = '';
  let start = 0;

  SECTION_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_TAG_RE.exec(html)) !== null) {
    const closing = m[1] === '/';
    if (!closing) {
      if (depth === 0) {
        openTag = m[0];
        start = m.index + m[0].length;
      }
      depth += 1;
      continue;
    }
    if (depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || !hasSlideClass(openTag)) continue;
    const fragment = html.slice(start, m.index);
    const heading = HEADING_RE.exec(fragment);
    slides.push({
      title: attr(openTag, DATA_TITLE_RE) || (heading ? text(heading[1] ?? '') : ''),
      html: fragment,
      notes: slideNotes(fragment),
    });
  }

  return slides.length > 0 ? slides : null;
}
