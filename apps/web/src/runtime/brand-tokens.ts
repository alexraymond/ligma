/**
 * The design-system wizard's data layer — everything DOM-free, so the app's
 * node-environment vitest covers it (the split `components/library/catalog.ts`
 * already uses).
 *
 * The daemon is authoritative on every rule here: it re-validates the token
 * set, re-derives the id, and owns collision refusal. What lives in this file
 * is only what the *form* needs to answer without a round trip — is the button
 * enabled yet, what will the id be, which swatch is a colour. Duplicating the
 * two smallest rules (slug shape, required token list) buys an editable form
 * that does not flash server errors on every keystroke; the server still has
 * the last word, and disagreeing with it can only ever show a message.
 */

import { apiFetch } from '@/lib/api-client';
import { API_ROUTES } from '@ligma/api';

/** `designSystemWizardExtractBrand` / `designSystemWizardCreateFromTokens` in `packages/api/src/routes.ts`, aliased here so callers keep the wizard-scoped names. */
export const WIZARD_ROUTES = {
  extractBrand: API_ROUTES.designSystemWizardExtractBrand,
  createFromTokens: API_ROUTES.designSystemWizardCreateFromTokens,
} as const;

/** The tokens a package must declare — mirrors `REQUIRED_TOKENS` in the daemon. */
export const REQUIRED_TOKENS = [
  'bg',
  'surface',
  'fg',
  'muted',
  'border',
  'accent',
  'font-display',
  'font-body',
] as const;

/**
 * A neutral, accessible starting point for "start from scratch".
 *
 * Not a brand — a grey page with one blue accent — so the first screen after
 * choosing scratch is a *working* system to edit rather than eight empty
 * fields. Everything else (radius, spacing, elevation, motion) is filled by the
 * daemon from `design-systems/_schema/defaults.css` and is not shown here.
 */
export const SCRATCH_TOKENS: Record<string, string> = {
  bg: '#ffffff',
  surface: '#f7f7f7',
  fg: '#18181b',
  'fg-2': '#3f3f46',
  muted: '#71717a',
  border: '#e4e4e7',
  accent: '#2563eb',
  'accent-on': '#ffffff',
  'font-display': 'system-ui, -apple-system, sans-serif',
  'font-body': 'system-ui, -apple-system, sans-serif',
};

// ─── Shapes the daemon returns ───────────────────────────────────────────────

export interface BrandColorCandidate {
  hex: string;
  count: number;
  sources: string[];
  extreme: boolean;
}

export interface BrandFontCandidate {
  family: string;
  count: number;
}

/** `POST /api/design-systems/wizard/extract-brand`. */
export interface BrandExtraction {
  url: string;
  tokens: Record<string, string>;
  colors: BrandColorCandidate[];
  fonts: BrandFontCandidate[];
  themeColor: string | null;
  stylesheets: string[];
  /** What the daemon inferred rather than measured. Shown, never hidden. */
  notes: string[];
}

export interface CreateDesignSystemInput {
  name: string;
  category?: string;
  blurb?: string;
  sourceUrl?: string;
  overwrite?: boolean;
  tokens: Record<string, string>;
}

export interface CreateDesignSystemResult {
  id: string;
  name: string;
  files: string[];
  /** True when an existing user-authored package was replaced in place. */
  replaced: boolean;
}

/** A refusal that the form can act on rather than just print. */
export class WizardError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 409 on an id the user already owns — offer overwrite instead of a dead end. */
    readonly overwritable = false,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'WizardError';
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
      overwritable?: boolean;
      details?: unknown;
    };
    const details = Array.isArray(failure.details)
      ? failure.details.map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))
      : [];
    throw new WizardError(
      failure.error ?? `Request failed (${response.status})`,
      response.status,
      failure.overwritable === true,
      details,
    );
  }
  return (await response.json()) as T;
}

export function extractBrand(url: string): Promise<BrandExtraction> {
  return post<BrandExtraction>(WIZARD_ROUTES.extractBrand, { url });
}

export function createDesignSystem(
  input: CreateDesignSystemInput,
): Promise<CreateDesignSystemResult> {
  return post<CreateDesignSystemResult>(WIZARD_ROUTES.createFromTokens, input);
}

// ─── Form rules ──────────────────────────────────────────────────────────────

/** A display name reduced to a directory slug — mirrors the daemon's. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Drop the combining marks NFKD just split off, so "Ünï" slugs to "uni"
      // rather than to "u-ni".
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
  );
}

/** Required tokens the user has not filled in yet. Empty ⇒ the form may submit. */
export function missingTokens(tokens: Record<string, string>): string[] {
  return REQUIRED_TOKENS.filter((token) => (tokens[token] ?? '').trim().length === 0);
}

/** Whether a value can be shown as a swatch chip rather than as text. */
export function isColorToken(name: string): boolean {
  return !name.startsWith('font-');
}

/**
 * Token rows in the order the review step shows them: the neutrals in
 * light-to-dark reading order, then the accent, then the families. Anything the
 * extractor proposed that is not in the list follows, so a token can be added
 * server-side without disappearing from the form.
 */
const TOKEN_ORDER = ['bg', 'surface', 'border', 'muted', 'fg-2', 'fg', 'accent', 'accent-on'];

export function orderedTokens(tokens: Record<string, string>): Array<[string, string]> {
  const names = Object.keys(tokens);
  const colors = names.filter(isColorToken).sort((a, b) => {
    const ai = TOKEN_ORDER.indexOf(a);
    const bi = TOKEN_ORDER.indexOf(b);
    return (
      (ai === -1 ? TOKEN_ORDER.length : ai) - (bi === -1 ? TOKEN_ORDER.length : bi) ||
      a.localeCompare(b)
    );
  });
  const fonts = names.filter((name) => !isColorToken(name)).sort();
  return [...colors, ...fonts].map((name) => [name, tokens[name]]);
}

/**
 * The `srcdoc` for the review step's live preview.
 *
 * Same idea as the Library's specimen: rather than describe the tokens, apply
 * them to a few real elements so the reviewer sees the system they are about to
 * create. Values are inlined into a `<style>`, which is exactly why the daemon
 * refuses `;`, `{`, `}` and `<` inside a token value.
 */
export function previewSrcdoc(tokens: Record<string, string>): string {
  const root = Object.entries(tokens)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root {
${root}
}
body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font-family: var(--font-body); }
h1 { font-family: var(--font-display); font-size: 28px; margin: 0 0 8px; }
p { color: var(--muted); margin: 0 0 20px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.btn { background: var(--accent); color: var(--accent-on, #fff); border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-weight: 600; }
.btn.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
</style></head><body>
<h1>Specimen</h1>
<p>Your tokens, applied to real elements.</p>
<div class="card"><strong>Card surface</strong></div>
<button class="btn">Primary</button>
<button class="btn secondary">Secondary</button>
</body></html>`;
}
