'use client';

/**
 * The three-state pin visual, drawn over the focus preview.
 *
 * Ported from ligma-classic's `comment/PinOverlay.tsx` (studio map §1: the
 * runtime emits raw selection/rect events, the *host* owns the pin colour and
 * state logic). The three states survive the port with their data re-anchored:
 *
 *   note     — a draft pin the user is still writing (no `DesignPin` yet)
 *   pending  — staged; the next apply-turn compiles it (`status: "pending"`)
 *   applied  — history; links to the version that applied it (`status: "applied"`)
 *
 * Rects come from the overlay's live `ELEMENT_RECTS` stream, so a pin stays
 * glued to its element as the iframe scrolls or reflows — the host never
 * re-measures, it trusts the stream (studio map §1, "Live rect tracking").
 */

import type { DesignPin } from '@ligma/api';

export interface PinRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type PinVisualState = 'note' | 'pending' | 'applied';

export function pinVisualState(pin: DesignPin | { status?: DesignPin['status'] }): PinVisualState {
  if (pin.status === 'applied') return 'applied';
  if (pin.status === 'pending') return 'pending';
  return 'note';
}

const VARIANTS: Record<
  PinVisualState,
  { background: string; borderColor: string; color: string; opacity: number }
> = {
  note: {
    background: 'oklch(0.88 0.14 95)',
    borderColor: 'oklch(0.62 0.14 85)',
    color: 'oklch(0.25 0.02 60)',
    opacity: 1,
  },
  pending: {
    background: 'var(--paper-accent)',
    borderColor: 'var(--paper-accent)',
    color: 'var(--paper-on-accent)',
    opacity: 1,
  },
  applied: {
    background: 'transparent',
    borderColor: 'var(--paper-accent)',
    color: 'var(--paper-accent)',
    opacity: 0.65,
  },
};

/**
 * Half-overlap the element's top-right corner so the pin reads as a badge
 * attached to it, not a marker floating near it. Pin is 20px → offset 10.
 * Ported verbatim.
 */
export function pinStyleFromRect(rect: PinRect, zoom: number): { top: string; left: string } {
  const scale = zoom / 100;
  return {
    top: `${rect.top * scale - 10}px`,
    left: `${rect.left * scale + rect.width * scale - 10}px`,
  };
}

export interface PinOverlayProps {
  /** Pins on the file currently in focus. */
  pins: DesignPin[];
  /** Live iframe-relative rects by selector, unscaled. Overrides nothing when absent. */
  liveRects: Record<string, PinRect>;
  zoom: number;
  onPinClick: (pin: DesignPin) => void;
}

export function PinOverlay({ pins, liveRects, zoom, onPinClick }: PinOverlayProps) {
  if (pins.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {pins.map((pin, index) => {
        const rect = liveRects[pin.selector];
        if (!rect) return null;
        const state = pinVisualState(pin);
        const variant = VARIANTS[state];
        return (
          <button
            key={pin.id}
            type="button"
            title={pin.text}
            aria-label={`${state} pin ${index + 1}: ${pin.text}`}
            onClick={() => onPinClick(pin)}
            style={{ ...pinStyleFromRect(rect, zoom), ...variant }}
            className="pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] text-[10px] font-semibold leading-none tabular-nums shadow transition-transform hover:scale-110"
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}
