/**
 * Build the sandboxed-iframe `srcdoc` for one design file.
 *
 * This is the web-side shim for ligma-classic's `buildSrcdoc`
 * (`packages/runtime/src/index.ts`). The overlay itself — the part that
 * matters, and the part the studio map calls "the cleanest, highest-confidence
 * port in this whole survey" — is imported **as-is** from
 * `@ligma/runtime/overlay`: the click-to-pin capture, the live `ELEMENT_RECTS`
 * stream, the canvas-size broadcast and the pan forwarding all arrive
 * unmodified, so the postMessage protocol in studio-map §1 is the protocol this
 * app speaks.
 *
 * What is *not* imported is `@ligma/runtime`'s top-level entry: it inlines the
 * vendored React/ReactDOM/Babel UMD bundles through Vite's `?raw` import
 * assertion, which Next's bundler does not implement (studio map §7 flags this
 * exact seam and calls the shim trivial). The daemon's studio agent is
 * instructed to "produce a runnable multi-file design source" with one file per
 * screen, so a design file is HTML and needs no in-iframe JSX compiler.
 *
 * ponytail: HTML-only. A JSX-artifact design would need the vendored
 * React+Babel bundles served as static assets and spliced in here — add that
 * when the studio agent starts emitting bare JSX, not before.
 */

import { OVERLAY_SCRIPT } from '@ligma/runtime/overlay';

const OVERLAY_MARKER = '<!-- LIGMA_STUDIO_OVERLAY -->';

/** Kills animation, scroll and media in the Wall's static thumbnails. Ported. */
const THUMBNAIL_STYLE = `<style>
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  scrollbar-width: none !important;
}
*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
html, body { overflow: hidden !important; margin: 0 !important; }
video, audio { display: none !important; }
</style>`;

const RESET_STYLE = `<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  *, *::before, *::after { box-sizing: border-box; }
</style>`;

function isFullDocument(source: string): boolean {
  const head = source.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function withOverlay(html: string): string {
  if (html.includes(OVERLAY_MARKER)) return html;
  const script = `${OVERLAY_MARKER}<script>${OVERLAY_SCRIPT}</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return html + script;
}

/**
 * A full HTML document for `source`, with the overlay spliced in.
 *
 * Any `<meta http-equiv="Content-Security-Policy">` the model emitted is
 * stripped first — the same defence `buildSrcdoc` opens with, because a
 * generated CSP would block the overlay we are about to inject and the pin
 * layer would silently stop working.
 */
export function buildDesignSrcdoc(source: string): string {
  const clean = source.replace(
    /<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    '',
  );
  if (isFullDocument(clean)) return withOverlay(clean);
  return withOverlay(
    `<!doctype html><html><head><meta charset="utf-8">${RESET_STYLE}</head><body>${clean}</body></html>`,
  );
}

/** The Wall's card thumbnails: same document, animations and scrollbars off. */
export function buildThumbnailSrcdoc(source: string): string {
  const doc = buildDesignSrcdoc(source);
  if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, `${THUMBNAIL_STYLE}</head>`);
  return THUMBNAIL_STYLE + doc;
}

/**
 * The iframe-pool remount key (ported: `stablePreviewSourceKey`).
 *
 * Token-only changes inside an `/*EDITMODE-BEGIN*​/…/*EDITMODE-END*​/` block go
 * to the live iframe over postMessage, so they must NOT rebuild the document —
 * a rebuilt srcdoc means re-parsing HTML, re-running scripts and a 300–500ms
 * blank flash. Blanking the token block out of the key makes the memo ignore
 * exactly those edits and nothing else.
 */
export function stablePreviewSourceKey(source: string): string {
  return source.replace(
    /\/\*EDITMODE-BEGIN\*\/[\s\S]*?\/\*EDITMODE-END\*\//g,
    '/*EDITMODE-BEGIN*//*EDITMODE-END*/',
  );
}

/** The host→iframe envelope every `__ligma` message carries (studio map §1). */
export function postToIframe(win: Window | null, message: Record<string, unknown>): void {
  if (!win) return;
  try {
    win.postMessage({ __ligma: true, ...message }, '*');
  } catch {
    /* sandbox gone — the next render re-posts */
  }
}
