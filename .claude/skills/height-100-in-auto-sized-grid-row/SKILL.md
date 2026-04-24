---
name: height-100-in-auto-sized-grid-row
description: Diagnose and fix the "card frame ends early, meta/title renders below the card on the background" bug that happens when a React/CSS card with `height: 100%` sits inside a CSS grid (or flex) whose row is auto-sized, AND the card contains a `flex: 1` child with `min-height`. The card's visible *frame* (background + border) stops at the preview's min-height while the meta/plaque/footer DOM nodes render *below* the frame on the page background. Applies to thumbnail grids, preview cards, tape-pinned card walls. Trigger words — "title overlapping frame", "plaque outside card", "card frame ends early", "meta row below card", "text bleeding onto background", "card content escapes paper frame", "aspect-ratio vs flex min-height fight".
allowed-tools: Read, Grep, Edit
---

# `height: 100%` + auto-sized grid row + flex child with min-height = broken

## The bug

A card component with this shape:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
  <div style={{ flex: 1, minHeight: 150 /* preview */ }} />
  <div>{/* meta row */}</div>
  <div>{/* plaque / footer */}</div>
</div>
```

Placed in a CSS grid with `grid-auto-rows: auto` (or no explicit row sizing). Users see the card's **background/border stop at the preview**, and the meta + plaque rows render *beneath* the paper frame on the page background — as if the card's visible "frame" is shorter than its DOM content.

## Why

CSS grid resolves in this order when computing track heights:

1. Grid row wants `auto` (content-sized).
2. Card inside asks "100% of what?" — of the row, which is sized to content, which is sized to the card… circular.
3. Chromium breaks the cycle by sizing the row to just the card's *intrinsic min-content height*: the preview's `min-height` + a minimal meta row. Meta's actual rendered height isn't fed back.
4. Card gets `height: 100%` = that resolved row height (preview-only).
5. But the DOM tree still renders all three children. With `overflow: visible` (the default), meta + plaque paint **outside** the card's background/border box.

Flex children with `min-height` and `flex: 1` make it worse because the flex algorithm tries to satisfy `min-height` first, then gives the flex-basis its share — but the container's own height is underdetermined.

## The fix

Option A (recommended for card-wall layouts): **drop `height: 100%` and use `aspect-ratio` on the preview**. The card auto-sizes to its content; the preview scales with column width.

```tsx
// BEFORE
<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
  <div style={{ flex: 1, minHeight: 150 }}>…preview…</div>
  <div>…meta…</div>
  <div>…plaque…</div>
</div>

// AFTER — no height: 100%, aspect-ratio on preview
<div style={{ display: 'flex', flexDirection: 'column' }}>
  <div style={{ aspectRatio: '4 / 3' }}>…preview…</div>
  <div>…meta…</div>
  <div>…plaque…</div>
</div>
```

Option B (when the card *must* fill a fixed-height cell, e.g. a hero in `grid-template-rows: 344px`): keep `height: 100%` *only* for that variant, and let `flex: 1 + min-height` carry its usual meaning.

```tsx
const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  ...(isHero ? { height: '100%' } : {}),  // only when parent cell is fixed
};

const previewStyle = isHero
  ? { flex: 1, minHeight: 260 }           // fill remaining of 344px
  : { aspectRatio: '4 / 3' };             // size by width only
```

## How to recognise

- **Visual:** card's background/border stops cleanly — there's a visible edge — and footer text sits on the body/background beneath that edge.
- **DevTools:** computed height of the card < computed height of the sum of its children. Or the card has `overflow: visible` and the last child has `box-sizing: border-box; display: block` sitting below the card's bottom.
- **Grep signal:** card component with `height: 100%` + `flex: 1` + `min-height` on the preview + grid parent with no `grid-template-rows` or `grid-auto-rows: <fixed>`.

## Related pitfalls

- **Hero grid with fixed-height rows (`172px 172px`) AND `flex: 1` preview with `min-height: 260`**: the min-height *wins* over the flex-basis, so the card content wants 260 + meta + plaque ≈ 330 px, which exceeds the 344-px hero cell by just enough to trip the overflow. Keep hero's `flex: 1` *without* `min-height` when the cell height already guarantees enough room.
- **Fixed-height grid rows + non-hero cards with `height: 100%`**: same class of bug; the cards get clamped to whatever the row height is, content overflows. If your spill row is a "plain" section, remove the fixed row height.
- **Aspect-ratio + min-height interaction**: `aspect-ratio` is ignored when the element has a conflicting `min-height`. Don't stack both on the same preview unless you want one to override.

## Concrete example from this repo

`apps/desktop/src/renderer/src/views/home/HomeCard.tsx` — fix landed as:

```tsx
// Hero cards sit in a fixed 344-px grid cell and use `height: 100%` + the
// preview's `flex: 1` to fill it. Non-hero cards live in an auto-sized
// plain-grid row; `height: 100%` there would clamp the card to whatever
// pixel height the grid row resolved to, pushing meta + plaque *outside*
// the paper frame. So: no `height: 100%` for non-hero — let the card size
// to its content, and give the preview an explicit aspect ratio instead.
const cardStyle = {
  display: 'flex', flexDirection: 'column', width: '100%',
  ...(isHero ? { height: '100%' } : {}),
};

<div
  style={{
    ...(isHero ? { flex: 1, minHeight: 260 } : { aspectRatio: '4 / 3' }),
  }}
>
  <DesignCardPreview design={design} />
</div>
```

## Diagnostic recipe

1. Inspect the card in DevTools. Note its computed height vs its children's summed height.
2. If the card has `height: 100%`, check the grid parent. `grid-template-rows` / `grid-auto-rows`?
3. If no explicit row sizing and the grid content overflows downward: this bug.
4. If rows ARE explicit but content overflows: calculate `sum(child.min-height) + padding + gap` and compare to the row height. Either raise the row or drop `min-height` on the flex child.
5. Apply Option A (aspect-ratio) or Option B (variant-gated `height: 100%`) depending on whether the cell is fixed or auto.
