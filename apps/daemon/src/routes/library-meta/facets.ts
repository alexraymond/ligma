/**
 * The vendored `skills/<id>/SKILL.md` catalog's structured facets (OD-007).
 *
 * Derived from frontmatter only — pulled apart from `frontmatter`, the same
 * `Record<string, unknown>` `@ligma/core`'s `parseFrontmatter` already returns
 * for `skill-catalog/route.ts` — never from the body prose. A sample across
 * all 136 vendored skills found:
 *
 *   - `od.mode`            136/136 — every skill sets it (design-system,
 *                          prototype, image, video, template, deck, utility,
 *                          audio, design). The one facet with full coverage.
 *   - top-level `category` 24/136  — a curated subset (fine-grained: "card",
 *                          "article", …).
 *   - `od.category`        93/136  — a different, broader subset (coarse:
 *                          "image-generation", "design-systems", …). Disjoint
 *                          from top-level `category` — the two never
 *                          co-occur on the same skill — so preferring
 *                          top-level and falling back to `od.category` covers
 *                          117/136.
 *   - top-level `tags`     24/136  — same curated subset as top-level
 *                          `category`.
 *
 * design-systems/*.json needs none of this: `manifest.json`'s own `category`
 * is already on `DesignSystemSummary` (151/151 coverage), so the Library
 * derives that facet client-side from the catalog it already fetches. `craft/`
 * rulebooks carry no frontmatter at all — scanning their prose for a facet
 * would violate the "never by keyword-scanning body text" rule, so craft gets
 * no facet beyond "Saved".
 */

import type { SkillFacetEntry } from '@ligma/api';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** One skill's facets from its already-parsed SKILL.md frontmatter. */
export function deriveSkillFacet(
  id: string,
  frontmatter: Record<string, unknown>,
): SkillFacetEntry {
  const od = asRecord(frontmatter.od);
  return {
    id,
    mode: asString(od?.mode),
    category: asString(frontmatter.category) ?? asString(od?.category),
    tags: asStringArray(frontmatter.tags),
  };
}
