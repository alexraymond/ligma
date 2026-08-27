/**
 * The Library's data layer: the two catalog fetches, plus the pure state the
 * master–detail shell runs on.
 *
 * Everything DOM-free lives here so the app's node-environment vitest can
 * cover it — the same split `components/studio/api.ts` uses.
 */

import { apiFetch } from '@/lib/api-client';
import { API_ROUTES } from '@ligma/api';
import type {
  CraftRule,
  CraftRulesResponse,
  DesignSystemDetail,
  DesignSystemSummary,
  DesignSystemsResponse,
  SkillCatalogDetail,
  SkillCatalogEntry,
  SkillCatalogResponse,
} from '@ligma/api';

// ─── Fetches ─────────────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchDesignSystems(): Promise<DesignSystemSummary[]> {
  return (await getJson<DesignSystemsResponse>(API_ROUTES.designSystems)).systems;
}

export function fetchDesignSystem(id: string): Promise<DesignSystemDetail> {
  return getJson<DesignSystemDetail>(`${API_ROUTES.designSystems}?id=${encodeURIComponent(id)}`);
}

export async function fetchCraftRules(): Promise<CraftRule[]> {
  return (await getJson<CraftRulesResponse>(API_ROUTES.craftRules)).rules;
}

/**
 * The vendored `skills/` catalog (OD-077). Named `skillCatalog` to avoid the
 * unrelated, pre-existing `/api/skills` route (the user-authored skill
 * library the "AI Commands"/agent-skills tab below already covers).
 */
export async function fetchSkillCatalog(): Promise<SkillCatalogEntry[]> {
  return (await getJson<SkillCatalogResponse>(API_ROUTES.skillCatalog)).skills;
}

export function fetchSkillCatalogEntry(id: string): Promise<SkillCatalogDetail> {
  return getJson<SkillCatalogDetail>(`${API_ROUTES.skillCatalog}?id=${encodeURIComponent(id)}`);
}

// ─── Master list state ───────────────────────────────────────────────────────

/** The fields a catalog row is searched across. Any may be absent. */
export interface CatalogEntry {
  id: string;
  label: string;
  meta?: string;
  blurb?: string;
}

/**
 * Substring filter over label, meta and blurb.
 *
 * A catalog that scaled to 150 systems upstream needs a filter box, and a
 * filter box that only matches the name makes you remember names. ponytail:
 * case-insensitive `includes`, not fuzzy ranking — add ranking when a hundred
 * rows make ordering matter, the daemon already sorts them.
 */
export function filterEntries<T extends CatalogEntry>(entries: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [entry.label, entry.meta, entry.blurb].some((field) => field?.toLowerCase().includes(needle)),
  );
}

/**
 * The id `delta` steps away from `current`, clamped at both ends.
 *
 * Clamped, not wrapping: arrow-key browsing through a long list should stop at
 * the end rather than teleport you back to the top. An unknown or absent
 * `current` starts from the first row.
 */
/**
 * Sorts entries by use count, most-used first — OD-154/155's ranking half of
 * "search + ranking". A stable sort (guaranteed by the spec since ES2019)
 * keeps every entry with the same count — including every entry nobody has
 * used yet, the common case for a freshly-vendored catalog — in the order the
 * catalog already listed it, so ranking never reshuffles a list with no usage
 * data to rank by.
 */
export function rankByUse<T extends CatalogEntry>(
  entries: T[],
  useCounts: Record<string, number>,
): T[] {
  return [...entries].sort((a, b) => (useCounts[b.id] ?? 0) - (useCounts[a.id] ?? 0));
}

export function moveSelection(ids: string[], current: string | null, delta: number): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return ids[0];
  const next = Math.min(ids.length - 1, Math.max(0, index + delta));
  return ids[next];
}

/** Keeps a selection valid as the filter narrows: falls back to the first row. */
export function reconcileSelection(ids: string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  return current !== null && ids.includes(current) ? current : ids[0];
}

// ─── Live preview ────────────────────────────────────────────────────────────

/**
 * The specimen shown when a package ships no `components.html`.
 *
 * Not a screenshot and not a mock: the package's own `tokens.css` is applied to
 * a handful of real elements, so what renders is the system, at the fidelity
 * the tokens actually carry.
 */
export function specimenSrcdoc(tokensCss: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${tokensCss}
body { margin: 0; padding: 32px; background: var(--bg, #fff); color: var(--fg, #111); font-family: var(--font-body, system-ui, sans-serif); }
h1 { font-family: var(--font-display, inherit); font-size: var(--text-3xl, 2rem); line-height: var(--leading-tight, 1.15); margin: 0 0 12px; }
p { color: var(--muted, #666); line-height: var(--leading-normal, 1.6); max-width: 52ch; margin: 0 0 24px; }
.card { background: var(--surface, #fafafa); border: 1px solid var(--border, #e5e5e5); border-radius: var(--radius-lg, 12px); padding: 20px; margin-bottom: 16px; }
.btn { display: inline-block; background: var(--accent, #333); color: var(--accent-fg, #fff); border: 0; border-radius: var(--radius-md, 8px); padding: 10px 18px; font: inherit; font-weight: 600; cursor: default; }
.btn.secondary { background: transparent; color: var(--fg, #111); border: 1px solid var(--border, #e5e5e5); }
input { display: block; width: 100%; box-sizing: border-box; margin-top: 12px; padding: 10px 12px; background: var(--bg, #fff); color: var(--fg, #111); border: 1px solid var(--border, #e5e5e5); border-radius: var(--radius-md, 8px); font: inherit; }
code { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm, 0.875rem); }
</style></head><body>
<h1>Specimen</h1>
<p>This package ships no <code>components.html</code>, so its <code>tokens.css</code> is applied to a few real elements instead.</p>
<div class="card">
  <strong>Card surface</strong>
  <input value="Input field" readonly>
</div>
<button class="btn">Primary</button>
<button class="btn secondary">Secondary</button>
</body></html>`;
}

/**
 * What the live-preview iframe renders for a package.
 *
 * ponytail: `components.html` goes in verbatim — no overlay splice. The
 * Studio's `buildDesignSrcdoc` injects the pin-capture overlay because a design
 * is something you comment on; a catalog entry is something you look at, and an
 * overlay here would be script the sandbox has to allow for no benefit.
 */
export function previewSrcdoc(detail: Pick<DesignSystemDetail, 'preview' | 'tokensCss'>): string {
  return detail.preview ?? specimenSrcdoc(detail.tokensCss);
}

/** Whether the preview pane is showing the package's own document. */
export function previewIsAuthored(detail: Pick<DesignSystemDetail, 'preview'>): boolean {
  return detail.preview !== null;
}

/**
 * A file inside a vendored design-system package, as the daemon serves it
 * (D7 OD-071). The Library lists what a package carries; this is the URL that
 * makes those names openable.
 */
export function packageFileHref(id: string, relPath: string): string {
  const base = API_ROUTES.designSystemFile.replace(':id', encodeURIComponent(id));
  return `${base}?path=${encodeURIComponent(relPath)}`;
}
