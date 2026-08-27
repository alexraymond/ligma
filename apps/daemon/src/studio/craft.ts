/**
 * The vendored `craft/` rules, selected for a design and injected into the
 * generator's prompt.
 *
 * Build brief §2 names `craft/` as a pattern to vendor, and open-design's own
 * pattern is that the rule *bodies* go into the system prompt above the working
 * body — "the daemon injects only the requested ones into the system prompt
 * above the active skill body" (`craft/README.md`). Ligma vendored the files and
 * served them to the Library, but only listed the rule *slugs* to the critic:
 * the grader knew the rules' names and the writer had never read them
 * (D7 OD-081). Grading a writer against a rulebook it was never shown is not a
 * standard, it is a trap.
 *
 * Selection is structural, never a guess: a design system's `manifest.json`
 * carries `craft: { applies, suggested, exemptions }`, which is open-design's
 * own declaration of which universal rules that brand is held to. `applies` and
 * `suggested` go in, `exemptions` come out, and the anti-slop baseline is in
 * regardless because it is the one rule no brand gets to opt out of.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from '../paths';
import { rootForSystem } from '../routes/design-systems/route';

/** The vendored rules root. Overridable so tests can point at a fixture. */
export function craftDir(): string {
  return process.env.LIGMA_CRAFT_DIR
    ? path.resolve(process.env.LIGMA_CRAFT_DIR)
    : path.join(REPO_ROOT, 'craft');
}

function isRuleFile(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('README') && !name.startsWith('FUTURE');
}

/** Every craft rule slug on disk. README and FUTURE_SECTIONS are directory docs. */
export async function craftRuleSlugs(): Promise<string[]> {
  try {
    return (await readdir(craftDir()))
      .filter(isRuleFile)
      .map((name) => name.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The rule every design is held to whatever brand it wears. `craft/README.md`
 * puts anti-AI-slop in the universal column, and it is the rule a generative
 * design tool is most likely to break.
 */
const BASELINE_RULES = ['anti-ai-slop'];

/**
 * The prompt has to stay a prompt. The whole corpus is ~104 KB of markdown;
 * a design system's declared selection is ~20 KB, and this cap keeps a
 * hand-edited manifest that lists everything from turning the system prompt
 * into a library.
 */
const MAX_CRAFT_BYTES = 32_000;

interface CraftDeclaration {
  applies?: unknown;
  suggested?: unknown;
  exemptions?: unknown;
}

function slugList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Which rules this design system declares. Absent manifest, absent `craft`
 * block or unreadable JSON all mean "no declaration" — the baseline still
 * applies, because a package that forgot to declare is not a package that
 * opted out.
 */
export async function selectCraftRules(designSystem: string | null): Promise<string[]> {
  let declared: CraftDeclaration = {};
  if (designSystem) {
    // Both roots, via the catalog's own lookup: a wizard-authored package
    // declares `craft` in its manifest exactly as a vendored one does, and
    // reading only the checkout would silently drop that declaration now that
    // authored packages live in the store.
    const located = await rootForSystem(designSystem);
    try {
      if (located === null) throw new Error('no such design system');
      const raw = await readFile(path.join(located.root, designSystem, 'manifest.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { craft?: CraftDeclaration };
      declared = parsed.craft ?? {};
    } catch {
      declared = {};
    }
  }

  const exempt = new Set(slugList(declared.exemptions));
  const wanted = [
    ...BASELINE_RULES,
    ...slugList(declared.applies),
    ...slugList(declared.suggested),
  ];
  const available = new Set(await craftRuleSlugs());

  const selected: string[] = [];
  for (const slug of wanted) {
    if (exempt.has(slug) || selected.includes(slug) || !available.has(slug)) continue;
    selected.push(slug);
  }
  return selected;
}

/**
 * The selected rulebooks as prompt text, or `""` when there are none.
 *
 * Bodies verbatim: these are dense rulebooks whose value is in the specifics
 * ("ALL CAPS always needs ≥0.06em tracking"), and a summary of a rulebook is
 * the AI slop the rulebook exists to prevent.
 */
export async function craftContext(designSystem: string | null): Promise<string> {
  const slugs = await selectCraftRules(designSystem);
  if (slugs.length === 0) return '';

  const sections: string[] = [];
  let budget = MAX_CRAFT_BYTES;
  const included: string[] = [];
  for (const slug of slugs) {
    let body: string;
    try {
      body = await readFile(path.join(craftDir(), `${slug}.md`), 'utf-8');
    } catch {
      continue;
    }
    if (body.length > budget) continue;
    budget -= body.length;
    included.push(slug);
    sections.push(`<craft-rule slug="${slug}">\n${body.trim()}\n</craft-rule>`);
  }
  if (sections.length === 0) return '';

  return [
    '',
    'Craft rules — these are the rules the critic will score this design against,',
    `so read them before you write: ${included.join(', ')}.`,
    'They are universal craft, not brand: they hold on top of any design system.',
    '',
    ...sections,
  ].join('\n');
}
