import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Token-drift guard. The paper-sketchbook rebrand inverts the prior
 * "dark-by-default" decision: `:root` is now the paper (light) default
 * and `.dark` opts into the nocturne variant. This test locks that
 * structural choice so a regression (e.g. a merge that restores the
 * muted-teal dark-first palette) trips loudly.
 *
 * We also assert the paper palette's load-bearing values:
 *  - the red-pencil accent `#c72a2a` is present
 *  - the cream paper `#f2ecdc` is present
 *  - legacy terracotta accents from the pre-Ligma era stay gone
 *  - the muted-teal placeholder `#2EB5A8` is also gone (we're past the placeholder)
 */
const LEGACY_TERRACOTTA_ACCENTS = [
  'oklch(0.62 0.16 35)',
  'oklch(0.68 0.16 35)',
  'oklch(0.56 0.18 35)',
  'oklch(0.74 0.16 35)',
];
const LEGACY_PLACEHOLDER_ACCENT = '#2eb5a8';
const LIGMA_RED = '#c72a2a';
const LIGMA_PAPER = '#f2ecdc';

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
      let j = i + selector.length;
      while (j < len && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n')) {
        j += 1;
      }
      if (source[j] === '{') {
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
 * Pulls a single `--color-paper: <value>;` declaration out of a block,
 * returning the value with surrounding whitespace stripped.
 */
function readCustomProperty(block: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const match = block.match(re);
  return match ? (match[1] ?? '').trim() : null;
}

describe('tokens.css — paper-sketchbook rebrand', () => {
  let contents = '';

  beforeAll(async () => {
    contents = await readFile(TOKENS_PATH, 'utf8');
  });

  it('contains the red-pencil accent', () => {
    expect(contents.toLowerCase()).toContain(LIGMA_RED);
  });

  it('contains the paper base color', () => {
    expect(contents.toLowerCase()).toContain(LIGMA_PAPER);
  });

  it('does not contain any legacy terracotta accent values', () => {
    const lowered = contents.toLowerCase();
    for (const legacy of LEGACY_TERRACOTTA_ACCENTS) {
      expect(lowered, `legacy accent "${legacy}" leaked back in`).not.toContain(
        legacy.toLowerCase(),
      );
    }
  });

  it('does not contain the muted-teal placeholder accent (past the placeholder era)', () => {
    expect(contents.toLowerCase(), 'the #2EB5A8 placeholder must be gone').not.toContain(
      LEGACY_PLACEHOLDER_ACCENT,
    );
  });

  describe('structural: light-by-default (paper), dark as opt-in', () => {
    it(':root declares the paper base via --color-paper', () => {
      const rootBlock = extractSelectorBlock(contents, ':root');
      expect(rootBlock, ':root block must exist').not.toBeNull();
      const paper = readCustomProperty(rootBlock ?? '', '--color-paper');
      expect(paper, ':root must declare --color-paper').not.toBeNull();
      expect((paper ?? '').toLowerCase()).toBe(LIGMA_PAPER);
    });

    it('.dark block exists with a dark paper override (not the cream value)', () => {
      const darkBlock = extractSelectorBlock(contents, '.dark');
      expect(darkBlock, '.dark block must exist').not.toBeNull();
      const paper = readCustomProperty(darkBlock ?? '', '--color-paper');
      expect(paper, '.dark must override --color-paper').not.toBeNull();
      expect(
        (paper ?? '').toLowerCase(),
        '.dark --color-paper must differ from the cream default',
      ).not.toBe(LIGMA_PAPER);
    });

    it('.light selector is absent (light is the :root default, not behind a class)', () => {
      const lightBlock = extractSelectorBlock(contents, '.light');
      expect(lightBlock, '.light selector must not exist (paper is the :root default)').toBeNull();
    });
  });
});
