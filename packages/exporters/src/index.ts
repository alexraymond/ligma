/**
 * Exporter entry point. Each format lives in its own subpath export and is
 * loaded lazily so the cold-start bundle stays lean (PRINCIPLES §1).
 *
 * Tier 1 ships HTML, PDF, PPTX, and ZIP — all four lazy-loaded so the heavy
 * runtime deps (`puppeteer-core`, `pptxgenjs`, `zip-lib`) only enter the
 * module graph the first time a user actually exports.
 */

import { ERROR_CODES, LigmaError } from '@ligma/shared';

export const EXPORTER_FORMATS = [
  'html',
  'pdf',
  'pptx',
  'zip',
  'markdown',
  'png',
  'jpeg',
  'webp',
] as const;
export type ExporterFormat = (typeof EXPORTER_FORMATS)[number];

export interface ExportOptions {
  artifactId: string;
  destinationPath: string;
}

export interface ExportResult {
  bytes: number;
  path: string;
}

export type { ExportHtmlOptions } from './html';
export type { ExportPdfOptions } from './pdf';
export type { ExportImageOptions, ImageFormat } from './image';
export type { ExportPptxOptions } from './pptx';
export type { ExportZipOptions, MultiFileBundleEntry, ZipAsset } from './zip';
export type { ExportMarkdownOptions, MarkdownMeta } from './markdown';
export { htmlToMarkdown } from './markdown';
/**
 * Structural deck detection, re-exported so a caller that has to *decide* the
 * page format can decide it rather than leaving `exportPdf` to guess (P16).
 * Pure string work — no heavy runtime enters the graph for it.
 */
export { deckSlides } from './deck';

export async function exportHtml(
  htmlContent: string,
  destinationPath: string,
  opts?: import('./html').ExportHtmlOptions,
): Promise<ExportResult> {
  const mod = await import('./html');
  return mod.exportHtml(htmlContent, destinationPath, opts);
}

/**
 * Raster the artifact (PNG / JPEG / WebP). Takes options `exportArtifact`'s
 * format-only signature can't carry — the render width, which is how a mobile
 * screen gets shot at 390px instead of the desktop default.
 */
export async function exportImage(
  htmlContent: string,
  destinationPath: string,
  opts?: import('./image').ExportImageOptions,
): Promise<ExportResult> {
  const mod = await import('./image');
  return mod.exportImage(htmlContent, destinationPath, opts);
}

/**
 * Bundle every file in a multi-screen project into a single ZIP. Distinct
 * from `exportArtifact` (which assumes one primary HTML + assets) — see
 * `./zip.ts` for the layout difference. Lazy-loads the same `zip-lib`
 * runtime as the single-file path, so the dep only enters the module
 * graph the first time anyone hits "Download all" on the wall.
 */
export async function exportMultiFileBundle(
  entries: import('./zip').MultiFileBundleEntry[],
  destinationPath: string,
): Promise<ExportResult> {
  const mod = await import('./zip');
  return mod.exportMultiFileZip(entries, destinationPath);
}

/**
 * `opts.pdfPageFormat` is how a caller that KNOWS what it is exporting says so:
 * `'deck'` forces a page per slide, a paper size (`'Letter'`/`'A4'`) suppresses
 * deck pagination outright. The override existed on `exportPdf` but this — the
 * only production entry point — never passed it, so it was unreachable and
 * every export fell through to `exportPdf`'s own auto-detect (codebase audit
 * P16). The auto-detect stays for callers that genuinely do not know.
 */
export interface ExportArtifactOptions {
  pdfPageFormat?: import('./pdf').ExportPdfOptions['format'];
}

export async function exportArtifact(
  format: ExporterFormat,
  htmlContent: string,
  destinationPath: string,
  opts: ExportArtifactOptions = {},
): Promise<ExportResult> {
  if (format === 'html') {
    return exportHtml(htmlContent, destinationPath);
  }
  if (format === 'pdf') {
    const mod = await import('./pdf');
    // Omitted, not undefined: `exportPdf` reads "no `format` key at all" as
    // "decide for me", and exactOptionalPropertyTypes keeps the two distinct.
    return mod.exportPdf(
      htmlContent,
      destinationPath,
      opts.pdfPageFormat === undefined ? {} : { format: opts.pdfPageFormat },
    );
  }
  if (format === 'pptx') {
    const mod = await import('./pptx');
    return mod.exportPptx(htmlContent, destinationPath);
  }
  if (format === 'zip') {
    const mod = await import('./zip');
    return mod.exportZip(htmlContent, destinationPath);
  }
  if (format === 'markdown') {
    const mod = await import('./markdown');
    return mod.exportMarkdown(htmlContent, destinationPath);
  }
  if (format === 'png' || format === 'jpeg' || format === 'webp') {
    const mod = await import('./image');
    return mod.exportImage(htmlContent, destinationPath, { format });
  }
  throw new LigmaError(
    `Unknown exporter format: ${format as string}`,
    ERROR_CODES.EXPORTER_UNKNOWN,
  );
}
