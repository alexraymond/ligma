import { describe, expect, it } from 'vitest';
import { type StudioEscapeState, studioEscapeStep } from './escape-chain';

const state = (over: Partial<StudioEscapeState> = {}): StudioEscapeState => ({
  pinDraft: false,
  commentMode: false,
  mode: 'wall',
  ...over,
});

describe('studio ESC chain', () => {
  it('closes the pin draft first, whatever else is open', () => {
    expect(studioEscapeStep(state({ pinDraft: true, commentMode: true, mode: 'focus' }))).toBe(
      'close-pin-draft',
    );
  });

  it('disarms click-to-pin before leaving Focus', () => {
    expect(studioEscapeStep(state({ commentMode: true, mode: 'focus' }))).toBe('disarm-pin');
  });

  it('leaves Focus for the Wall', () => {
    expect(studioEscapeStep(state({ mode: 'focus' }))).toBe('leave-focus');
  });

  it('exits to Build only from the bare Wall', () => {
    expect(studioEscapeStep(state())).toBe('exit-studio');
  });

  it('walks outward one layer per press', () => {
    // The full chain, replayed: each step is the state the previous one left.
    let current = state({ pinDraft: true, commentMode: true, mode: 'focus' });
    const steps = [];
    for (let i = 0; i < 4; i++) {
      const step = studioEscapeStep(current);
      steps.push(step);
      current =
        step === 'close-pin-draft'
          ? { ...current, pinDraft: false }
          : step === 'disarm-pin'
            ? { ...current, commentMode: false }
            : step === 'leave-focus'
              ? { ...current, mode: 'wall' }
              : current;
    }
    expect(steps).toEqual(['close-pin-draft', 'disarm-pin', 'leave-focus', 'exit-studio']);
  });
});
