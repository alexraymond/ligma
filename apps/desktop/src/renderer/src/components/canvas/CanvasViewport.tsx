import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useCodesignStore } from '../../store';

export interface CanvasViewportProps {
  children: ReactNode;
}

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
}

/**
 * Scrollable + pannable container for the preview canvas. Wraps the iframe
 * pool so large multi-artboard designs (from the DESIGN_CANVAS prompt) stay
 * navigable when their combined width exceeds the viewport.
 *
 * - Cmd/Ctrl+wheel: continuous zoom (±5% per detent).
 * - Space+drag or middle-click drag: pan via scrollLeft/scrollTop.
 * - Plain wheel: default browser scroll, untouched.
 *
 * The zoom value is stored globally in `previewZoom` so the existing
 * discrete dropdown in PreviewToolbar stays in sync. Comment pins and
 * live-rect overlays already respect `previewZoom` via scaleRectForZoom,
 * so no extra wiring is needed here.
 */
export function CanvasViewport({ children }: CanvasViewportProps) {
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const setPreviewZoom = useCodesignStore((s) => s.setPreviewZoom);
  const ref = useRef<HTMLDivElement | null>(null);
  const spaceHeld = useRef(false);
  const panning = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // Track the Space key globally so pan-on-space works anywhere inside the
  // viewport. We attach to `window` because the preview iframes steal focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === 'Space' && !spaceHeld.current) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        // Don't hijack space in form fields.
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        spaceHeld.current = true;
        document.body.classList.add('ligma-pan-ready');
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        document.body.classList.remove('ligma-pan-ready');
        document.body.classList.remove('ligma-panning');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.body.classList.remove('ligma-pan-ready');
      document.body.classList.remove('ligma-panning');
    };
  }, []);

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // Positive deltaY on most mice = scroll down = zoom out.
      const step = e.deltaY > 0 ? -5 : 5;
      setPreviewZoom(clampZoom(previewZoom + step));
    },
    [previewZoom, setPreviewZoom],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const wantPan = spaceHeld.current || e.button === 1; // middle-click
    if (!wantPan) return;
    const el = ref.current;
    if (!el) return;
    panning.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('ligma-panning');
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
    document.body.classList.remove('ligma-panning');
  }, []);

  return (
    <div
      ref={ref}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="h-full w-full overflow-auto"
      style={{ touchAction: 'pan-x pan-y' }}
    >
      {children}
    </div>
  );
}
