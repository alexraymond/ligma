/**
 * Exporter entry point. Each format lives in its own subpath export and is
 * loaded lazily so the cold-start bundle stays lean (PRINCIPLES §1).
 *
 * Tier 1 ships HTML, PDF, PPTX, and ZIP — all four lazy-loaded so the heavy
 * runtime deps (`puppeteer-core`, `pptxgenjs`, `zip-lib`) only enter the
 * module graph the first time a user actually exports.
 */

import { CodesignError, ERROR_CODES } from '@ligma/shared';

export const EXPORTER_FORMATS = ['html', 'pdf', 'pptx', 'zip', 'markdown'] as const;
export type ExporterFormat = (typeof EXPORTER_FORMATS)[number];

export interface ExportOptions {
  artifactId: string;
  destinationPath: string;
}

export interface ExportResult {
  bytes: number;
  path: string;
}

export function isExporterReady(_format: ExporterFormat): boolean {
  return true;
}

export type { ExportHtmlOptions } from './html';
export type { ExportPdfOptions } from './pdf';
export type { ExportPptxOptions } from './pptx';
export type { ExportZipOptions, MultiFileBundleEntry, ZipAsset } from './zip';
export type { ExportMarkdownOptions, MarkdownMeta } from './markdown';
export { htmlToMarkdown } from './markdown';

export async function exportHtml(
  htmlContent: string,
  destinationPath: string,
  opts?: import('./html').ExportHtmlOptions,
): Promise<ExportResult> {
  const mod = await import('./html');
  return mod.exportHtml(htmlContent, destinationPath, opts);
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

export async function exportArtifact(
  format: ExporterFormat,
  htmlContent: string,
  destinationPath: string,
): Promise<ExportResult> {
  if (format === 'html') {
    return exportHtml(htmlContent, destinationPath);
  }
  if (format === 'pdf') {
    const mod = await import('./pdf');
    return mod.exportPdf(htmlContent, destinationPath);
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
  throw new CodesignError(
    `Unknown exporter format: ${format as string}`,
    ERROR_CODES.EXPORTER_UNKNOWN,
  );
}
