#!/usr/bin/env tsx
/**
 * One-shot PNG rendition generator for the Ligma logomark.
 *
 * Reads apps/desktop/resources/icons/ligma.svg and renders ligma-<size>.png
 * at the canonical installer sizes (16..1024). Output is committed to the
 * repo so no consumer has to run this script — it exists so future rebrand
 * tweaks re-run cleanly instead of being hand-edited per file.
 *
 * Run: `pnpm --filter @ligma/desktop exec tsx scripts/gen-icons.ts`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const iconsDir = resolve(here, '..', 'resources', 'icons');
  const svgPath = resolve(iconsDir, 'ligma.svg');
  const svg = await readFile(svgPath);

  for (const size of SIZES) {
    const outPath = resolve(iconsDir, `ligma-${size}.png`);
    const buf = await sharp(svg, { density: Math.max(72, size) })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(outPath, buf);
    process.stdout.write(`wrote ${outPath} (${buf.byteLength} bytes)\n`);
  }
}

main().catch((err) => {
  process.stderr.write(
    `gen-icons failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
