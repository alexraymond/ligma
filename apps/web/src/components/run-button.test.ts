// F1 (UX-REDESIGN §16): "session estimate shown on every launch affordance".
// `launchEstimate` is the pure copy helper RunButton's tooltip/title/aria-label
// all read from — pinned here without a jsdom render (this vitest config is
// node-only).
import { describe, expect, it } from 'vitest';
import { launchEstimate } from './run-button';

describe('launchEstimate', () => {
  it('names exactly one builder session with no contract', () => {
    expect(launchEstimate(false)).toBe('Spawns 1 builder session');
  });

  it('adds the verification run when the task carries a contract', () => {
    expect(launchEstimate(true)).toBe(
      'Spawns 1 builder session, then a verification run once it finishes',
    );
  });
});
