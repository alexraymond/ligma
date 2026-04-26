import { describe, expect, it } from 'vitest';
import { processGestureMove, processGestureUp, startGesture } from './CanvasWall';

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
    const state = arm();
    // Threshold is 5px (Math.hypot). 3,3 → ~4.24 < 5.
    const r = processGestureMove(state, 103, 103);
    expect(r.state.isDrag).toBe(false);
    expect(r.scroll).toBeNull();
    expect(r.justBecameDrag).toBe(false);
  });

  it('flips to drag and emits a scroll on the first move past threshold', () => {
    const state = arm();
    // 6,0 → 6 > 5 → cross.
    const r = processGestureMove(state, 106, 100);
    expect(r.state.isDrag).toBe(true);
    expect(r.scroll).toEqual({ scrollLeft: 50 - 6, scrollTop: 80 - 0 });
    expect(r.justBecameDrag).toBe(true);
  });
});

describe('processGestureMove — already dragging', () => {
  it('keeps applying scroll deltas relative to original anchor', () => {
    let state = arm();
    // First cross threshold:
    state = processGestureMove(state, 110, 100).state;
    expect(state.isDrag).toBe(true);
    // Subsequent move:
    const r = processGestureMove(state, 130, 90);
    expect(r.scroll).toEqual({ scrollLeft: 50 - 30, scrollTop: 80 - -10 });
    expect(r.justBecameDrag).toBe(false); // already was drag
  });

  it('handles negative deltas (drag left/up = scroll right/down)', () => {
    let state = arm();
    state = processGestureMove(state, 110, 100).state; // cross
    const r = processGestureMove(state, 70, 50); // dx=-30, dy=-50
    expect(r.scroll).toEqual({ scrollLeft: 50 - -30, scrollTop: 80 - -50 });
  });
});

describe('processGestureUp', () => {
  it('returns click effect when never crossed threshold', () => {
    const state = arm();
    expect(processGestureUp(state)).toEqual({ kind: 'click', additive: false });
  });

  it('preserves the additive flag through to the click effect', () => {
    const state = arm({ additive: true });
    expect(processGestureUp(state)).toEqual({ kind: 'click', additive: true });
  });

  it('returns pan effect when the gesture crossed threshold (suppress click)', () => {
    let state = arm();
    state = processGestureMove(state, 110, 100).state;
    expect(processGestureUp(state)).toEqual({ kind: 'pan' });
  });
});

describe('end-to-end gesture sequences', () => {
  it('tap (no movement) → click', () => {
    let state = arm();
    state = processGestureMove(state, 101, 101).state; // 1,1 → no drag
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
