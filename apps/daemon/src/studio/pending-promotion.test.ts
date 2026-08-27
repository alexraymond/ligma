/**
 * The promote nonce ledger (process audit P5).
 *
 * Real filesystem, on the throwaway DATA_DIR vitest.setup.ts pins — the whole
 * mechanism is a file write under a cross-process lock, so mocking it out would
 * test nothing.
 */

import type { PromotePreview } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import {
  claimPromoteNonce,
  clearPendingPromotion,
  readPendingPromotions,
  recordPendingPromotion,
} from './pending-promotion';

const project = `proj_nonce_${process.pid}`;

describe('claimPromoteNonce', () => {
  it('burns a nonce once: the first commit wins, the replay is refused', () => {
    expect(claimPromoteNonce(project, 'promo_1')).toBe(true);
    expect(claimPromoteNonce(project, 'promo_1')).toBe(false);
    expect(claimPromoteNonce(project, 'promo_1')).toBe(false);
  });

  it('keeps distinct previews independent', () => {
    expect(claimPromoteNonce(project, 'promo_2')).toBe(true);
    expect(claimPromoteNonce(project, 'promo_3')).toBe(true);
    expect(claimPromoteNonce(project, 'promo_2')).toBe(false);
  });

  it('is scoped per project', () => {
    expect(claimPromoteNonce(`${project}_other`, 'promo_1')).toBe(true);
  });

  it('shares its file with the pending records without clobbering them', () => {
    const preview = {
      projectId: project,
      source: 'brief',
      designId: null,
      tasks: [
        {
          tempId: 't1',
          title: 'x',
          description: '',
          acceptanceCriteria: [],
          dependsOn: [],
          designFilePaths: [],
        },
      ],
      criteria: [],
      holdoutNote: '',
      journeys: [],
      governor: {
        estimatedSpawns: 1,
        windowHours: 5,
        used: 0,
        max: 9,
        reserveFloor: 1,
        remainingForAutonomy: 8,
        willDefer: false,
        killSwitch: false,
      },
      designBaseline: null,
      error: null,
    } as unknown as PromotePreview;

    recordPendingPromotion(preview);
    expect(readPendingPromotions(project)).toHaveLength(1);

    // A commit burns the nonce and clears the card; neither may drop the other.
    expect(claimPromoteNonce(project, 'promo_4')).toBe(true);
    expect(readPendingPromotions(project)).toHaveLength(1);

    clearPendingPromotion(project, 'brief');
    expect(readPendingPromotions(project)).toHaveLength(0);
    expect(claimPromoteNonce(project, 'promo_4')).toBe(false);
  });
});
