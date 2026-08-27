/**
 * Phase 4 (docs/superpowers/specs/2026-08-26-studio-od-parity-roadmap.md):
 * design-system depth. `session.ts` used to feed the generator 8,000 chars of
 * DESIGN.md and nothing else, while the vendored package's tokens.css,
 * USAGE.md, components.html and design-tokens.json all sat unread. These
 * tests pin the assembler's budget, elision, read-order, and fail-soft
 * contracts using a synthetic package fixture — never a design system that
 * happens to be small enough today.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { designSystemContext } from '../src/studio/design-system-context';

let fixtureRoot: string;
const realDir = process.env.LIGMA_DESIGN_SYSTEMS_DIR;

async function makePackage(id: string, files: Record<string, string>): Promise<void> {
  const dir = path.join(fixtureRoot, id);
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents, 'utf-8');
  }
}

const USAGE_STANDARD = [
  '# Fixture Usage',
  '',
  '## Read Order',
  '',
  '1. Read this file first.',
  '2. Read `DESIGN.md` for intent.',
  '3. Paste `tokens.css` into the first artifact `<style>` block.',
  '4. Use `components.manifest.json` for the compact inventory; open `components.html` when exact selectors matter.',
  '',
].join('\n');

const SMALL_TOKENS_CSS = [
  '/* fixture tokens */',
  ':root {',
  '  --accent: #ff0000;',
  '  --bg: #ffffff;',
  '  --font-display:',
  '    "Fixture Sans", sans-serif;',
  '}',
  '',
].join('\n');

const SMALL_MANIFEST = JSON.stringify({
  groups: [
    {
      id: 'buttons',
      label: 'Buttons',
      present: true,
      classes: ['btn', 'btn-primary'],
      elements: ['button'],
    },
    { id: 'absent-group', label: 'Not present', present: false, classes: ['nope'], elements: [] },
  ],
});

const SMALL_DESIGN_TOKENS_JSON = JSON.stringify({
  summary: { totalTokens: 2, grade: 'excellent' },
  tokens: [{ name: '--accent' }, { name: '--bg' }],
});

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'ligma-dsctx-'));
  process.env.LIGMA_DESIGN_SYSTEMS_DIR = fixtureRoot;

  await makePackage('fixture-small', {
    'USAGE.md': USAGE_STANDARD,
    'tokens.css': SMALL_TOKENS_CSS,
    'components.manifest.json': SMALL_MANIFEST,
    'design-tokens.json': SMALL_DESIGN_TOKENS_JSON,
  });

  // A tokens.css too big to inline verbatim but small once stripped of
  // comments — the common shape of the real vendored packages.
  const bigComment = `/*${'x'.repeat(13_000)}*/\n`;
  await makePackage('fixture-big-tokens', {
    'USAGE.md': USAGE_STANDARD,
    'tokens.css': `${bigComment}:root {\n  --accent: #00ff00;\n  --bg: #000000;\n}\n`,
  });

  // Declarations so large even the stripped form has to be clipped again.
  const manyDecls = Array.from({ length: 2000 }, (_, i) => `  --token-${i}: value-${i};`).join(
    '\n',
  );
  await makePackage('fixture-huge-tokens', {
    'tokens.css': `:root {\n${manyDecls}\n}\n`,
  });

  // No components.manifest.json — only components.html, to exercise the
  // capped-head fallback.
  await makePackage('fixture-html-only', {
    'USAGE.md': USAGE_STANDARD,
    'components.html': `<!-- fixture -->\n${'<div class="card">x</div>\n'.repeat(500)}`,
  });

  // USAGE.md that names components before tokens, to prove read order is
  // actually honored rather than hard-coded.
  await makePackage('fixture-reordered', {
    'USAGE.md': [
      '# Reordered',
      '',
      '## Read Order',
      '1. `components.manifest.json` first, unusually.',
      '2. Then `tokens.css`.',
    ].join('\n'),
    'tokens.css': SMALL_TOKENS_CSS,
    'components.manifest.json': SMALL_MANIFEST,
  });

  // Package directory exists but is otherwise empty.
  await makePackage('fixture-empty', {});
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  if (realDir === undefined) delete process.env.LIGMA_DESIGN_SYSTEMS_DIR;
  else process.env.LIGMA_DESIGN_SYSTEMS_DIR = realDir;
});

