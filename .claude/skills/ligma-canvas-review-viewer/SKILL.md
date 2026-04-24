---
name: ligma-canvas-review-viewer
description: Produce a trackpad-friendly viewer for a multi-artboard Ligma canvas. Use when the user generates a DESIGN_CANVAS output (e.g. a "four directions" / multi-viewport / before-after exploration) and needs to review all artboards without horizontal pan/zoom — particularly on macOS trackpads where Ligma's Phase 2 viewport pan shortcuts (Cmd+wheel / Space+drag / middle-click) are undiscoverable or impractical. Trigger words — "can't see all artboards", "only one design visible", "4 directions", "canvas too wide", "no pan/zoom controls", "horizontal overflow", "ligma-gen only shows one".
allowed-tools: Read, Write, Edit, Bash
---

# Ligma canvas review viewer

## The problem

Ligma's `design-canvas.v1.txt` contract tiles artboards **horizontally** via
`grid-auto-flow: column`, producing a canvas as wide as `N × native_width`
(e.g. 4 × 1440 = 5760px). Reviewing this requires horizontal panning:

- **In Ligma**: `Cmd+wheel` zoom, `Space+drag` pan, middle-click-drag pan.
  None are discoverable; middle-click doesn't exist on trackpads.
- **In a browser**: horizontal scrollbars auto-hide on macOS. Two-finger swipe
  through iframe boundaries is flaky. User sees only the leftmost artboard
  and assumes generation failed.

## The fix — a stacked-viewer HTML

Extract the generated HTML and inject an override stylesheet that re-lays
the artboards **vertically** so normal scroll reveals them all.

### How to extract the HTML from SQLite

Ligma stores artifacts in `~/Library/Application Support/@ligma/desktop/designs.db`:

```bash
DESIGN_ID='<from logs e.g. design.renamed id>'
sqlite3 "$HOME/Library/Application Support/@ligma/desktop/designs.db" \
  "SELECT artifact_source FROM design_snapshots
   WHERE design_id='$DESIGN_ID'
   ORDER BY created_at DESC LIMIT 1;" > /tmp/ligma-gen.html
```

### The override to inject

Append this `<style>` block *before* the closing `</style>` of the generated
HTML (the canvas stylesheet is at the top of the same `<style>` block — your
overrides win via CSS source order + `!important`):

```css
/* VIEWER OVERRIDE — stack artboards vertically for trackpad review */
body.ligma-canvas {
  display: block !important;
  padding: 32px 48px 96px !important;
  background: #e8e6de !important;
}
body.ligma-canvas::before {
  content: "Scroll ↓ to compare A · B · C · D.";
  display: block;
  font: 500 13px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 10px 16px; margin: 0 auto 32px;
  max-width: 1440px; border: 1px solid #3a3930; background: #fff;
}
body.ligma-canvas > section[data-canvas-section] {
  display: flex !important;
  flex-direction: column !important;
  gap: 64px !important;
  grid-auto-flow: initial !important;
  grid-auto-columns: initial !important;
}
body.ligma-canvas > section[data-canvas-section]::before { display: none !important; }
body.ligma-canvas [data-artboard] {
  margin: 0 auto !important;
  width: 1440px !important;
  flex: 0 0 auto !important;
  box-shadow: 0 32px 64px -32px rgba(20,18,10,0.22) !important;
}
body.ligma-canvas [data-artboard]::before {
  top: -30px !important; font-size: 13px !important;
  letter-spacing: 0.14em !important; color: #3a3930 !important;
  font-weight: 600 !important;
}
@media (max-width: 1540px) {
  body.ligma-canvas [data-artboard] {
    transform: scale(calc((100vw - 96px) / 1440));
    transform-origin: top center;
    margin-bottom: calc(-900px * (1 - ((100vw - 96px) / 1440))) !important;
  }
}
```

### Open and link

```bash
cp /tmp/ligma-gen.html .claude/workspace/YYYY-MM-DD-<topic>-viewer.html
open .claude/workspace/YYYY-MM-DD-<topic>-viewer.html
```

## Why this works where `open ligma-gen.html` alone fails

1. `display: block` on `body.ligma-canvas` + `flex-direction: column` on the
   section overrides the horizontal grid. Vertical scroll is bulletproof on
   touchpads; horizontal scroll is not.
2. Native-width `1440px` artboards keep the rendered CSS pixel-accurate; the
   `@media (max-width: 1540px)` fallback scales them for narrow monitors
   *without* reflowing internal layouts (which would corrupt 12-col grids,
   chip rows, etc.).
3. The `::before` banner on `body.ligma-canvas` gives immediate orientation
   — otherwise users are confused about what they're looking at.

## Related — the Phase 2 canvas bug this works around

`apps/desktop/src/renderer/src/components/canvas/CanvasViewport.tsx` ships
pan via `Space+drag` + middle-click only. CanvasViewport's direct child is
`<div className="relative h-full w-full">`, which is constrained to the
parent's size and never overflows — so `overflow-auto` never triggers.
Two-finger trackpad swipe falls through into the iframe, whose scroll
events don't bubble back out. A real fix needs (a) letting the inner
wrapper size to content when content overflows, and (b) a "Fit to viewport"
button on `PreviewToolbar`. Until that ships, use this viewer.
