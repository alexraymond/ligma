import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fakePdfBytes = Buffer.from('%PDF-1.4 fake');

const launchMock = vi.fn();
const newPageMock = vi.fn();
const setViewportMock = vi.fn();
const setContentMock = vi.fn();
const pdfMock = vi.fn();
const closeMock = vi.fn();
const evaluateMock = vi.fn();

vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock },
}));

vi.mock('./chrome-discovery', () => ({
  findSystemChrome: vi.fn(
    async () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ),
}));

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-pdf-test-'));
  launchMock.mockResolvedValue({
    newPage: newPageMock,
    close: closeMock,
  });
  newPageMock.mockResolvedValue({
    setViewport: setViewportMock,
    setContent: setContentMock,
    pdf: pdfMock,
    evaluate: evaluateMock,
  });
  pdfMock.mockResolvedValue(fakePdfBytes);
  evaluateMock.mockResolvedValue(2400);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportPdf', () => {
  it('writes a PDF via puppeteer-core against the discovered Chrome', async () => {
    const { exportPdf } = await import('./pdf');
    const dest = join(tempDir, 'out.pdf');
    const result = await exportPdf('<h1>hi</h1>', dest);

    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: expect.stringContaining('Chrome'),
        headless: true,
      }),
    );
    expect(setContentMock).toHaveBeenCalledWith(
      '<h1>hi</h1>',
      expect.objectContaining({ waitUntil: 'networkidle0' }),
    );
    expect(pdfMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    expect(result.path).toBe(dest);
    expect(result.bytes).toBe(fakePdfBytes.length);
  });

  it('respects a chromePath override (no discovery call needed)', async () => {
    launchMock.mockClear();
    const { exportPdf } = await import('./pdf');
    const dest = join(tempDir, 'override.pdf');
    await exportPdf('<p>x</p>', dest, { chromePath: '/tmp/fake-chrome' });
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/tmp/fake-chrome' }),
    );
  });

  it('paginates a deck one page per slide, at slide size', async () => {
    pdfMock.mockClear();
    setContentMock.mockClear();
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(
      join(import.meta.dirname, '../../../design-templates/simple-deck/example.html'),
      'utf8',
    );
    const { exportPdf } = await import('./pdf');
    await exportPdf(html, join(tempDir, 'deck.pdf'));

    // The print rules that turn stacked/absolute slides into pages are spliced in.
    const [sent] = setContentMock.mock.calls.at(-1) ?? [];
    expect(sent).toContain('LIGMA_DECK_PRINT');
    expect(sent).toContain('break-before: page');
    expect(pdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ width: '1280px', height: '720px', printBackground: true }),
    );
  });

  it('leaves a non-deck page on the paper-size path', async () => {
    pdfMock.mockClear();
    const { exportPdf } = await import('./pdf');
    await exportPdf('<section><h1>not a deck</h1></section>', join(tempDir, 'plain.pdf'));
    expect(pdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'Letter', preferCSSPageSize: true }),
    );
  });

  it('wraps puppeteer failures in EXPORTER_PDF_FAILED', async () => {
    pdfMock.mockRejectedValueOnce(new Error('boom'));
    const { exportPdf } = await import('./pdf');
    await expect(exportPdf('<p>x</p>', join(tempDir, 'fail.pdf'))).rejects.toMatchObject({
      code: 'EXPORTER_PDF_FAILED',
    });
  });
});
