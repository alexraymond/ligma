/**
 * D7 OD-081. Build brief §2 names `craft/` as a pattern to vendor, and
 * open-design injects the selected rule *bodies* into the system prompt. Ligma
 * listed the slugs to the critic and showed the generator nothing — the grader
 * knew the rules' names, the writer had never read them.
 *
 * Selection is structural (the design system's `manifest.json` `craft` block),
 * never a keyword guess over prose — brief §8.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/paths';
import { craftContext, craftRuleSlugs, selectCraftRules } from '../src/studio/craft';

let fixture: string;
const realCraftDir = process.env.LIGMA_CRAFT_DIR;

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'ligma-craft-'));
  await writeFile(path.join(fixture, 'anti-ai-slop.md'), '# Anti slop\n\nNo purple gradients.\n');
  await writeFile(path.join(fixture, 'color.md'), '# Colour\n\nAccent caps at 10%.\n');
  await writeFile(path.join(fixture, 'accessibility-baseline.md'), '# A11y\n\n4.5:1 contrast.\n');
  await writeFile(path.join(fixture, 'typography.md'), '# Type\n\nALL CAPS needs tracking.\n');
  await writeFile(path.join(fixture, 'README.md'), '# Not a rule\n');
  await writeFile(path.join(fixture, 'FUTURE_SECTIONS.md'), '# Also not a rule\n');
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
  if (realCraftDir === undefined) delete process.env.LIGMA_CRAFT_DIR;
  else process.env.LIGMA_CRAFT_DIR = realCraftDir;
});

describe('craft rule selection', () => {
  it("excludes the directory's own docs", async () => {
    process.env.LIGMA_CRAFT_DIR = fixture;
    const slugs = await craftRuleSlugs();
    expect(slugs).not.toContain('README');
    expect(slugs).not.toContain('FUTURE_SECTIONS');
    expect(slugs).toContain('color');
  });

  it('holds a design with no design system to the anti-slop baseline', async () => {
    process.env.LIGMA_CRAFT_DIR = fixture;
    expect(await selectCraftRules(null)).toEqual(['anti-ai-slop']);
  });

  it("takes the design system's declared rules from its manifest", async () => {
    process.env.LIGMA_CRAFT_DIR = fixture;
    // `minimal` ships craft.suggested = [color, accessibility-baseline].
    const selected = await selectCraftRules('minimal');
    expect(selected).toContain('color');
    expect(selected).toContain('accessibility-baseline');
    // Baseline first, and never duplicated.
    expect(selected[0]).toBe('anti-ai-slop');
    expect(new Set(selected).size).toBe(selected.length);
  });

  it('does not invent rules for a design system that does not exist', async () => {
    process.env.LIGMA_CRAFT_DIR = fixture;
    expect(await selectCraftRules('no-such-system')).toEqual(['anti-ai-slop']);
  });

  it('puts the rule bodies in the prompt, not just their names', async () => {
    process.env.LIGMA_CRAFT_DIR = fixture;
    const context = await craftContext('minimal');
    expect(context).toContain('No purple gradients.');
    expect(context).toContain('Accent caps at 10%.');
    expect(context).toContain('4.5:1 contrast.');
    // Not selected by this design system.
    expect(context).not.toContain('ALL CAPS needs tracking.');
    expect(context).toContain('<craft-rule slug="color">');
  });

  it('is empty rather than noisy when there are no rules on disk', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'ligma-craft-empty-'));
    process.env.LIGMA_CRAFT_DIR = empty;
    try {
      expect(await craftContext('minimal')).toBe('');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('the real vendored craft/ tree', () => {
  it('carries the rules every bundled design system declares', async () => {
    delete process.env.LIGMA_CRAFT_DIR;
    const selected = await selectCraftRules('minimal');
    expect(selected).toEqual(['anti-ai-slop', 'color', 'accessibility-baseline']);

    const context = await craftContext('minimal');
    // Real bodies, not a summary: a sentence out of the vendored file itself.
    const antiSlop = await readFile(path.join(REPO_ROOT, 'craft', 'anti-ai-slop.md'), 'utf-8');
    expect(context).toContain(antiSlop.trim().split('\n')[0]);
    expect(context.length).toBeGreaterThan(5_000);
    expect(context.length).toBeLessThan(40_000);
  });
});
