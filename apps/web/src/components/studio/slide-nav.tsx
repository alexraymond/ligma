'use client';

/**
 * Slide navigation for deck artifacts.
 *
 * A deck is not a longer page — it is N screens stacked in one document, and
 * `design-templates/` says so structurally: every deck template declares
 * `<section class="slide">`, the html-ppt runtime finds its slides with
 * `deck.querySelectorAll('.slide')`, and speaker notes live in an
 * `<aside class="notes">` that every deck stylesheet hides with
 * `.notes{display:none!important}`. Those two markers are the whole contract.
 *
 * The preview iframe is `sandbox="allow-scripts"` with no `allow-same-origin`,
 * so its document is opaque: the host cannot read `contentDocument`, count the
 * slides, or scroll one into view. Everything here therefore rides the same
 * `__ligma` postMessage channel the pin overlay already uses (studio map
 * §1) — a bridge script spliced into the srcdoc reports the deck it can see and
 * takes `GOTO_SLIDE` back. That is also why nothing in the host parses the HTML
 * for slides: the document is right there, in a DOM, on the other side of one
 * message.
 *
 * Where a template ships its own runtime the bridge drives it rather than
 * fighting it — html-ppt deep-links slides through `#/N` on `hashchange`
 * (`design-templates/html-ppt/assets/runtime.js`), so setting the hash keeps
 * that runtime's own slide index in step with ours, and its arrow keys keep
 * working with the label following along.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

/** One slide, as the bridge sees it in the live document. */
export interface DeckSlideInfo {
  title: string;
  notes: string;
}

const NAV_MARKER = 'LIGMA_DECK_NAV';

/**
 * The in-iframe half. ES5 on purpose — it is injected into whatever document
 * the model produced, which may declare its own strict-mode or legacy scripts.
 */
const DECK_NAV_SCRIPT = `<script id="${NAV_MARKER}">(function(){
  var slides = [].slice.call(document.querySelectorAll('section.slide'));
  if (!slides.length) return;
  function notesOf(s){ var n = s.querySelector('.notes'); return n ? (n.textContent||'').trim() : ''; }
  function titleOf(s,i){
    var h = s.querySelector('h1,h2,h3');
    return s.getAttribute('data-title') || (h && (h.textContent||'').trim()) || ('Slide ' + (i+1));
  }
  var cur = 0;
  function send(msg){ msg.__ligma = true; parent.postMessage(msg, '*'); }
  function info(){
    send({ type:'DECK_INFO', index: cur, slides: slides.map(function(s,i){
      return { title: titleOf(s,i), notes: notesOf(s) };
    }) });
  }
  function go(i){
    i = cur = Math.max(0, Math.min(slides.length - 1, i));
    var active = ['is-active','active'].filter(function(c){
      return slides.some(function(s){ return s.classList.contains(c); });
    })[0];
    if (active) slides.forEach(function(s,j){ s.classList.toggle(active, j === i); });
    try { location.hash = '#/' + (i + 1); } catch (e) {}
    slides[i].scrollIntoView({ block:'start', inline:'start' });
    send({ type:'DECK_SLIDE', index:i });
  }
  addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.__ligma !== true) return;
    if (d.type === 'DECK_QUERY') info();
    else if (d.type === 'GOTO_SLIDE') go(d.index | 0);
  });
  addEventListener('hashchange', function(){
    var m = /^#\\/(\\d+)/.exec(location.hash || '');
    if (m) send({ type:'DECK_SLIDE', index: (cur = Math.max(0, parseInt(m[1], 10) - 1)) });
  });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', info); else info();
})();<\/script>`;

/** Splice the bridge into a built srcdoc. Non-decks simply never report in. */
export function withDeckNav(srcdoc: string): string {
  if (srcdoc.includes(NAV_MARKER)) return srcdoc;
  if (/<\/body>/i.test(srcdoc)) return srcdoc.replace(/<\/body>/i, `${DECK_NAV_SCRIPT}</body>`);
  return srcdoc + DECK_NAV_SCRIPT;
}

export function clampSlide(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}

function envelope(data: unknown, type: string): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __ligma?: unknown }).__ligma === true &&
    (data as { type?: unknown }).type === type
  );
}

export function isDeckInfoMessage(
  data: unknown,
): data is { slides: DeckSlideInfo[]; index: number } {
  return (
    envelope(data, 'DECK_INFO') &&
    Array.isArray((data as { slides: unknown }).slides) &&
    typeof (data as { index: unknown }).index === 'number'
  );
}

export function isDeckSlideMessage(data: unknown): data is { index: number } {
  return envelope(data, 'DECK_SLIDE') && typeof (data as { index: unknown }).index === 'number';
}

export interface SlideNavProps {
  slides: DeckSlideInfo[];
  index: number;
  onGo: (index: number) => void;
}

/**
 * The bar under the frame: prev / next, "slide 3 / 12", and — only when the
 * deck actually carries them — a collapsible strip of the current slide's
 * speaker notes. `<details>` does the collapsing; a disclosure widget is a
 * thing the platform already has.
 */
export function SlideNav({ slides, index, onGo }: SlideNavProps) {
  const current = slides[index];
  const step = (delta: number): void => onGo(clampSlide(index + delta, slides.length));

  return (
    <div
      data-slide-nav
      className="sticky bottom-0 z-20 mx-auto w-fit max-w-full rounded-t-md border border-b-0 bg-background/95 px-2 py-1.5 shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="Previous slide"
          className="rounded p-1 disabled:opacity-30 hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          slide {index + 1} / {slides.length}
        </span>
        {current?.title ? (
          <span className="max-w-[22ch] truncate text-xs text-muted-foreground">
            {current.title}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= slides.length - 1}
          aria-label="Next slide"
          className="rounded p-1 disabled:opacity-30 hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {current?.notes ? (
        <details className="mt-1 max-w-[64ch]">
          <summary className="cursor-pointer text-xs text-muted-foreground">Speaker notes</summary>
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
            {current.notes}
          </p>
        </details>
      ) : null}
    </div>
  );
}
