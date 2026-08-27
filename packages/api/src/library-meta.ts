/**
 * The Library's use-tracking, bookmarks and skill-catalog facets (OD-007/008,
 * OD-154-159) — a "reserved module file" the same way `catalogs.ts`,
 * `briefs.ts` and `evidence-pins.ts` are: its own workstream, its own file, no
 * edits to a file another wave already owns.
 *
 * These three catalogs are read-only vendored trees; the only thing worth
 * storing is what a *user* does with them — how often an entry gets used, and
 * which ones they bookmarked. `LibraryMetaEntry` is that, nothing else.
 */

/** The three vendored catalogs the Library browses. No registry, no remote kind. */
export type LibraryCatalogKind = 'design-system' | 'skill' | 'craft';

/** Per-entry use count + bookmark, keyed by `${kind}:${id}` in the store. */
export interface LibraryMetaEntry {
  kind: LibraryCatalogKind;
  id: string;
  useCount: number;
  saved: boolean;
}

/** `GET /api/library-meta` — every entry that has ever been used or bookmarked. */
export interface LibraryMetaResponse {
  entries: LibraryMetaEntry[];
}

/** `POST /api/library-meta/use` body. */
export interface LibraryMetaUseRequest {
  kind: LibraryCatalogKind;
  id: string;
}

/** `POST /api/library-meta/bookmark` body. */
export interface LibraryMetaBookmarkRequest {
  kind: LibraryCatalogKind;
  id: string;
  saved: boolean;
}

/**
 * One vendored `skills/<id>/SKILL.md` package's structured facets —
 * `GET /api/library-meta/facets`.
 *
 * Derived from the file's own YAML frontmatter only, never from the body:
 * `mode` is `od.mode`, set on every one of the 136 vendored skills; `category`
 * prefers the flat top-level `category` (a 24-skill curated subset) and falls
 * back to the nested `od.category` (a 93-skill subset) — the two never
 * co-occur, so together they cover 117/136; `tags` is the top-level `tags`
 * array, present on the same 24-skill curated subset as top-level `category`.
 */
export interface SkillFacetEntry {
  id: string;
  mode: string | null;
  category: string | null;
  tags: string[];
}

export interface SkillFacetsResponse {
  skills: SkillFacetEntry[];
}
