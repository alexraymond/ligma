/**
 * Ported from ligma-classic's `CanvasWall.gesture.test.ts` — the same cases,
 * against the same pure functions, so the port is provably behaviour-identical.
 * The `reorderPaths` block is new: ligma-classic did the splice inside a
 * Zustand action, and this port made it a pure function.
 */
import { describe, expect, it } from 'vitest';
import {
  extractScreenTitle,
  processGestureMove,
  processGestureUp,
  reorderPaths,
  startGesture,
} from './gesture';

function arm(opts: { additive?: boolean; scrollLeft?: number; scrollTop?: number } = {}) {
  return startGesture({
    clientX: 100,
    clientY: 100,
    scrollLeft: opts.scrollLeft ?? 50,
    scrollTop: opts.scrollTop ?? 80,
    additive: opts.additive ?? false,
  });
}

describe('startGesture', () => {
  it('captures initial pointer position + viewport scroll snapshot', () => {
    const state = arm({ scrollLeft: 12, scrollTop: 34 });
    expect(state.startX).toBe(100);
    expect(state.startY).toBe(100);
    expect(state.scrollLeft0).toBe(12);
    expect(state.scrollTop0).toBe(34);
    expect(state.isDrag).toBe(false);
    expect(state.additive).toBe(false);
  });

  it('threads the additive (Cmd/Ctrl/Shift) flag into the state', () => {
    expect(arm({ additive: true }).additive).toBe(true);
  });
});

describe('processGestureMove — armed (no drag yet)', () => {
  it('stays armed and emits no scroll for movement <= threshold', () => {
    const r = processGestureMove(arm(), 103, 103); // ~4.24 < 5
    expect(r.state.isDrag).toBe(false);
    expect(r.scroll).toBeNull();
    expect(r.justBecameDrag).toBe(false);
  });

  it('flips to drag and emits a scroll on the first move past threshold', () => {
    const r = processGestureMove(arm(), 106, 100); // 6 > 5
    expect(r.state.isDrag).toBe(true);
    expect(r.scroll).toEqual({ scrollLeft: 50 - 6, scrollTop: 80 - 0 });
    expect(r.justBecameDrag).toBe(true);
  });
});

describe('processGestureMove — already dragging', () => {
  it('keeps applying scroll deltas relative to original anchor', () => {
    let state = arm();
    state = processGestureMove(state, 110, 100).state;
    expect(state.isDrag).toBe(true);
    const r = processGestureMove(state, 130, 90);
    expect(r.scroll).toEqual({ scrollLeft: 50 - 30, scrollTop: 80 - -10 });
    expect(r.justBecameDrag).toBe(false);
  });

  it('handles negative deltas (drag left/up = scroll right/down)', () => {
    let state = arm();
    state = processGestureMove(state, 110, 100).state;
    const r = processGestureMove(state, 70, 50);
    expect(r.scroll).toEqual({ scrollLeft: 50 - -30, scrollTop: 80 - -50 });
  });
});

describe('processGestureUp', () => {
  it('returns click effect when never crossed threshold', () => {
    expect(processGestureUp(arm())).toEqual({ kind: 'click', additive: false });
  });

  it('preserves the additive flag through to the click effect', () => {
    expect(processGestureUp(arm({ additive: true }))).toEqual({ kind: 'click', additive: true });
  });

  it('returns pan effect when the gesture crossed threshold (suppress click)', () => {
    let state = arm();
    state = processGestureMove(state, 110, 100).state;
    expect(processGestureUp(state)).toEqual({ kind: 'pan' });
  });
});

describe('end-to-end gesture sequences', () => {
  it('tap (no movement) → click', () => {
    const state = processGestureMove(arm(), 101, 101).state;
    expect(processGestureUp(state)).toEqual({ kind: 'click', additive: false });
  });

  it('drag right by 100px → pan with viewport.scrollLeft -= 100', () => {
    let state = arm({ scrollLeft: 200 });
    let scroll: { scrollLeft: number; scrollTop: number } | null = null;
    for (const x of [105, 130, 200]) {
      const r = processGestureMove(state, x, 100);
      state = r.state;
      if (r.scroll) scroll = r.scroll;
    }
    expect(state.isDrag).toBe(true);
    expect(scroll).toEqual({ scrollLeft: 200 - 100, scrollTop: 80 });
    expect(processGestureUp(state)).toEqual({ kind: 'pan' });
  });
});

describe('extractScreenTitle', () => {
  it('prefers a data-screen-title attribute', () => {
    expect(extractScreenTitle('<div data-screen-title="Checkout">x</div>')).toBe('Checkout');
  });

  it('falls back to the meta tag', () => {
    expect(extractScreenTitle('<meta name="ligma:screen-title" content="Settings">')).toBe(
      'Settings',
    );
  });

  it('returns null when neither convention is present', () => {
    expect(extractScreenTitle('<div>plain</div>')).toBeNull();
  });
});

describe('reorderPaths', () => {
  it("moves the dragged path into the drop target's slot", () => {
    expect(reorderPaths(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderPaths(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for unknown paths or a self-drop', () => {
    const paths = ['a', 'b'];
    expect(reorderPaths(paths, 'a', 'a')).toBe(paths);
    expect(reorderPaths(paths, 'zzz', 'a')).toBe(paths);
  });
});
