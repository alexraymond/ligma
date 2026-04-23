import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Token-drift guard. The pre-rebrand tokens file carried a warm Anthropic
 * palette — specifically a terracotta accent at `oklch(0.62 0.16 35)` (light)
 * and `oklch(0.68 0.16 35)` (dark). Both values must be gone after the Ligma
 * reskin — their presence would mean the rebrand regressed in a later merge.
 *
 * We also assert the Ligma placeholder accent `#2EB5A8` appears, so a
 * partially-reverted tokens file trips this test too.
 *
 * The structural checks below go further: they verify dark-by-default lives
 * under `:root` and light lives under `.light`. A regression that flips the
 * two selectors (e.g. moves dark back under `.dark` and restores light under
 * `:root`) passes the string-contains checks above — these block it.
 */
const LEGACY_TERRACOTTA_ACCENTS = [
  'oklch(0.62 0.16 35)',
  'oklch(0.68 0.16 35)',
  'oklch(0.56 0.18 35)',
  'oklch(0.74 0.16 35)',
];
const LIGMA_ACCENT = '#2eb5a8';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(HERE, 'tokens.css');

/**
 * Extracts a top-level selector block (e.g. `:root { ... }`) from a CSS file,
 * balancing braces so nested rules (e.g. `@media`, `color-mix()`) don't
 * terminate the block early. Returns the inner body without the wrapping
 * braces, or `null` when no such block exists.
 *
 * The parser only honours selectors at brace-depth 0 — a `:root` nested
 * inside an `@media` query won't match the top-level `:root` extraction,
 * which is exactly the behavior we want here.
 */
function extractSelectorBlock(source: string, selector: string): string | null {
  const len = source.length;
  let i = 0;
  let depth = 0;
  while (i < len) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && source.startsWith(selector, i)) {
      // Ensure we matched a whole selector, not a prefix (e.g. `.light` must
      // not match `.light-something`). The next non-whitespace character
      // after the selector must be `{`.
      let j = i + selector.length;
      while (j < len && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n')) {
        j += 1;
      }
      if (source[j] === '{') {
        // Capture the balanced body.
        const bodyStart = j + 1;
        let bodyDepth = 1;
        let k = bodyStart;
        while (k < len && bodyDepth > 0) {
          if (source[k] === '{') bodyDepth += 1;
          else if (source[k] === '}') bodyDepth -= 1;
          if (bodyDepth === 0) break;
          k += 1;
        }
        return source.slice(bodyStart, k);
      }
    }
    i += 1;
  }
  return null;
}

/**
 * Pulls a single `--color-background: <value>;` declaration out of a block,
 * returning the value with surrounding whitespace stripped.
 */
function readBackground(block: string): string | null {
  const match = block.match(/--color-background\s*:\s*([^;]+);/);
  return match ? (match[1] ?? '').trim() : null;
}

/**
 * Parses the lightness channel (L) of an `oklch(L C H ...)` value.
 * Returns `null` when the input doesn't match the oklch shape.
 */
function parseOklchLightness(value: string): number | null {
  const match = value.match(/oklch\(\s*([0-9.]+)/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

describe('tokens.css — Ligma rebrand', () => {
  let contents = '';

  beforeAll(async () => {
    contents = await readFile(TOKENS_PATH, 'utf8');
  });

  it('does not contain any legacy terracotta accent values', () => {
    const lowered = contents.toLowerCase();
    for (const legacy of LEGACY_TERRACOTTA_ACCENTS) {
      expect(lowered, `legacy accent "${legacy}" leaked back in`).not.toContain(
        legacy.toLowerCase(),
      );
    }
  });

  it('contains the Ligma placeholder accent', () => {
    expect(contents.toLowerCase()).toContain(LIGMA_ACCENT);
  });

  it('carries a TODO-MORNING marker next to the placeholder palette', () => {
    expect(contents).toMatch(/TODO-MORNING.*Ligma palette/);
  });

  describe('structural: dark-by-default', () => {
    it(':root declares a dark --color-background (oklch lightness < 0.4)', () => {
      const rootBlock = extractSelectorBlock(contents, ':root');
      expect(rootBlock, ':root block must exist').not.toBeNull();
      const bg = readBackground(rootBlock ?? '');
      expect(bg, ':root must declare --color-background').not.toBeNull();
      // Accept either the committed dark value or any oklch() with L < 0.4.
      // Hex dark values would also be acceptable but are out of scope here —
      // every background slot in the current palette uses oklch().
      const lightness = parseOklchLightness(bg ?? '');
      expect(lightness, `expected oklch lightness, got "${bg}"`).not.toBeNull();
      expect(lightness ?? 1).toBeLessThan(0.4);
    });

    it('.light block exists and declares a cream/light --color-background (L > 0.9)', () => {
      const lightBlock = extractSelectorBlock(contents, '.light');
      expect(lightBlock, '.light block must exist').not.toBeNull();
      const bg = readBackground(lightBlock ?? '');
      expect(bg, '.light must declare --color-background').not.toBeNull();
      const lightness = parseOklchLightness(bg ?? '');
      expect(lightness, `expected oklch lightness, got "${bg}"`).not.toBeNull();
      expect(lightness ?? 0).toBeGreaterThan(0.9);
    });

    it('.dark selector is absent (dark lives under :root, not behind a class)', () => {
      // `.darker` or similar would not be a valid top-level selector in this
      // file, so a plain substring check is safe — but extractSelectorBlock
      // is stricter and catches only a real `.dark { ... }` rule.
      const darkBlock = extractSelectorBlock(contents, '.dark');
      expect(darkBlock, '.dark selector must not exist (dark is the :root default)').toBeNull();
    });
  });
});
