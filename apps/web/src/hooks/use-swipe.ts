'use client';

import { useRef, useState } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface UseSwipeOptions {
  /** Pixels of travel before a drag counts as a swipe. */
  threshold?: number;
  /** Fired once, on pointer release, when the drag cleared the threshold. */
  onSwipe: (direction: SwipeDirection) => void;
  /** While true, drags are ignored (e.g. a request is in flight). */
  disabled?: boolean;
}

/**
 * How far a pointer must travel before the gesture claims it.
 *
 * A press that never moves is a click, and it must reach the button under it.
 */
export const DRAG_SLOP = 6;

/**
 * Whether the gesture may capture the pointer yet.
 *
 * Capturing on pointerdown is the trap: while a capture is set, the Pointer
 * Events spec retargets the compatibility mouse events — `mousedown`, `mouseup`
 * **and `click`** — to the capturing element. A card that captured on press
 * therefore swallowed every click aimed at the option buttons inside it: they
 * looked enabled, the click dispatched, and no handler ever ran (only Tab+Enter
 * and the swipe itself worked). Capture on the first real movement instead, so
 * a stationary click is never a gesture and never gets stolen.
 */
export function shouldCapture(dx: number, dy: number, slop: number = DRAG_SLOP): boolean {
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

export function directionOf(dx: number, dy: number, threshold: number): SwipeDirection | null {
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > threshold) return 'right';
    if (dx < -threshold) return 'left';
    return null;
  }
  if (dy < -threshold) return 'up';
  if (dy > threshold) return 'down';
  return null;
}

/**
 * Generic drag-to-swipe gesture. Pointer events only, so mouse, touch and pen
 * all work from one code path — apply `touch-action: none` to the element.
 *
 * Deliberately has no keyboard handling: a hook cannot know which element owns
 * the keys, and a window-level listener fires for every focused input on the
 * page. Keys belong to the component that renders the card.
 */
export function useSwipe({ threshold = 80, onSwipe, disabled = false }: UseSwipeOptions) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const capturedRef = useRef(false);

  const reset = () => {
    startRef.current = null;
    capturedRef.current = false;
    setOffset({ x: 0, y: 0 });
  };

  return {
    offsetX: offset.x,
    offsetY: offset.y,
    direction: directionOf(offset.x, offset.y, threshold),
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (disabled) return;
        startRef.current = { x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        // Capture only once this is a drag, so a drag that leaves the card still
        // reports move/up while a plain click stays the button's to handle.
        if (!capturedRef.current && shouldCapture(dx, dy)) {
          capturedRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        setOffset({ x: dx, y: dy });
      },
      onPointerUp: () => {
        const dir = directionOf(offset.x, offset.y, threshold);
        reset();
        if (dir && !disabled) onSwipe(dir);
      },
      onPointerCancel: reset,
    },
  };
}
