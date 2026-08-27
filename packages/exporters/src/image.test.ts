import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fakePngBytes = Buffer.from('\x89PNG fake');

const launchMock = vi.fn();
const newPageMock = vi.fn();
const setViewportMock = vi.fn();
const setContentMock = vi.fn();
const screenshotMock = vi.fn();
const closeMock = vi.fn();

// Same shape as `pdf.test.ts`: Chrome is mocked at the puppeteer boundary, so
// the suite proves the wiring on a machine with no browser installed.
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
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-image-test-'));
  launchMock.mockResolvedValue({ newPage: newPageMock, close: closeMock });
  newPageMock.mockResolvedValue({
    setViewport: setViewportMock,
    setContent: setContentMock,
    screenshot: screenshotMock,
  });
  screenshotMock.mockResolvedValue(fakePngBytes);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportImage', () => {
  it('screenshots the full page as PNG by default', async () => {
    const { exportImage } = await import('./image');
    const dest = join(tempDir, 'out.png');
    const result = await exportImage('<h1>hi</h1>', dest);

    expect(setContentMock).toHaveBeenCalledWith(
      '<h1>hi</h1>',
      expect.objectContaining({ waitUntil: 'networkidle0' }),
    );
    expect(screenshotMock).toHaveBeenCalledWith({ type: 'png', fullPage: true });
    expect(closeMock).toHaveBeenCalled();
    expect(result).toEqual({ path: dest, bytes: fakePngBytes.length });
  });

  it('honours the format and the render width', async () => {
    setViewportMock.mockClear();
    const { exportImage } = await import('./image');
    await exportImage('<p>x</p>', join(tempDir, 'out.webp'), {
      format: 'webp',
      width: 390,
      chromePath: '/tmp/fake-chrome',
    });

    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/tmp/fake-chrome' }),
    );
    expect(setViewportMock).toHaveBeenCalledWith(expect.objectContaining({ width: 390 }));
    expect(screenshotMock).toHaveBeenCalledWith({ type: 'webp', fullPage: true });
  });

  it('wraps puppeteer failures in EXPORTER_IMAGE_FAILED', async () => {
    screenshotMock.mockRejectedValueOnce(new Error('boom'));
    const { exportImage } = await import('./image');
    await expect(exportImage('<p>x</p>', join(tempDir, 'fail.png'))).rejects.toMatchObject({
      code: 'EXPORTER_IMAGE_FAILED',
    });
  });
});
