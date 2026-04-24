---
name: css-grid-minmax0-for-intrinsic-width-children
description: Diagnose and fix runaway horizontal overflow in a CSS grid (or flex row) whose children host fixed-width content — iframes, canvases, images with natural width, or any `width: 1280px`-style element. Applies when a grid is supposed to be responsive (`repeat(N, 1fr)`) but one row stretches off-screen well past its `max-width` container, especially after introducing a card-grid layout with scaled iframe previews. Trigger words — "grid extending infinitely", "hero card overflow", "card wider than max-w container", "grid cell too wide", "repeat 1fr not shrinking", "iframe escaping card", "DesignCardPreview bursting container", "min-content forcing track growth", "minmax(0, 1fr)".
allowed-tools: Read, Grep, Edit
---

# Grid tracks with auto min-width expand to fit fixed-width children

## The trap

`grid-template-columns: repeat(4, 1fr)` is shorthand for `repeat(4, minmax(auto, 1fr))`. The implicit `auto` min means **each track grows to at least its child's intrinsic (min-content) size**. A 1280-px iframe, a `<canvas>` with width attribute, or any element with `width: 1280px` will force its track to ≥ 1280 px — and four of those = 5120 px of grid, blowing past even a `max-w-[1600px]` parent.

Same trap exists in flex rows: `flex: 1` defaults to `flex-basis: 0` but `min-width: auto`. A child with a wide iframe forces the flex item to be at least that wide.

## How to recognize

- Horizontal scroll appears in a container that has `max-width` or `overflow-y: auto` (vertical overflow alone doesn't hide this).
- The overflow grows proportionally to **each** card you add to the row, not just one.
- The content that "bursts" is a scaled-iframe thumbnail, a canvas preview, or an image with a natural width larger than a track's 1fr share.
- Clipping with `overflow: hidden` on the *inner* div works, but the *outer* grid track still expanded — so `max-w` fails.
- The culprit usually sits behind a `position: absolute; inset: 0` wrapper, but the grid's track sizing runs *before* the absolute positioning takes effect.

## Minimum fix

**Grid:**
```tsx
// Before
gridTemplateColumns: 'repeat(4, 1fr)'
// After
gridTemplateColumns: 'repeat(4, minmax(0, 1fr))'
```

**Every grid child that might host a wide descendant:**
```tsx
<div style={{ minWidth: 0 /* plus whatever else */ }}>
  <HomeCard design={hero} variant="hero" />
</div>
```

**Why both?** `minmax(0, 1fr)` tells the *track* not to grow. `min-width: 0` tells the *grid item* not to grow. Without the child-level `min-width: 0`, the child can still overflow the track (and then be clipped, which is usually what you want — but some layouts have nested flex/grid that cascade the same trap).

For flex rows: `min-width: 0` on the flex child is the equivalent. A flex container with `.flex-1 min-w-0` children is the idiomatic Tailwind form.

## Concrete example (from this repo)

Ligma's Home wall renders tape-pinned cards in a 4-column grid. Each `HomeCard` contains `DesignCardPreview`, which renders a 1280 × 960 iframe scaled down via CSS transform. The preview container had `overflow: hidden`, but the outer track still expanded to 1280 px per column → 5120 px total. The Today hero card (`grid-column: 1 / span 2`) looked like a very tall narrow strip on the left because the preview *inside* extended right across two columns and past them.

Fix was in `apps/desktop/src/renderer/src/views/home/HomeRow.tsx`:

```tsx
const PLAIN_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',  // was 'repeat(4, 1fr)'
  gap: '18px',
};
const CELL_STYLE: CSSProperties = { minWidth: 0 };

<div style={PLAIN_GRID}>
  {designs.map((d) => (
    <div key={d.id} style={CELL_STYLE}>
      <HomeCard design={d} />
    </div>
  ))}
</div>
```

## How to diagnose quickly

1. Open DevTools, inspect the overflowing grid, look at *computed* `grid-template-columns`. If any track is much larger than `(container-width / N)`, you've hit this.
2. Temporarily add `* { outline: 1px solid red }` to see which child is widening the track.
3. Search the codebase for `position: absolute` iframe/canvas hosts (those often have a fixed parent `width`). Those are the usual offenders.

## When NOT to apply

- If you *want* the track to expand for oversize content (a true horizontal scroll by design — e.g. a timeline), keep `auto` min. The trap is that `1fr` *looks* like "share equally" but only does so when no child has intrinsic min-width.
- If the grid uses `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))` with an *explicit* pixel min, the `minmax(0, ...)` swap would shrink cards below 260 px — use the explicit min instead, and add `min-width: 0` on grid children.

## Related traps

- **Nested `<button>`** inside a card: if the whole card is `<button>` + you add a "More actions" `<button>` inside, React logs a hydration warning. Fix: make the card a `<div>` and place an `absolute inset-0 z-[1]` transparent button as an overlay sibling. (Bumped into this in the same Home wall commit.)
- **Flex child not shrinking**: `min-width: auto` on flex children causes the same intrinsic-width expansion. Tailwind's `min-w-0` is the same fix.
