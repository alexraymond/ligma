/**
 * The click-vs-drag gesture state machine for Wall cards.
 *
 * Ported verbatim from ligma-classic's
 * `src/renderer/src/components/canvas/CanvasWall.tsx` (studio map
 * §2 "Drag-reorder — extracted click-vs-drag state machine"). It was already
 * extracted as pure, DOM-free functions there precisely so the gesture logic
 * could be tested without jsdom — this app has no jsdom either, so the
 * extraction survives the port unchanged. The component is the thin shell that
 * maps real PointerEvents onto these calls.
 *
 * State transitions:
 *   null           --pointerDown(button=0)--> { armed, scrollLeft0, scrollTop0 }
 *   armed          --pointerMove(<= 5px)----> armed (no scroll change)
 *   armed          --pointerMove(> 5px)-----> dragging (apply scroll)
 *   dragging       --pointerMove(any)-------> dragging (apply scroll)
 *   armed/dragging --pointerUp--------------> null + side-effect
 */

/** Figma's threshold — anything below this stays a click. */
export const DRAG_THRESHOLD_PX = 5;

export interface GestureState {
  startX: number;
  startY: number;
  scrollLeft0: number;
  scrollTop0: number;
  additive: boolean;
  isDrag: boolean;
}

export interface PointerDownInput {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
  additive: boolean;
}

export interface PointerMoveResult {
  state: GestureState;
  /** New scroll{Left,Top} for the viewport once past threshold; null while armed. */
  scroll: { scrollLeft: number; scrollTop: number } | null;
  /** True on the very first move that crosses the threshold (flip the cursor). */
  justBecameDrag: boolean;
}

export type PointerUpEffect = { kind: 'click'; additive: boolean } | { kind: 'pan' };

export function startGesture(input: PointerDownInput): GestureState {
  return {
    startX: input.clientX,
    startY: input.clientY,
    scrollLeft0: input.scrollLeft,
    scrollTop0: input.scrollTop,
    additive: input.additive,
    isDrag: false,
  };
}

export function processGestureMove(
  state: GestureState,
  clientX: number,
  clientY: number,
): PointerMoveResult {
  const dx = clientX - state.startX;
  const dy = clientY - state.startY;
  const wasDrag = state.isDrag;
  const isDrag = wasDrag || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
  const next: GestureState = wasDrag === isDrag ? state : { ...state, isDrag };
  if (!isDrag) return { state: next, scroll: null, justBecameDrag: false };
  return {
    state: next,
    scroll: { scrollLeft: state.scrollLeft0 - dx, scrollTop: state.scrollTop0 - dy },
    justBecameDrag: !wasDrag,
  };
}

export function processGestureUp(state: GestureState): PointerUpEffect {
  if (state.isDrag) return { kind: 'pan' };
  return { kind: 'click', additive: state.additive };
}

/**
 * Pull the model-supplied screen title out of a generated artifact. Two
 * conventions, in priority order: `data-screen-title="…"` on any element, then
 * `<meta name="ligma:screen-title" content="…">`. Null when neither is present
 * so callers fall back to the filename. Ported as-is.
 */
export function extractScreenTitle(source: string): string | null {
  const dataAttr = source.match(/data-screen-title=["']([^"']{1,80})["']/i);
  if (dataAttr?.[1]) return dataAttr[1].trim();
  const meta = source.match(
    /<meta[^>]*name=["']ligma:screen-title["'][^>]*content=["']([^"']{1,80})["']/i,
  );
  if (meta?.[1]) return meta[1].trim();
  return null;
}

/**
 * Move `from` to `to`'s slot in an ordered path list.
 *
 * ligma-classic kept card order in a Zustand store action
 * (`reorderWallCards`); here order is client-side only (the manifest lists
 * files, it does not rank them), so the reorder is this pure splice plus a
 * `useState`. Same drop-target semantics: the dragged card lands where the
 * target card was.
 */
export function reorderPaths(paths: string[], from: string, to: string): string[] {
  const fromIndex = paths.indexOf(from);
  const toIndex = paths.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return paths;
  const next = paths.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}
