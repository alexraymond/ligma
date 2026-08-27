import { ERROR_CODES, LigmaError } from '@ligma/shared';
import type { ExportResult } from './index';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ExportImageOptions {
  /** Override the discovered Chrome binary path. Useful for tests / CI. */
  chromePath?: string;
  /** Encoding. Defaults to 'png' — lossless, and the only one clipboards take. */
  format?: ImageFormat;
  /** Render width in CSS pixels. Defaults to the same 1280 the PDF path uses. */
  width?: number;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

/**
 * Render an HTML string to a PNG / JPEG / WebP via the user's installed Chrome.
 *
 * The screenshot is always `fullPage`: a design screen is as tall as it is, and
 * cropping it at the viewport's 800px would silently hand back a truncated
 * design. Same puppeteer-core + system-Chrome machinery as `pdf.ts` (shared in
 * `browser.ts`) — no second browser dependency for a second raster format.
 */
export async function exportImage(
  htmlContent: string,
  destinationPath: string,
  opts: ExportImageOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const { launchChrome } = await import('./browser');

  const format = opts.format ?? 'png';

  let browser: Awaited<ReturnType<typeof launchChrome>> | null = null;
  try {
    browser = await launchChrome(opts.chromePath);
    const page = await browser.newPage();
    await page.setViewport({ width: opts.width ?? DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30_000 });

    const shot = await page.screenshot({ type: format, fullPage: true });
    await fs.writeFile(destinationPath, shot);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    if (err instanceof LigmaError) throw err;
    throw new LigmaError(
      `Image export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_IMAGE_FAILED,
      { cause: err },
    );
  } finally {
    if (browser) await browser.close();
  }
}
