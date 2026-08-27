import { classifyRun } from '@/components/failure';
import { reserveFloorOf } from '@/components/governor-card';
import { criteriaSlice, latestContract } from '@/lib/criteria';
import { healthPill, taskVerificationPill } from '@/lib/health';
import { SMOKE_SCHEDULES, scheduleLabel } from '@/lib/journeys';
import { STALE_THRESHOLD_MS } from '@/lib/staleness';
import type { AcceptanceContract, ProjectHealth, Task } from '@ligma/api';
/**
 * The pure decisions behind the seventeen cells D6 found missing: how health is
 * said in the one pill vocabulary, how attention is counted per project, which
 * criteria a drawer may show as "visible", and the one Deck card whose answer is
 * a destination.
 *
 * Every one of these is a rule the spec states in prose. Left inside a component
 * they would be untestable and would drift; pulled out here they fail loudly.
 */
import { describe, expect, it } from 'vitest';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const RECENT = new Date(NOW - 60_000).toISOString();
const ANCIENT = new Date(NOW - STALE_THRESHOLD_MS - 60_000).toISOString();

const health = (over: Partial<ProjectHealth> = {}): ProjectHealth => ({
  projectId: 'proj_a',
  verifiable: 4,
  verified: 3,
  percent: 75,
  lastVerifiedAt: RECENT,
  ...over,
});

describe('portfolio health, in the one pill vocabulary', () => {
  it('says nothing at all when the daemon served no health — an absent field is not a zero', () => {
    expect(healthPill(undefined, NOW)).toBeNull();
  });

  it('names the percentage rather than a state word', () => {
    expect(healthPill(health(), NOW)?.label).toBe('75% verified');
  });

  it('goes amber and stale once the newest verdict predates recent work', () => {
    const pill = healthPill(health({ lastVerifiedAt: ANCIENT }), NOW);
    expect(pill?.status).toBe('stale');
    // The tip carries the real timestamp, not just the word.
    expect(pill?.tip).toContain('2026');
  });

  it('is never green — a percentage has no single verdict to link (§8.8)', () => {
    for (const percent of [0, 50, 100]) {
      const pill = healthPill(health({ percent, verified: percent === 0 ? 0 : 4 }), NOW);
      expect(pill?.status).not.toBe('passed');
    }
  });

  it('says a project with no criteria has nothing to verify, rather than 0%', () => {
    const pill = healthPill(
      health({ verifiable: 0, verified: 0, percent: 0, lastVerifiedAt: null }),
      NOW,
    );
    expect(pill?.label).toBe('nothing to verify yet');
  });

  // healthById retired with the Home dashboard (phase 3) — cards now receive
  // their own health row; nothing indexes the list.
});

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 'task_1',
    kanban: 'done',
    verificationStatus: 'unverified',
    ...over,
  }) as Task;

describe("a task's pill on the board", () => {
  it('says nothing when there is nothing to say', () => {
    expect(taskVerificationPill(task(), NOW)).toBeNull();
  });

  it('reads in-review while the panel is walking it', () => {
    expect(taskVerificationPill(task({ kanban: 'awaiting-verification' }), NOW)?.status).toBe(
      'in-review',
    );
  });

  it('links the verdict the tasks list already joined — no second fetch per card', () => {
    const pill = taskVerificationPill(
      task({
        verificationStatus: 'passed',
        lastVerificationRunId: 'vrun_9',
        lastVerifiedAt: RECENT,
      }),
      NOW,
    );
    expect(pill).toEqual({ status: 'passed', verdictHref: '/verification/vrun_9' });
  });

  it('downgrades an aged pass to stale, carrying the timestamp', () => {
    const pill = taskVerificationPill(
      task({
        verificationStatus: 'passed',
        lastVerificationRunId: 'vrun_9',
        lastVerifiedAt: ANCIENT,
      }),
      NOW,
    );
    expect(pill?.status).toBe('stale');
    expect(pill?.tip).toContain('no longer proves');
  });

  it('offers no verdict link when no run backs it — the pill downgrades it itself', () => {
    expect(
      taskVerificationPill(task({ verificationStatus: 'passed' }), NOW)?.verdictHref,
    ).toBeNull();
  });
});

