/**
 * Studio deep-link query params (OD-005): `/projects/:id/studio?session=<designId>&file=<path>`
 * lets another surface hand the user straight into a specific design session
 * and file, instead of always landing on whatever `StudioSurface` defaults to
 * (currently: the first design, and its first file).
 *
 * Pure and DOM-free so it's unit-testable without mounting the page — the
 * same shape of contract as `gateComposer` in `lib/composer.ts`.
 *
 * Wired: `StudioSurface` (components/studio/studio-surface.tsx) calls
 * `parseStudioDeepLink(useSearchParams())` and prefers `deepLink.designId`/
 * `deepLink.filePath` over `next[0]?.id`/`paths[0]` when picking the design
 * and focused file to open on load. Mirrors the existing deep-link idiom
 * elsewhere in this codebase (`board-view.tsx`'s `?task=`,
 * `objectives/page.tsx`'s `?goal=`): the component that owns the state reads
 * `useSearchParams()` itself, no prop threading needed.
 */
export interface StudioDeepLink {
  /** The `session` param — a design id to open, or `null` when absent/blank. */
  designId: string | null;
  /** The `file` param — a design-relative path to select, or `null` when absent/blank. */
  filePath: string | null;
}

export function parseStudioDeepLink(searchParams: URLSearchParams): StudioDeepLink {
  // `design` is an alias for `session` — deck cards and the task detail panel's
  // "see where this came from" link both produce `?design=` (W4); without this,
  // every such link landed on designs[0] instead of the design under review.
  const session = (searchParams.get('session') ?? searchParams.get('design'))?.trim();
  const file = searchParams.get('file')?.trim();
  return {
    designId: session ? session : null,
    filePath: file ? file : null,
  };
}
