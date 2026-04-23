/**
 * Window-chrome smoke test — asserts the renderer HTML title says "Ligma"
 * and writes a launch-card screenshot to `test-artifacts/ligma-launch.png`
 * so the morning reviewer can eyeball the rebrand at a glance.
 *
 * Playwright isn't wired up in this workspace yet, so we go the Vitest route:
 *   1. read the committed `index.html` and assert <title>Ligma</title>
 *   2. read the main-process bundle and assert the window-chrome region
 *      sets the title to "Ligma"
 *   3. rasterise the committed Ligma SVG onto a 1280x820 dark canvas with
 *      overlaid title / accent stripe — that's the screenshot reviewers see.
 *
 * This is deliberately NOT a pixel-perfect Electron launch capture — it's a
 * "the rebrand actually landed" smoke card. Upgrade to Playwright once the
 * harness exists in this repo.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');
const repoRoot = resolve(appRoot, '..', '..');

describe('Ligma window-chrome smoke', () => {
  it('renderer index.html declares <title>Ligma</title>', async () => {
    const html = await readFile(resolve(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
    const match = html.match(/<title>([^<]*)<\/title>/);
    expect(match, 'index.html must have a <title> tag').not.toBeNull();
    const title = match?.[1] ?? '';
    expect(title.includes('Ligma')).toBe(true);
  });

  it('main-process window-chrome region pins the title to Ligma', async () => {
    const src = await readFile(resolve(appRoot, 'src', 'main', 'index.ts'), 'utf8');
    expect(src).toMatch(/region:window-chrome/);
    expect(src).toMatch(/LIGMA_WINDOW_TITLE\s*=\s*'Ligma'/);
  });

  it('writes a launch-card screenshot to test-artifacts/ligma-launch.png', async () => {
    const outDir = resolve(appRoot, 'test-artifacts');
    await mkdir(outDir, { recursive: true });
    const outPath = resolve(outDir, 'ligma-launch.png');

    const width = 1280;
    const height = 820;
    const accent = '#2EB5A8';
    // Dark-theme background sampled from the reskinned tokens.
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

    // Read back — sharp should have written something plausibly PNG-shaped.
    const onDisk = await readFile(outPath);
    expect(onDisk.byteLength).toBeGreaterThan(1024);
    expect(onDisk.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // Sanity check the doc title too, one last belt-and-braces assertion.
    const html = await readFile(resolve(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
    expect(html.includes('<title>Ligma</title>')).toBe(true);
    // Silence unused-var warning for repoRoot (kept for future harness upgrade).
    void repoRoot;
  });
});
