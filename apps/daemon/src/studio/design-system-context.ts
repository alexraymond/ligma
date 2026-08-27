/**
 * Design-system depth beyond the DESIGN.md excerpt
 * (docs/superpowers/specs/2026-08-26-studio-od-parity-roadmap.md, Phase 4).
 *
 * `session.ts` already injects 8,000 chars of `DESIGN.md` and keeps doing so
 * (that excerpt stays the lead section) — this module adds the rest of the
 * vendored package the Library already serves but the generator never saw:
 * `tokens.css` (the real custom properties — "best quality-per-line in the
 * roadmap" per the phase note), `USAGE.md`'s declared read order, a component
 * inventory, and `design-tokens.json`.
 *
 * `USAGE.md` names the assembly order itself (`## Read Order`): usage guide,
 * then DESIGN.md, then tokens.css, then the component artifacts. DESIGN.md's
 * slot is already spoken for above this section, so `readOrder` below honors
 * the declared order for what remains — falling back to tokens-first (the
 * highest-value artifact) when a package ships no USAGE.md or an
 * unrecognisable one.
 *
 * `components.manifest.json` — where present — already *is* the structural
 * extraction of `components.html` (element/class groups keyed by section,
 * built when the package was vendored): reusing it is both the accurate
 * choice and the lazy one, since re-deriving the same structure by re-parsing
 * the HTML here would just recompute what the package already ships. Only a
 * package without that manifest falls back to a capped, explicitly-elided
 * head of `components.html` itself.
 *
 * Every branch here fails soft: a missing or unreadable file is skipped, not
 * thrown, and a design system with none of these files simply gets no added
 * section — the DESIGN.md-only prompt session.ts always had.
 *
 * There is no `enforcePromptLimit` (or equivalent) on the studio generation
 * path — `session.ts` calls no such guard before handing the prompt to the
 * provider. `TOTAL_BUDGET` is this module's own ceiling, sized to the
 * roadmap's "~24k chars" figure rather than to a limit discovered downstream.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { rootForSystem } from '../routes/design-systems/route';

type ArtifactKey = 'tokens' | 'designTokens' | 'components';

/** Per-section caps; they sum to `TOTAL_BUDGET` with nothing left over for headers. */
const SECTION_BUDGET: Record<'usage' | ArtifactKey, number> = {
  usage: 2_500,
  tokens: 12_000,
  designTokens: 4_500,
  components: 5_000,
};

/** The roadmap's stated cap for this section (Phase 4: "~24k chars"). */
const TOTAL_BUDGET = 24_000;

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

/** Appends a stated elision marker whenever `text` doesn't fit `limit`. */
function clip(text: string, limit: number, note: string): string {
  if (limit <= 0) return `[${note}]`;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[...truncated — ${note}]`;
}

// ─── tokens.css ──────────────────────────────────────────────────────────────

/**
 * The custom-property declarations out of every `:root` (or `:root[...]`)
 * block, comments and any non-token rule stripped. Declarations are joined on
 * `;` rather than newline because a brand's font stack legitimately wraps
 * across lines (`--font-display:\n  "SF Pro Display", ...;`).
 */
function rootDeclarations(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines: string[] = [];
  const opener = /:root(?:\[[^\]]*\])?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(noComments))) {
    let depth = 1;
    let i = opener.lastIndex;
    while (i < noComments.length && depth > 0) {
      if (noComments[i] === '{') depth++;
      else if (noComments[i] === '}') depth--;
      i++;
    }
    const body = noComments.slice(opener.lastIndex, i - 1);
    for (const decl of body.split(';')) {
      const trimmed = decl.trim().replace(/\s+/g, ' ');
      if (trimmed.startsWith('--')) lines.push(`  ${trimmed};`);
    }
  }
  return lines.join('\n');
}

async function tokensSection(dir: string, budget: number): Promise<string | null> {
  const css = await readOptional(path.join(dir, 'tokens.css'));
  if (!css) return null;
  const trimmed = css.trim();

  if (trimmed.length <= budget) {
    return [
      'Design tokens (tokens.css) — verbatim. Paste this `:root` block into the',
      'first `<style>` before writing any component CSS, then reference every',
      'value via `var(--name)`:',
      '```css',
      trimmed,
      '```',
    ].join('\n');
  }

  const declarations = rootDeclarations(css);
  if (declarations.length === 0) {
    return `Design tokens (tokens.css, ${css.length} chars) exceeded the prompt budget and no \`:root\` declarations could be extracted; the file is skipped here — the DESIGN.md brief above still applies.`;
  }

  const body = clip(declarations, budget - 40, 'remaining custom properties elided for length');
  return [
    `Design tokens (tokens.css, ${css.length} chars) exceeded the prompt budget, so only its`,
    'custom-property declarations are shown below — comments and any non-token',
    'rule bodies are elided:',
    '```css',
    ':root {',
    body,
    '}',
    '```',
  ].join('\n');
}

