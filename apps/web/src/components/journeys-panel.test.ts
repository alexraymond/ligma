import { describe, expect, it } from 'vitest';
import { showsExecutionPill } from './journeys-panel';

// Walkthrough M3: a journey shown simultaneously green "done" and red
// "failed" — the execution pill's "done" and the verification pill's
// "failed" described the same finished run in two vocabularies at once, one
// of them reading as success. A verdict already implies the run finished, so
// once one exists it is the only pill that should render.
describe('showsExecutionPill', () => {
  it('shows the execution pill while no verification outcome exists yet', () => {
    expect(showsExecutionPill(undefined)).toBe(true);
  });

  it('hides the execution pill once a verification outcome exists, whatever it is', () => {
    expect(showsExecutionPill('failed')).toBe(false);
    expect(showsExecutionPill('passed')).toBe(false);
    expect(showsExecutionPill('error')).toBe(false);
  });
});
