/**
 * The structural stylesheet the generator copies into its design.
 *
 * Layout rules stated as prose in a system prompt get violated: spans that
 * should have been blocks stay inline, copy truncates where nothing asked it
 * to, media distorts, rails do not scroll. So the rules stop being prose. The
 * generator copies this sheet verbatim and uses the classes, instead of
 * re-deriving flex/grid/overflow from an instruction every turn.
 *
 * Structure only — no colour, type or spacing scale — and every selector is
 * zero-specificity (`@layer` + `:where()`), so whatever the design system says
 * about how a thing *looks* always wins over what this says about how it
 * *stacks*.
 *
 * Adapted from open-design (Apache-2.0), commit f1a73f0d8,
 * `plugins/_official/scenarios/od-next-strategy/assets/task-profiles/prototype/layout.css`.
 * Ligma changes: the `od-` prefix becomes `lg-`, comments are ours.
 */

const LAYOUT_CSS = `/* lg-layout v1 — structure only: display, flex/grid, overflow, wrapping, ratio.
   Put this @layer first; product CSS outside the layer always wins. */
@layer lg-layout {
  :where(.lg-stack,.lg-row,.lg-row-top,.lg-cluster,.lg-grid,.lg-field,.lg-stat,.lg-cell,.lg-tile) > :where(*) { min-width: 0; }

  /* containers */
  .lg-stack   { display: flex; flex-direction: column; gap: var(--lg-gap, 8px); }
  .lg-row     { display: flex; align-items: center; gap: var(--lg-gap, 8px); }
  .lg-row-top { display: flex; align-items: flex-start; gap: var(--lg-gap, 8px); }
  .lg-cluster { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lg-gap, 8px); }
  .lg-fill    { flex: 1 1 0; min-width: 0; }
  .lg-fixed   { flex: none; }
  .lg-grid    { display: grid; gap: var(--lg-gap, 12px); grid-template-columns: repeat(var(--lg-cols, 3), minmax(0, 1fr)); }

  /* stacked information: each piece is its own line — never sibling inline spans */
  .lg-stat, .lg-field, .lg-cell { display: grid; gap: var(--lg-gap, 2px); }
  :where(.lg-stat,.lg-field,.lg-cell) > :where(*) { display: block; }
  .lg-tile { display: grid; grid-template-rows: auto 1fr; }
  :where(.lg-tile) > :where(*) { display: block; }

  /* media keeps its intrinsic ratio by default; height:auto lets the ratio win
     over an <img height="…"> attribute. Cropping is an explicit opt-in: set
     --lg-ratio AND add .lg-media-cover, only where the crop is deliberate. */
  .lg-media { display: block; width: 100%; height: auto; aspect-ratio: var(--lg-ratio, auto); }
  .lg-media-cover { object-fit: cover; }

  /* data text only — authored copy is rewritten to its budget instead */
  .lg-truncate { display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lg-clamp-2, .lg-clamp-3 { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .lg-clamp-2 { -webkit-line-clamp: 2; }
  .lg-clamp-3 { -webkit-line-clamp: 3; }
  .lg-lines-2 { min-height: calc(2 * 1.4em); }   /* reserve two lines for a shared baseline */
  .lg-nowrap  { white-space: nowrap; }            /* number+unit, price+from, date+weekday */
  .lg-keep    { word-break: keep-all; overflow-wrap: anywhere; } /* CJK labels break at spaces first */

  /* screen skeleton: bars take their own space, the middle scrolls */
  .lg-screen { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
  .lg-scroll { overflow-y: auto; overscroll-behavior: contain; min-height: 0; }

  /* horizontal rail: the next item peeks at the edge; trailing room survives overflow */
  .lg-rail { display: flex; gap: var(--lg-gap, 8px); overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none;
             padding-inline: var(--lg-rail-pad, 16px); scroll-padding-inline: var(--lg-rail-pad, 16px); }
  .lg-rail::-webkit-scrollbar { display: none; }
  :where(.lg-rail) > :where(*) { flex: none; scroll-snap-align: start; }
  :where(.lg-rail) > :where(:last-child) { margin-inline-end: var(--lg-rail-pad, 16px); }

  .lg-spacer { flex: none; visibility: hidden; pointer-events: none; }
  .lg-touch  { min-width: 44px; min-height: 44px; }
}
/* /lg-layout v1 */`;

/** The prompt fragment: the instruction, then the sheet to copy. */
export const LAYOUT_PRIMITIVES = [
  '',
  'Layout primitives — copy this stylesheet verbatim into a `<style>` block in every screen (or into one',
  '`.css` file they all link) and use the classes for structure. It sets structure only and carries no',
  "specificity, so your own rules — and the design system's — override it freely.",
  '',
  '```css',
  LAYOUT_CSS,
  '```',
].join('\n');
