import type { ActiveRun } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { runsSectionState } from './runs-section';

const RUN = { id: 'r1' } as ActiveRun;

describe('runsSectionState', () => {
  it('is an error when the read failed, regardless of the last known runs', () => {
    expect(runsSectionState([], 'Failed to load runs (500)')).toBe('error');
    expect(runsSectionState([RUN], 'Failed to load runs (500)')).toBe('error');
  });

  it('is empty when the read succeeded with no runs — never silently blank (walkthrough M5)', () => {
    expect(runsSectionState([], null)).toBe('empty');
  });

  it('is list once there is at least one run', () => {
    expect(runsSectionState([RUN], null)).toBe('list');
  });
});
