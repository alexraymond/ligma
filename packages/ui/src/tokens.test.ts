import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Token-drift guard. The pre-rebrand tokens file carried a warm Anthropic
 * palette — specifically a terracotta accent at `oklch(0.62 0.16 35)` (light)
 * and `oklch(0.68 0.16 35)` (dark). Both values must be gone after the Ligma
 * reskin — their presence would mean the rebrand regressed in a later merge.
 *
 * We also assert the Ligma placeholder accent `#2EB5A8` appears, so a
 * partially-reverted tokens file trips this test too.
 */
const LEGACY_TERRACOTTA_ACCENTS = [
  'oklch(0.62 0.16 35)',
  'oklch(0.68 0.16 35)',
  'oklch(0.56 0.18 35)',
  'oklch(0.74 0.16 35)',
];
const LIGMA_ACCENT = '#2eb5a8';

describe('tokens.css — Ligma rebrand', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tokensPath = resolve(here, 'tokens.css');

  it('does not contain any legacy terracotta accent values', async () => {
    const contents = (await readFile(tokensPath, 'utf8')).toLowerCase();
    for (const legacy of LEGACY_TERRACOTTA_ACCENTS) {
      expect(contents, `legacy accent "${legacy}" leaked back in`).not.toContain(
        legacy.toLowerCase(),
      );
    }
  });

  it('contains the Ligma placeholder accent', async () => {
    const contents = (await readFile(tokensPath, 'utf8')).toLowerCase();
    expect(contents).toContain(LIGMA_ACCENT);
  });

  it('carries a TODO-MORNING marker next to the placeholder palette', async () => {
    const contents = await readFile(tokensPath, 'utf8');
    expect(contents).toMatch(/TODO-MORNING.*Ligma palette/);
  });
});