describe('fail-soft', () => {
  it('is empty for no design system', async () => {
    expect(await designSystemContext(null)).toBe('');
  });

  it('is empty for a design system that does not resolve', async () => {
    expect(await designSystemContext('no-such-system')).toBe('');
  });

  it('is empty for a package that ships none of these files', async () => {
    expect(await designSystemContext('fixture-empty')).toBe('');
  });
});

describe('small package — everything fits verbatim', () => {
  it('includes tokens.css verbatim, including a wrapped multi-line value', async () => {
    const ctx = await designSystemContext('fixture-small');
    expect(ctx).toContain('--accent: #ff0000;');
    expect(ctx).toContain('"Fixture Sans", sans-serif');
    expect(ctx).toContain('verbatim');
  });

  it('includes the component inventory from components.manifest.json, excluding absent groups', async () => {
    const ctx = await designSystemContext('fixture-small');
    expect(ctx).toContain('buttons (Buttons)');
    expect(ctx).toContain('btn-primary');
    expect(ctx).not.toContain('absent-group');
  });

  it('includes design-tokens.json verbatim when small', async () => {
    const ctx = await designSystemContext('fixture-small');
    expect(ctx).toContain('"totalTokens":2');
  });

  it('includes the USAGE.md guide', async () => {
    const ctx = await designSystemContext('fixture-small');
    expect(ctx).toContain('Fixture Usage');
  });
});

describe('tokens.css over budget', () => {
  it('strips comments and keeps only :root declarations, stating the elision', async () => {
    const ctx = await designSystemContext('fixture-big-tokens');
    expect(ctx).toContain('--accent: #00ff00;');
    expect(ctx).toContain('--bg: #000000;');
    expect(ctx).not.toContain('x'.repeat(100)); // the stripped comment body
    expect(ctx.toLowerCase()).toContain('elided');
  });

  it('clips even the stripped declarations when they are still too large, and says so', async () => {
    const ctx = await designSystemContext('fixture-huge-tokens');
    expect(ctx).toContain('--token-0: value-0;');
    expect(ctx.toLowerCase()).toContain('truncated');
    expect(ctx.length).toBeLessThan(24_500);
  });
});

describe('components.html fallback', () => {
  it('falls back to a capped head when there is no components.manifest.json, and says so', async () => {
    const ctx = await designSystemContext('fixture-html-only');
    expect(ctx).toContain('capped head');
    expect(ctx).toContain('<div class="card">x</div>');
    expect(ctx).not.toContain('<div class="card">x</div>\n'.repeat(500));
  });
});

describe('USAGE.md read order', () => {
  it('orders sections the way USAGE.md declares, not a hard-coded order', async () => {
    const ctx = await designSystemContext('fixture-reordered');
    const componentsAt = ctx.indexOf('Component inventory');
    const tokensAt = ctx.indexOf('Design tokens (tokens.css)');
    expect(componentsAt).toBeGreaterThan(-1);
    expect(tokensAt).toBeGreaterThan(-1);
    expect(componentsAt).toBeLessThan(tokensAt);
  });

  it('defaults to tokens-first when there is no USAGE.md to steer it', async () => {
    // fixture-huge-tokens has no USAGE.md and only tokens.css; the assembler
    // must not throw or reorder around a missing file.
    const ctx = await designSystemContext('fixture-huge-tokens');
    expect(ctx).toContain('Design tokens (tokens.css');
  });
});

describe('total budget', () => {
  it('stays within the ~24k total cap even when every section is maxed', async () => {
    const bigManifest = JSON.stringify({
      groups: Array.from({ length: 400 }, (_, i) => ({
        id: `group-${i}`,
        label: `Group ${i}`,
        present: true,
        classes: [`class-${i}-a`, `class-${i}-b`],
        elements: ['div'],
      })),
    });
    const bigDesignTokens = JSON.stringify({
      summary: { totalTokens: 5000 },
      tokens: Array.from({ length: 5000 }, (_, i) => ({ name: `--token-${i}` })),
    });
    await makePackage('fixture-all-maxed', {
      'USAGE.md': '# Guide\n'.repeat(2000),
      'tokens.css': `:root {\n${Array.from({ length: 3000 }, (_, i) => `  --t${i}: ${i}px;`).join('\n')}\n}\n`,
      'components.manifest.json': bigManifest,
      'design-tokens.json': bigDesignTokens,
    });

    const ctx = await designSystemContext('fixture-all-maxed');
    expect(ctx.length).toBeLessThan(25_000);
    expect(ctx.toLowerCase()).toContain('elided');
  });
});
