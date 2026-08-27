import type { DeckCard } from '@/hooks/use-deck-sources';
/**
 * The drift trigger's two Deck-card answers (build brief §16 Phase 2):
 * "Re-run discovery" navigates to the brief thread, "Still true (snooze 90
 * days)" PATCHes the brief's snooze action. The plain post-lock-edit
 * "Acknowledge" path is covered by apps/web/__tests__/deck-interaction.test.ts
 * and is left untouched here.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyCardOption, navigationFor } from './deck-actions';

function driftCard(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'brief:p1',
    kind: 'stale-brief',
    title: 'Still true?',
    context: '',
    options: ['Re-run discovery', 'Still true (snooze 90 days)'],
    evidence: null,
    href: '/projects/p1/brief',
    opensSheet: false,
    decision: null,
    projectId: 'p1',
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('stale-brief drift options', () => {
  it('navigates to the brief thread for Re-run discovery, without hitting the network', async () => {
    const fetcher = vi.fn(
      async (url: string, init?: RequestInit) => (
        void url, void init, new Response('{}', { status: 200 })
      ),
    );
    const card = driftCard();

    expect(navigationFor(card, 'Re-run discovery')).toBe('/projects/p1/brief');
    const outcome = await applyCardOption(card, 'Re-run discovery', fetcher);
    expect(outcome).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('snoozes the brief for 90 days and is not undoable', async () => {
    const fetcher = vi.fn(
      async (url: string, init?: RequestInit) => (
        void url, void init, new Response('{}', { status: 200 })
      ),
    );
    const card = driftCard();

    const outcome = await applyCardOption(card, 'Still true (snooze 90 days)', fetcher);

    expect(fetcher.mock.calls[0][0]).toBe('/api/projects/p1/brief');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ snooze: true });
    expect(outcome).toEqual({ label: 'Snoozed for 90 days', undo: null });
  });

  it('does not navigate for the snooze option', () => {
    expect(navigationFor(driftCard(), 'Still true (snooze 90 days)')).toBeNull();
  });
});

// S2: the spot-check answer used to be `markSpotCheckReviewed` writing to one
// browser's localStorage — unanswerable from the CLI/an agent, and re-asked in
// every other client. It now hits the real `POST /api/deck/spot-check` route.
function spotCheckCard(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'spotcheck:vrun_5',
    kind: 'verdict-spot-check',
    title: 'Spot-check: did the judge get "Landing page" right?',
    context: 'The judge returned failed.',
    options: ['Looks right', 'The judge got this wrong'],
    evidence: { criterion: 'CTA is above the fold', ruling: 'not-met: below the fold' },
    href: '/verification/vrun_5',
    opensSheet: false,
    decision: null,
    projectId: 'p1',
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('verdict spot-check options', () => {
  it('confirms by POSTing to the server, not localStorage, and is not undoable', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 201 }),
    );
    const outcome = await applyCardOption(spotCheckCard(), 'Looks right', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/deck/spot-check');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      taskId: null,
      runId: 'vrun_5',
      answer: 'confirmed',
    });
    expect(outcome).toEqual({ label: 'Verdict confirmed', undo: null });
  });

  it("reports the server's own words when the confirm write fails", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'Verification run not found: vrun_5' }), {
          status: 404,
        }),
    );
    await expect(applyCardOption(spotCheckCard(), 'Looks right', fetcher)).rejects.toThrow(
      'Verification run not found: vrun_5',
    );
  });

  it('files the challenge as a decision, then records the dispute server-side', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 201 }),
    );
    const outcome = await applyCardOption(spotCheckCard(), 'The judge got this wrong', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('/api/decisions');
    expect(fetcher.mock.calls[1][0]).toBe('/api/deck/spot-check');
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({
      taskId: null,
      runId: 'vrun_5',
      answer: 'disputed',
    });
    expect(outcome).toEqual({ label: 'Challenge filed', undo: null });
  });
});
