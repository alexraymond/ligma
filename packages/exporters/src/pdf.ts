import { ERROR_CODES, LigmaError } from '@ligma/shared';
import { deckSlides } from './deck';
import type { ExportResult } from './index';

export interface ExportPdfOptions {
  /** Override the discovered Chrome binary path. Useful for tests / CI. */
  chromePath?: string;
  /**
   * Page format. Omit to let the exporter decide: a document whose top-level
   * `<section class="slide">` elements parse as a deck paginates one 1280×720
   * page per slide, everything else falls back to 'Letter'.
   *
   * Pass 'auto' to render the page as a single tall sheet (no pagination),
   * which is what Claude Design does for HTML prototypes that aren't
   * paginated. Pass 'deck' to force slide pagination. Passing any paper size
   * suppresses deck auto-detection — an explicit choice wins over a stray
   * `.slide` class (P16).
   */
  format?: 'Letter' | 'A4' | 'auto' | 'deck';
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/** 16:9 at the resolution `design-templates/html-ppt` lays its slides out for. */
const SLIDE_SIZE = { width: 1280, height: 720 } as const;

/**
 * What makes a deck paginate.
 *
 * On screen a deck is one slide deep: `.slide` is `position:absolute;opacity:0`
 * and only `.is-active` shows (`design-templates/html-ppt/assets/base.css`), so
 * printing it as-is yields a single page. The html-ppt family already ships
 * these rules under `@media print`; the scroll decks (simple-deck, replit-deck)
 * do not, and their slides would run together. Restating them here means one
 * page per slide for every deck, and costs nothing where the template agreed
 * already. `.notes` stay hidden — they are the speaker's, not the handout's.
 */
const DECK_PRINT_STYLE = `<style id="LIGMA_DECK_PRINT">@media print {
  html, body { height: auto !important; overflow: visible !important; margin: 0 !important; }
  /* Whatever holds the slides goes back to block flow: a page break is ignored
     on a flex item, and simple-deck's container is \`body{display:flex}\` with
     x-axis scroll snapping. \`:has\` names the container structurally so no
     template has to be listed by hand. */
  :has(> section.slide) {
    display: block !important; position: static !important;
    height: auto !important; overflow: visible !important; transform: none !important;
  }
  .slide {
    position: relative !important; inset: auto !important;
    width: 100% !important; height: 100vh !important; box-sizing: border-box !important;
    margin: 0 !important; flex: none !important;
    opacity: 1 !important; transform: none !important; pointer-events: auto !important;
    overflow: hidden;
    /* Break *before* every slide but the first, never after: the last slide is
       rarely the container's last child (simple-deck and replit-deck close with
       a <script>), so \`break-after\` on it spills one blank page. */
    break-after: auto !important; page-break-after: auto !important;
  }
  .slide + .slide { break-before: page !important; page-break-before: always !important; }
  .notes, .notes-overlay, .overview, .progress-bar { display: none !important; }
}</style>`;

function withDeckPrintStyle(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${DECK_PRINT_STYLE}</body>`);
  return html + DECK_PRINT_STYLE;
}

/**
 * Render an HTML string to PDF via the user's installed Chrome.
 *
 * Tier 1: no header/footer, no font embedding, no PDF tagging. We deliberately
 * avoid Puppeteer's full distribution (~150 MB Chromium download) — `puppeteer-core`
 * connects to the system Chrome we discover at runtime. PRINCIPLES §1 + §10.
 */
export async function exportPdf(
  htmlContent: string,
  destinationPath: string,
  opts: ExportPdfOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const { launchChrome } = await import('./browser');

  let browser: Awaited<ReturnType<typeof launchChrome>> | null = null;
  try {
    // A deck gets a page per slide at slide size; anything else keeps to paper.
    // Auto-detection only runs when the caller expressed no preference — an
    // explicit `format` means the user asked for paper, and a stray
    // `<section class="slide">` must not silently override that (P16).
    const isDeck =
      opts.format === 'deck' || (opts.format === undefined && deckSlides(htmlContent) !== null);

    browser = await launchChrome(opts.chromePath);
    const page = await browser.newPage();
    await page.setViewport(isDeck ? SLIDE_SIZE : DEFAULT_VIEWPORT);
    await page.setContent(isDeck ? withDeckPrintStyle(htmlContent) : htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });

    const format = opts.format === 'deck' ? 'Letter' : (opts.format ?? 'Letter');
    const pdfBuf = isDeck
      ? await page.pdf({
          printBackground: true,
          width: `${SLIDE_SIZE.width}px`,
          height: `${SLIDE_SIZE.height}px`,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
      : format === 'auto'
        ? await page.pdf({
            printBackground: true,
            width: `${DEFAULT_VIEWPORT.width}px`,
            height: `${await page.evaluate('document.documentElement.scrollHeight')}px`,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          })
        : await page.pdf({ printBackground: true, format, preferCSSPageSize: true });

    await fs.writeFile(destinationPath, pdfBuf);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    if (err instanceof LigmaError) throw err;
    throw new LigmaError(
      `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_PDF_FAILED,
      { cause: err },
    );
  } finally {
    if (browser) await browser.close();
  }
}
