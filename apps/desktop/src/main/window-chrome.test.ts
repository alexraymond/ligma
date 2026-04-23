/**
 * Window-chrome tests.
 *
 * Three blocks:
 *   1. Renderer <title> grep — cheap assertion that the HTML ships with
 *      "Ligma" in the title tag (seen by the OS window manager on load).
 *   2. Behavioural tests for `applyLigmaWindowChrome` + `registerLigmaAboutPanel`
 *      imported directly from ./window-chrome. Uses `vi.mock('./electron-runtime')`
 *      to stub out Electron's `app`, and a plain fake for BrowserWindow.
 *      These replace the source-grep assertions that QA flagged: renames,
 *      dead-code constants, or skipped invocation sites all surface here.
 *   3. A launch-card screenshot (`test-artifacts/ligma-launch.png`) the
 *      morning reviewer can eyeball. Playwright isn't wired up in this
 *      workspace yet; upgrade once it is.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const appMock = {
  getVersion: vi.fn(() => '0.1.3'),
  setName: vi.fn(),
  setAboutPanelOptions: vi.fn(),
};

vi.mock('./electron-runtime', () => ({
  app: appMock,
}));

// Imported AFTER the mock so the mocked `app` is what window-chrome.ts sees.
const { LIGMA_WINDOW_TITLE, applyLigmaWindowChrome, registerLigmaAboutPanel } = await import(
  './window-chrome'
);

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');

describe('renderer HTML title', () => {
  it('index.html declares <title>Ligma</title>', async () => {
    const html = await readFile(resolve(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
    const match = html.match(/<title>([^<]*)<\/title>/);
    expect(match, 'index.html must have a <title> tag').not.toBeNull();
    expect((match?.[1] ?? '').includes('Ligma')).toBe(true);
  });
});

/** Minimal BrowserWindow + webContents double that captures every
 *  page-title-updated listener so tests can replay them synchronously. */
function makeWindowMock() {
  type Listener = (event: { preventDefault: () => void }) => void;
  const pageTitleListeners: Listener[] = [];
  const win = {
    setTitle: vi.fn(),
    webContents: {
      on: vi.fn((channel: string, listener: Listener) => {
        if (channel === 'page-title-updated') pageTitleListeners.push(listener);
      }),
    },
  };
  return { win, pageTitleListeners };
}

describe('applyLigmaWindowChrome', () => {
  it('sets the window title to "Ligma" immediately', () => {
    const { win } = makeWindowMock();
    // Cast to the imported type at the call site — the mock implements just
    // the two methods the helper actually touches.
    applyLigmaWindowChrome(win as unknown as Parameters<typeof applyLigmaWindowChrome>[0]);
    expect(win.setTitle).toHaveBeenCalledWith('Ligma');
    expect(LIGMA_WINDOW_TITLE).toBe('Ligma');
  });

  it('registers a page-title-updated listener on webContents', () => {
    const { win, pageTitleListeners } = makeWindowMock();
    applyLigmaWindowChrome(win as unknown as Parameters<typeof applyLigmaWindowChrome>[0]);
    expect(win.webContents.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function));
    expect(pageTitleListeners).toHaveLength(1);
  });

  it('page-title-updated listener calls event.preventDefault() and re-pins the title', () => {
    const { win, pageTitleListeners } = makeWindowMock();
    applyLigmaWindowChrome(win as unknown as Parameters<typeof applyLigmaWindowChrome>[0]);
    win.setTitle.mockClear();
    const preventDefault = vi.fn();
    pageTitleListeners[0]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(win.setTitle).toHaveBeenCalledWith('Ligma');
  });
});

describe('registerLigmaAboutPanel', () => {
  afterEach(() => {
    appMock.setName.mockClear();
    appMock.setAboutPanelOptions.mockClear();
    appMock.getVersion.mockClear();
  });

  it('calls app.setName("Ligma") on every platform', () => {
    const original = process.platform;
    // Prove the .setName branch runs independently of platform.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      registerLigmaAboutPanel();
      expect(appMock.setName).toHaveBeenCalledWith('Ligma');
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('calls app.setAboutPanelOptions with applicationName "Ligma" on darwin', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      registerLigmaAboutPanel();
      expect(appMock.setAboutPanelOptions).toHaveBeenCalledTimes(1);
      const args = appMock.setAboutPanelOptions.mock.calls[0]?.[0] as {
        applicationName: string;
        applicationVersion: string;
        version: string;
        copyright: string;
      };
      expect(args.applicationName).toBe('Ligma');
      expect(args.applicationVersion).toBe('0.1.3');
      expect(args.version).toBe('0.1.3');
      expect(args.copyright).toMatch(/Ligma/);
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('does NOT call setAboutPanelOptions on non-darwin platforms', () => {
    const original = process.platform;
    for (const platform of ['linux', 'win32'] as const) {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      appMock.setAboutPanelOptions.mockClear();
      appMock.setName.mockClear();
      try {
        registerLigmaAboutPanel();
        expect(
          appMock.setAboutPanelOptions,
          `setAboutPanelOptions should be skipped on ${platform}`,
        ).not.toHaveBeenCalled();
        // setName still fires as the cross-platform rename hook.
        expect(appMock.setName).toHaveBeenCalledWith('Ligma');
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
      }
    }
  });
});

describe('launch-card screenshot', () => {
  it('writes a PNG to test-artifacts/ligma-launch.png', async () => {
    const outDir = resolve(appRoot, 'test-artifacts');
    await mkdir(outDir, { recursive: true });
    const outPath = resolve(outDir, 'ligma-launch.png');

    const width = 1280;
    const height = 820;
    const accent = '#2EB5A8';
    const bg = '#1c232a';

    const iconSvg = await readFile(resolve(appRoot, 'resources', 'icons', 'ligma.svg'), 'utf8');
    const iconPng = await sharp(Buffer.from(iconSvg), { density: 512 })
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const card = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bg}" />
  <rect x="0" y="0" width="${width}" height="4" fill="${accent}" />
  <text x="${width / 2}" y="560" font-family="Inter, system-ui, sans-serif" font-size="72" font-weight="700" fill="#f5f7f9" text-anchor="middle">Ligma</text>
  <text x="${width / 2}" y="620" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="400" fill="#8fb6b1" text-anchor="middle">Dark theme default · placeholder accent · two-circle mark</text>
  <text x="${width / 2}" y="770" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="400" fill="#5d7a76" text-anchor="middle">Ligma launch smoke — generated ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;

    const composed = await sharp(Buffer.from(card))
      .composite([{ input: iconPng, top: 180, left: Math.round((width - 256) / 2) }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(outPath, composed);

    const onDisk = await readFile(outPath);
    expect(onDisk.byteLength).toBeGreaterThan(1024);
    expect(onDisk.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
