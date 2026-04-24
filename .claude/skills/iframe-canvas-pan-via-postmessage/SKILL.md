---
name: iframe-canvas-pan-via-postmessage
description: Fix "trackpad/drag doesn't pan the canvas" in a Figma-style editor where the canvas is rendered inside an iframe (for sandboxing) but wrapped by a parent `overflow: auto` scroll container. The iframe captures every wheel and pointer event and those events do NOT propagate to the parent, so the outer scroll container never sees them. The canonical fix is to forward wheel deltas and pointer-drag deltas from inside the iframe via `postMessage`, then translate them to scrollLeft/scrollTop on the parent. Also covers the `wheel` passive:false requirement and grab-hand cursor UX. Trigger words — "trackpad doesn't pan", "drag doesn't pan", "space+drag doesn't work in iframe", "iframe eats events", "scroll container not scrolling", "two-finger scroll stuck", "Figma-style pan broken", "wheel event not reaching parent", "preview canvas won't scroll".
allowed-tools: Read, Bash, Edit, Glob, Grep
---

# Iframe canvas pan via postMessage

## The bug

You're building a Figma-style editor. The design preview lives inside a sandboxed iframe (so user-generated HTML can't touch the host). The iframe sits inside a parent `<div style="overflow: auto">` that should scroll when the design is bigger than the viewport.

- Trackpad two-finger scroll does nothing.
- Space+drag (implemented with `window.addEventListener('keydown')` in the parent) does nothing once the cursor is over the iframe.
- Middle-click drag works if you click on the non-iframe border region, but not over the iframe itself.
- A "Move" or "Hand" tool doesn't cause the canvas to pan.

## Why

Iframes are **separate browsing contexts** for event propagation. DOM events fired inside an iframe's document do not bubble to the parent's document. Specifically:

- `wheel` events inside the iframe go to the iframe's scrollable element. If nothing there scrolls, Chrome stops — it does not pass the event up.
- `pointerdown` / `pointermove` / `pointerup` inside the iframe never reach the parent, even with capture listeners attached on the parent.
- `keydown` events go to the focused document — if the iframe has focus, the parent never sees Space pressed.

So the parent's `overflow: auto` is effectively orphaned: nothing ever generates the scroll deltas it expects.

## The fix

Inject an overlay script into the iframe. When the user is in a "pan" mode (or always, for wheel), it listens for wheel and pointer events and **forwards the deltas to the parent via `postMessage`**. The parent translates them to `scrollLeft` / `scrollTop` on the outer scroll container.

### 1. Inside the iframe (overlay script)

```js
var panDragState = null;
var currentMode = 'default';  // flipped by parent via SET_MODE postMessage

function onWheelPan(e) {
  if (currentMode !== 'pan') return;
  // preventDefault is essential: otherwise Chrome tries to scroll the
  // iframe's document and on some platforms shows a rubber-band bounce.
  // Needs passive:false on the listener for preventDefault to work.
  e.preventDefault();
  e.stopPropagation();
  window.parent.postMessage({
    __myapp: true,
    type: 'CANVAS_PAN_WHEEL',
    deltaX: e.deltaX,
    deltaY: e.deltaY,
  }, '*');
}

function onPanDown(e) {
  if (currentMode !== 'pan') return;
  panDragState = { id: e.pointerId, x: e.clientX, y: e.clientY };
  document.body.style.cursor = 'grabbing';
  e.preventDefault();
}
function onPanMove(e) {
  if (!panDragState || e.pointerId !== panDragState.id) return;
  var dx = e.clientX - panDragState.x;
  var dy = e.clientY - panDragState.y;
  panDragState.x = e.clientX;
  panDragState.y = e.clientY;
  window.parent.postMessage({
    __myapp: true,
    type: 'CANVAS_PAN_DRAG',
    dx: dx,
    dy: dy,
  }, '*');
}
function onPanUp(e) {
  if (!panDragState || e.pointerId !== panDragState.id) return;
  panDragState = null;
  document.body.style.cursor = currentMode === 'pan' ? 'grab' : '';
}

// CRITICAL: wheel listener must be non-passive. Use the object form:
document.addEventListener('wheel', onWheelPan, { capture: true, passive: false });
document.addEventListener('pointerdown', onPanDown, true);
document.addEventListener('pointermove', onPanMove, true);
document.addEventListener('pointerup', onPanUp, true);
document.addEventListener('pointercancel', onPanUp, true);
```

### 2. In the parent's message listener

```tsx
window.addEventListener('message', (ev) => {
  if (ev.source !== iframeRef.current?.contentWindow) return;
  const d = ev.data;
  if (!d || d.__myapp !== true) return;

  const scroller = document.querySelector('[data-canvas-viewport]') as HTMLElement;
  if (!scroller) return;

  if (d.type === 'CANVAS_PAN_WHEEL') {
    scroller.scrollLeft += d.deltaX;
    scroller.scrollTop  += d.deltaY;
  } else if (d.type === 'CANVAS_PAN_DRAG') {
    // Sign INVERTED: dragging content right means scrolling the viewport
    // LEFT (grab-hand feel). Matches Figma / Miro.
    scroller.scrollLeft -= d.dx;
    scroller.scrollTop  -= d.dy;
  }
});
```

## Why the cursor has to be set INSIDE the iframe

A common instinct is to set `cursor: grab` on the outer scroll container. That works for the brief moment before the pointer enters the iframe — then the iframe's own cursor takes over. The user sees a pointer arrow on the canvas they're supposed to pan, which breaks affordance. Set `document.body.style.cursor = 'grab'` inside the iframe's overlay.

## When the iframe's document already overflows

If the inside of the iframe has `html { overflow: auto }` and the design is taller than the iframe, wheel events legitimately scroll the iframe's content. You have a choice:

1. **Pan mode always wins**: `currentMode === 'pan'` forces the overlay to preventDefault + forward, even if inner scroll would've worked. Simplest UX.
2. **Opportunistic forward**: only forward when the inner document is at its scroll boundary (top-of-page with upward wheel, or fully fits). Complex to get right.

Ligma uses option 1 — explicit mode toggled via a Hand button in the toolbar.

## Gotchas

- **Don't rely on `Space+drag` detected in the parent.** The parent's `keydown` listener won't fire when the iframe has focus. If you want Space-to-pan, detect it inside the overlay too and emit the same postMessage.
- **`pointer-events: none` on the iframe during drag** seems like an alternative but breaks clicks inside the iframe the moment you release a modifier. Not recommended.
- **Defensive re-attachment.** User HTML may call `document.addEventListener = undefined` or overwrite prototypes. Re-install listeners on a `setInterval(..., 200)` loop. `addEventListener` with the same fn+capture is idempotent.
- **Sign of `dx`/`dy` for drag vs wheel.** Wheel `deltaY` is "scroll direction", already matching viewport scroll. Drag `dx`/`dy` is "content moved by user", opposite sign.
- **postMessage source guard.** Always check `ev.source === iframeRef.current?.contentWindow` before trusting the payload — nothing else can spoof it.

## Related problems this skill does NOT solve

- **Zoom (Cmd+wheel).** The zoom modifier needs parent-side state (zoom percent) and re-emitting to the overlay. Same iframe-eats-events problem though, same postMessage pattern.
- **Overlay inside an iframe across origins.** If the iframe loads a cross-origin URL (not `srcdoc`), you can't inject an overlay — the browser blocks cross-origin DOM access. You'd need the other site to cooperate. For srcdoc / same-origin sandboxed iframes (the Figma / Ligma pattern), injection is trivial.
