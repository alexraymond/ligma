'use client';

/**
 * Pannable / zoomable container for the Wall and the focus canvas.
 *
 * Ported from ligma-classic's `CanvasViewport.tsx` (studio map §2
 * "Pannable/zoomable grid"), same limits and same gestures:
 *  - Cmd/Ctrl+wheel → ±5% zoom, clamped to 25–400.
 *  - Space+drag or middle-click drag → pan via scrollLeft/scrollTop.
 *  - Plain wheel → native scroll, untouched.
 *
 * `data-canvas-viewport` is load-bearing: the Wall's gesture shell and the
 * runtime overlay's forwarded `CANVAS_PAN_*` messages both find this element
 * with `closest()`. Zoom moved from the Zustand store to a prop, because the
 * web Studio has no global store to hold it.
 */

import {
  type MutableRefObject,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

export const MIN_ZOOM = 25;
export const MAX_ZOOM = 400;

/** The levels the zoom menu offers — the ones a design tool has always had. */
export const ZOOM_LEVELS = [50, 75, 100, 150, 200] as const;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
}

/**
 * The zoom at which the content fits inside the viewport box.
 *
 * Measured, not modelled: `content` is the scroll box the canvas *currently*
 * reports, which is already scaled by `currentZoom`, so the fit is that zoom
 * times the tightest of the two ratios. Both axes must fit, hence `min`. A
 * content box that hasn't laid out yet (0 in either axis) leaves the zoom
 * alone rather than dividing by zero and snapping to the 25% floor.
 */
export function fitZoom(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  currentZoom: number,
): number {
  if (content.width <= 0 || content.height <= 0) return clampZoom(currentZoom);
  return clampZoom(
    currentZoom * Math.min(viewport.width / content.width, viewport.height / content.height),
  );
}

export interface CanvasViewportProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  children: ReactNode;
  className?: string;
  /** Lets the owner measure the scroll box — what "fit to view" reads. */
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
}

export function CanvasViewport({
  zoom,
  onZoomChange,
  children,
  className,
  scrollRef,
}: CanvasViewportProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = scrollRef ?? ownRef;
  const spaceHeld = useRef(false);
  const panning = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Space is tracked on `window` because the preview iframes steal focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || spaceHeld.current) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      spaceHeld.current = true;
      e.preventDefault();
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') spaceHeld.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // `wheel` must be non-passive to preventDefault the browser's pinch-zoom, and
  // React's onWheel is passive — so this one listener is attached by hand.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      onZoomChange(clampZoom(zoom + (e.deltaY > 0 ? -5 : 5)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoomChange]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const wantPan = spaceHeld.current || e.button === 1;
    const el = ref.current;
    if (!wantPan || !el) return;
    panning.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add('ligma-panning');
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = panning.current;
    const el = ref.current;
    if (!state || !el) return;
    el.scrollLeft = state.scrollLeft - (e.clientX - state.startX);
    el.scrollTop = state.scrollTop - (e.clientY - state.startY);
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panning.current) return;
    panning.current = null;
    const el = ref.current;
    el?.releasePointerCapture(e.pointerId);
    el?.classList.remove('ligma-panning');
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-canvas-viewport
      className={`ligma-studio-canvas h-full w-full overflow-auto ${className ?? ''}`}
      style={{ touchAction: 'pan-x pan-y' }}
    >
      {children}
    </div>
  );
}
