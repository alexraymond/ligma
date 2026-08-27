/**
 * Generic facet filtering over a catalog's already-fetched entries.
 *
 * One facet dimension is a single field on the entry (a design system's
 * `category`, a skill's `mode`) reduced to its distinct values, each shown as
 * an option with a count so the picker reads like open-design's
 * `plugins-home/facets.ts` did — pick a value, see how many rows carry it —
 * without a server round trip: the values are already in memory once the
 * catalog itself has loaded.
 *
 * ponytail: single-select per facet, not a `Set` of selections. Nothing here
 * has two independent, worth-combining values per entry yet (a design system
 * has exactly one category); add multi-select the day a facet does.
 */

export interface FacetOption {
  value: string;
  count: number;
}

/** Distinct values across `values`, sorted by frequency then alphabetically. Blanks excluded. */
export function facetOptions(values: Array<string | null | undefined>): FacetOption[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** `null` (or the sentinel `"__all__"`) matches everything — the "All" option. */
export function matchesFacet(value: string | null | undefined, selected: string | null): boolean {
  return selected === null || value === selected;
}

/** Any tag in `tags` equals `selected`, or `selected` is unset. */
export function matchesTagFacet(tags: string[], selected: string | null): boolean {
  return selected === null || tags.includes(selected);
}