// ─── design-tokens.json ──────────────────────────────────────────────────────

interface DesignTokensFile {
  summary?: unknown;
  tokens?: Array<{ name?: unknown }>;
}

async function designTokensSection(dir: string, budget: number): Promise<string | null> {
  const raw = await readOptional(path.join(dir, 'design-tokens.json'));
  if (!raw) return null;
  const trimmed = raw.trim();

  if (trimmed.length <= budget) {
    return `Design tokens metadata (design-tokens.json) — verbatim:\n\`\`\`json\n${trimmed}\n\`\`\``;
  }

  try {
    const parsed = JSON.parse(raw) as DesignTokensFile;
    const names = Array.isArray(parsed.tokens)
      ? parsed.tokens.map((t) => t.name).filter((n): n is string => typeof n === 'string')
      : [];
    if (names.length > 0) {
      const compact = JSON.stringify(
        { summary: parsed.summary ?? null, tokenNames: names },
        null,
        2,
      );
      const body = clip(compact, budget - 40, 'remaining token names elided for length');
      return [
        `Design tokens metadata (design-tokens.json, ${raw.length} chars) exceeded the prompt`,
        'budget, so only the top-level token names and summary are shown — full',
        'per-token provenance is elided:',
        '```json',
        body,
        '```',
      ].join('\n');
    }
  } catch {
    // Falls through to the raw-head fallback below.
  }

  const body = clip(
    raw,
    budget - 40,
    'remainder elided for length — the file could not be parsed for a token-name summary',
  );
  return `Design tokens metadata (design-tokens.json, ${raw.length} chars) exceeded the prompt budget:\n\`\`\`json\n${body}\n\`\`\``;
}

// ─── components.html / components.manifest.json ────────────────────────────

