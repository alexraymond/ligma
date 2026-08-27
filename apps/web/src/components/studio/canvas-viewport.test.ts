/**
 * Fit-to-view maths (roadmap phase 5). Pure and DOM-free — the caller measures
 * the scroll box, this decides the zoom — so the node-environment vitest covers
 * it without rendering the canvas.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_LEVELS, clampZoom, fitZoom } from './canvas-viewport';

describe('fitZoom', () => {
  it('shrinks until the tighter axis fits', () => {
    // Content is twice the viewport's width at 100% → half the zoom fits it.
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 1000, height: 1000 }, 100)).toBe(50);
    // Height is the tighter axis here.
    expect(fitZoom({ width: 1000, height: 4000 }, { width: 1000, height: 1000 }, 100)).toBe(25);
  });

  it('reads the content box as already scaled by the current zoom', () => {
    // Same design, measured at 200%: the box is twice as big, so the fit is
    // the same 50% it would have been from 100%.
    expect(fitZoom({ width: 4000, height: 2000 }, { width: 1000, height: 1000 }, 200)).toBe(50);
  });

  it('zooms up when the content is smaller than the viewport', () => {
    expect(fitZoom({ width: 500, height: 500 }, { width: 1000, height: 1000 }, 100)).toBe(200);
  });

  it('stays inside the canvas limits', () => {
    expect(fitZoom({ width: 100_000, height: 100 }, { width: 100, height: 100 }, 100)).toBe(
      MIN_ZOOM,
    );
    expect(fitZoom({ width: 1, height: 1 }, { width: 10_000, height: 10_000 }, 100)).toBe(MAX_ZOOM);
  });

  it('leaves the zoom alone when nothing has laid out yet', () => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 1000, height: 1000 }, 75)).toBe(75);
  });
});

describe('ZOOM_LEVELS', () => {
  it('are all reachable zooms', () => {
    for (const level of ZOOM_LEVELS) expect(clampZoom(level)).toBe(level);
  });
});