const contract = (over: Partial<AcceptanceContract> = {}): AcceptanceContract =>
  ({
    id: 'ctr_1',
    version: 1,
    taskId: 'task_1',
    productId: null,
    title: 'Shorten a URL',
    baselineRunId: null,
    criteria: [
      {
        id: 'crit_1',
        kind: 'criterion',
        text: 'returns a short code',
        holdout: false,
        provenance: null,
      },
      {
        id: 'crit_2',
        kind: 'criterion',
        text: 'rejects a bad URL',
        holdout: true,
        provenance: null,
      },
      { id: 'inv_1', kind: 'invariant', text: 'never 500s', holdout: true, provenance: null },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    signature: null,
    ...over,
  }) as AcceptanceContract;

describe("the visible slice of a task's criteria", () => {
  it('shows only what the builder was shown, and states how many it was not', () => {
    const slice = criteriaSlice(contract(), [
      'returns a short code',
      'rejects a bad URL',
      'never 500s',
    ]);
    expect(slice.visible).toEqual(['returns a short code']);
    expect(slice.heldOut).toBe(2);
    expect(slice.note).toContain('2 more held out from the builder');
    expect(slice.note).toContain('all 3');
  });

  it('is honest that an uncompiled list is not a slice at all', () => {
    const slice = criteriaSlice(null, ['do the thing']);
    expect(slice.uncompiled).toBe(true);
    expect(slice.visible).toEqual(['do the thing']);
    expect(slice.heldOut).toBe(0);
    expect(slice.note).toContain('the builder would see all of these');
  });

  it('names the waived case rather than showing an empty list', () => {
    expect(criteriaSlice(null, []).note).toContain('waived');
  });

  it('says so plainly when a contract holds nothing back', () => {
    const open = contract({
      criteria: [{ id: 'crit_1', kind: 'criterion', text: 'a', holdout: false, provenance: null }],
    });
    expect(criteriaSlice(open, []).note).toContain('sees every criterion');
  });

  it('reads the highest version — an edited oracle is the current one', () => {
    expect(
      latestContract([contract({ version: 1 }), contract({ id: 'ctr_2', version: 3 })])?.id,
    ).toBe('ctr_2');
    expect(latestContract(undefined)).toBeNull();
  });
});

// The contract-promotion card's shape (counts/holdout/href/opensSheet/sort
// position) and `needsYouByProject`'s grouping used to be tested here via
// `buildDeckCards` — which moved server-side (codebase audit W10, seam S3;
// apps/daemon/src/routes/deck/deck-cards.test.ts is the daemon-side home for
// the card-shaping half). `needsYouByProject` itself is still live client-side
// and is covered against literal `DeckCard` fixtures in
// apps/web/src/hooks/use-deck-sources.test.ts.

describe('a run the human stopped', () => {
  it('draws no failure card at all — it is not a malfunction of any class', () => {
    expect(classifyRun({ status: 'failed', interruptedAt: '2026-06-01T12:00:00.000Z' })).toBeNull();
  });

  it('still classifies a run that failed on its own', () => {
    expect(classifyRun({ status: 'failed' })).toBe('harness');
  });

  it('leaves a governor deferral calm', () => {
    expect(classifyRun({ status: 'deferred' })).toBe('deferred');
  });
});

describe('the smoke schedule control', () => {
  it('offers off as a real option, not an absence', () => {
    expect(SMOKE_SCHEDULES[0]).toEqual({ label: 'Off', cron: null });
  });

  it("says the preset's words when it knows the cron, and the cron itself when it does not", () => {
    expect(scheduleLabel('0 7 * * *')).toBe('Every day at 7:00 AM');
    expect(scheduleLabel('*/5 * * * *')).toBe('*/5 * * * *');
    expect(scheduleLabel(null)).toBe('Off');
  });
});

describe("the governor's reserve floor", () => {
  it("is the daemon's own formula — the card cannot show a number the engine disagrees with", () => {
    expect(reserveFloorOf(100, 25)).toBe(75);
    expect(reserveFloorOf(40, 20)).toBe(32);
  });

  it('always leaves the daemon one spawn, unless the reserve is an explicit 100%', () => {
    expect(reserveFloorOf(1, 80)).toBe(1);
    expect(reserveFloorOf(10, 100)).toBe(0);
  });

  it('is zero for a window with no capacity', () => {
    expect(reserveFloorOf(0, 20)).toBe(0);
  });
});