interface ComponentGroup {
  id?: unknown;
  label?: unknown;
  present?: unknown;
  classes?: unknown;
  elements?: unknown;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The manifest's own structural extraction — groups keyed by component kind. */
function formatComponentGroups(groups: ComponentGroup[]): string {
  return groups
    .filter((g) => g.present !== false)
    .map((g) => {
      const classes = stringList(g.classes);
      const elements = stringList(g.elements);
      const parts = [
        classes.length > 0 ? `classes: ${classes.join(', ')}` : null,
        elements.length > 0 ? `elements: ${elements.join(', ')}` : null,
      ].filter((p): p is string => p !== null);
      const detail = parts.length > 0 ? ` — ${parts.join('; ')}` : '';
      return `- ${String(g.id ?? '?')} (${String(g.label ?? '')})${detail}`;
    })
    .join('\n');
}

async function componentsSection(dir: string, budget: number): Promise<string | null> {
  const manifestRaw = await readOptional(path.join(dir, 'components.manifest.json'));
  if (manifestRaw) {
    try {
      const parsed = JSON.parse(manifestRaw) as { groups?: ComponentGroup[] };
      const inventory = formatComponentGroups(Array.isArray(parsed.groups) ? parsed.groups : []);
      if (inventory.length > 0) {
        const body = clip(inventory, budget - 200, 'remaining component groups elided for length');
        return [
          "Component inventory (from components.manifest.json — the package's own",
          'structural extraction of components.html; open components.html directly',
          'only when exact selectors or states matter):',
          body,
        ].join('\n');
      }
    } catch {
      // Falls through to the components.html head fallback.
    }
  }

  const html = await readOptional(path.join(dir, 'components.html'));
  if (!html) return null;
  const headBudget = Math.max(0, budget - 220);
  const body = clip(
    html,
    headBudget,
    'the rest of components.html is elided — no components.manifest.json was available for a structural inventory',
  );
  return [
    'Component inventory unavailable (no components.manifest.json); showing a',
    'capped head of components.html instead:',
    '```html',
    body,
    '```',
  ].join('\n');
}

// ─── USAGE.md-declared read order ───────────────────────────────────────────

const ARTIFACT_MARKERS: Array<{ key: ArtifactKey; needle: string }> = [
  { key: 'tokens', needle: 'tokens.css' },
  { key: 'components', needle: 'components.manifest.json' },
  { key: 'components', needle: 'components.html' },
  { key: 'designTokens', needle: 'design-tokens.json' },
];

const DEFAULT_ORDER: ArtifactKey[] = ['tokens', 'designTokens', 'components'];

/**
 * The order USAGE.md names these artifacts in, first mention wins per key.
 * Anything it doesn't mention (most packages never name `design-tokens.json`
 * in their read order) is appended in `DEFAULT_ORDER` afterward — tokens
 * first, since that is the highest-value artifact absent any other steer.
 */
function readOrder(usage: string): ArtifactKey[] {
  const hits = ARTIFACT_MARKERS.map((m) => ({ key: m.key, at: usage.indexOf(m.needle) }))
    .filter((h) => h.at !== -1)
    .sort((a, b) => a.at - b.at);

  const order: ArtifactKey[] = [];
  for (const hit of hits) if (!order.includes(hit.key)) order.push(hit.key);
  for (const key of DEFAULT_ORDER) if (!order.includes(key)) order.push(key);
  return order;
}

// ─── Assembly ────────────────────────────────────────────────────────────────

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The design-system depth section, or `""` when there is nothing to add —
 * no design system selected, the id doesn't resolve, or the package ships
 * none of these files. `""` is silently dropped by the caller, which is the
 * fail-soft contract: this module can never make the prompt worse than the
 * DESIGN.md-only prompt session.ts already builds.
 */
export async function designSystemContext(designSystem: string | null): Promise<string> {
  if (!designSystem) return '';
  const located = await rootForSystem(designSystem);
  if (!located) return '';
  const dir = path.join(located.root, designSystem);
  if (!(await exists(dir))) return '';

  const usageRaw = await readOptional(path.join(dir, 'USAGE.md'));
  const built: string[] = [];

  if (usageRaw) {
    const body = clip(usageRaw.trim(), SECTION_BUDGET.usage, 'USAGE.md truncated for length');
    built.push(`Package usage guide (USAGE.md):\n${body}`);
  }

  const builders: Record<ArtifactKey, () => Promise<string | null>> = {
    tokens: () => tokensSection(dir, SECTION_BUDGET.tokens),
    designTokens: () => designTokensSection(dir, SECTION_BUDGET.designTokens),
    components: () => componentsSection(dir, SECTION_BUDGET.components),
  };

  for (const key of readOrder(usageRaw ?? '')) {
    const section = await builders[key]();
    if (section) built.push(section);
  }

  if (built.length === 0) return '';

  // A second, total pass: per-section budgets can still overshoot the total
  // (every section maxed at once), so the running budget is the backstop —
  // same decrement-as-you-go shape `craftContext` uses for its own cap.
  let remaining = TOTAL_BUDGET;
  const finalSections: string[] = [];
  for (const section of built) {
    if (remaining <= 0) break;
    if (section.length <= remaining) {
      finalSections.push(section);
      remaining -= section.length;
    } else {
      finalSections.push(
        clip(
          section,
          remaining,
          'remaining design-system context elided — total prompt budget reached',
        ),
      );
      remaining = 0;
    }
  }

  return [
    '',
    `Design system package depth for "${designSystem}" — beyond the DESIGN.md brief above:`,
    '',
    finalSections.join('\n\n'),
  ].join('\n');
}
