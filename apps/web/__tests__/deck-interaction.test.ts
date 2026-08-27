import type { DeckCard } from '@/hooks/use-deck-sources';
import { DRAG_SLOP, directionOf, shouldCapture } from '@/hooks/use-swipe';
import { applyCardOption } from '@/lib/deck-actions';
import {
  isUndoLive,
  parseUndoExpiry,
  patchDecision,
  undoDecision,
  undoSecondsLeft,
} from '@/lib/undo';
/**
 * The three Deck defects the d4 run caught, pinned as rules.
 *
 * Each of these was invisible to the existing suite because it lived in a
 * component: a gesture that stole clicks, a countdown that invented its own
 * window, and a card that quoted a judgement without its question. The logic is
 * out here now, so it fails loudly instead of drifting.
 *
 * The card-building tests that used to live here (spot-check card content, the
 * combined attention-budget count) tested `buildDeckCards` — which moved
 * server-side (codebase audit W10, seam S3: apps/daemon/src/routes/deck/
 * deck-cards.ts is now the single implementation, tested daemon-side at
 * deck-cards.test.ts). The web copy is deleted; `applyCardOption` below is
 * tested against literal `DeckCard` fixtures instead of cards built by the
 * now-gone function.
 */
import { describe, expect, it, vi } from 'vitest';

// ─── The gesture must not eat plain clicks ───────────────────────────────────

describe('swipe pointer capture', () => {
  it('never captures a press that did not move', () => {
    // The whole defect: capturing on pointerdown retargets `click` to the
    // capturing element, so every option button on the head card was decorative
    // to a mouse. A click is a press with no travel.
    expect(shouldCapture(0, 0)).toBe(false);
  });

  it('tolerates the wobble of a real finger or hand before claiming the pointer', () => {
    expect(shouldCapture(DRAG_SLOP, -DRAG_SLOP)).toBe(false);
    expect(shouldCapture(DRAG_SLOP + 1, 0)).toBe(true);
    expect(shouldCapture(0, -(DRAG_SLOP + 1))).toBe(true);
  });

  it('still leaves the swipe thresholds alone — capture is not a swipe', () => {
    // Capturing early enough to track a drag off the card, far short of the
    // travel that actually disposes of one.
    expect(directionOf(DRAG_SLOP + 1, 0, 80)).toBeNull();
    expect(directionOf(-120, 10, 80)).toBe('left');
    expect(directionOf(0, -120, 80)).toBe('up');
  });
});

// ─── The undo window is the server's, or it is nothing ───────────────────────

describe('undo countdown derivation', () => {
  it('reads the deadline the server returned', () => {
    const at = Date.parse('2026-08-12T03:00:10.000Z');
    expect(parseUndoExpiry({ undoExpiresAt: '2026-08-12T03:00:10.000Z' })).toBe(at);
  });

  it('offers no window when the server named none', () => {
    // The d4 failure in reverse: no invented deadline, so no button the server
    // would refuse.
    expect(parseUndoExpiry({})).toBeNull();
    expect(parseUndoExpiry(null)).toBeNull();
    expect(parseUndoExpiry({ undoExpiresAt: 'not a date' })).toBeNull();
    expect(undoSecondsLeft(null, 1_000)).toBe(0);
    expect(isUndoLive(null, 1_000)).toBe(false);
  });

  it('counts whole seconds down to the deadline and stops there', () => {
    const now = 1_000_000;
    expect(undoSecondsLeft(now + 9_400, now)).toBe(10);
    expect(undoSecondsLeft(now + 1, now)).toBe(1);
    expect(undoSecondsLeft(now - 5_000, now)).toBe(0);
    expect(isUndoLive(now + 1, now)).toBe(true);
    expect(isUndoLive(now, now)).toBe(false);
  });

  it('cannot show more time than the server granted', () => {
    // "Undo · 26s" beside copy promising ten came from a client-side clock. The
    // countdown is now a subtraction from the server's own deadline, so the only
    // way to exceed the window is for the server to grant it.
    const granted = 10_000;
    const answeredAt = 5_000_000;
    const expiresAt = parseUndoExpiry({
      undoExpiresAt: new Date(answeredAt + granted).toISOString(),
    });
    for (const elapsed of [0, 2_500, 9_999]) {
      expect(undoSecondsLeft(expiresAt, answeredAt + elapsed)).toBeLessThanOrEqual(granted / 1000);
    }
  });
});

describe('the undo click path', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("sends one PATCH and hands back the server's deadline", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      ok({ undoExpiresAt: '2026-08-12T03:00:10.000Z' }),
    );
    const res = await patchDecision(
      { id: 'dec_1', action: 'answer', answer: 'Framer Motion' },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/decisions');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({
      id: 'dec_1',
      action: 'answer',
      answer: 'Framer Motion',
    });
    expect(res.undoExpiresAt).toBe(Date.parse('2026-08-12T03:00:10.000Z'));
  });

  it('takes an answer back in one round trip', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      ok({ decision: { id: 'dec_1' } }),
    );
    await undoDecision('dec_1', fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      id: 'dec_1',
      action: 'undo',
    });
  });

  it('is idempotent — clicking undo twice is not an error', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Nothing to undo for this decision' }), {
          status: 404,
        }),
    );
    await expect(undoDecision('dec_1', fetcher)).resolves.toBeUndefined();
  });

  it("reports a closed window in the server's own words", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Undo window expired (10s)' }), { status: 409 }),
    );
    await expect(undoDecision('dec_1', fetcher)).rejects.toThrow('Undo window expired (10s)');
  });
});

// ─── The non-decision cards answer the same way from both surfaces ───────────

function designApprovalCard(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'design:des_1',
    kind: 'design-approval',
    title: 'Approve "Hero"?',
    context: 'P — an approved design compiles into the contract.',
    options: ['Approve', 'Keep iterating'],
    evidence: { facts: [{ label: 'Versions', value: '1' }] },
    href: '/projects/p1/studio?design=des_1',
    opensSheet: false,
    decision: null,
    projectId: 'p1',
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function staleBriefCard(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'brief:p1',
    kind: 'stale-brief',
    title: 'The brief changed after its contract was compiled',
    context: 'P — the designs and tasks built from it are flagged stale, not invalidated.',
    options: ['Acknowledge — the change is cosmetic'],
    evidence: { criterion: 'x' },
    href: '/projects/p1/brief',
    opensSheet: false,
    decision: null,
    projectId: 'p1',
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function spotCheckCard(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'spotcheck:vrun_5',
    kind: 'verdict-spot-check',
    title: 'Spot-check: did the judge get "Landing page — hero and CTA" right?',
    context: 'The judge returned failed. One verdict in 10 is sampled to keep it honest.',
    options: ['Looks right', 'The judge got this wrong'],
    evidence: {
      criterion: 'CTA button is above the fold on mobile',
      ruling: 'not-met: At 390×844 the CTA sits 60px below the fold.',
    },
    href: '/verification/vrun_5',
    opensSheet: false,
    decision: null,
    projectId: null,
    createdAt: '2026-08-12T02:00:00.000Z',
    ...overrides,
  };
}

describe('applying a card option', () => {
  it("approves a design against the project's own endpoint", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    const outcome = await applyCardOption(designApprovalCard(), 'Approve', fetcher);

    expect(fetcher.mock.calls[0][0]).toBe('/api/projects/p1/designs/des_1/approve');
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    // Approval freezes a signed oracle, so it is deliberately not reversible here.
    expect(outcome).toEqual({ label: 'Approved', undo: null });
  });

  it('leaves the design alone when the answer is to keep iterating', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    const outcome = await applyCardOption(designApprovalCard(), 'Keep iterating', fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome?.label).toBe('Left for iteration');
  });

  it('acknowledges a stale brief, and takes it back by re-flagging it', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    const outcome = await applyCardOption(
      staleBriefCard(),
      'Acknowledge — the change is cosmetic',
      fetcher,
    );
    expect(fetcher.mock.calls[0][0]).toBe('/api/projects/p1/brief');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      acknowledgeStale: true,
    });

    await outcome?.undo?.();
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ flagStale: true });
  });

  it('files a challenged verdict as real work, carrying the criterion with it', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 201 }),
    );
    const outcome = await applyCardOption(spotCheckCard(), 'The judge got this wrong', fetcher);

    expect(fetcher.mock.calls[0][0]).toBe('/api/decisions');
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.question).toContain('challenged by spot-check');
    expect(body.context).toContain('CTA button is above the fold on mobile');
    expect(body.context).toContain('not-met');
    expect(outcome?.label).toBe('Challenge filed');
  });

  it("reports the server's own words when an option fails", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'Design is not awaiting approval' }), { status: 409 }),
    );
    await expect(applyCardOption(designApprovalCard(), 'Approve', fetcher)).rejects.toThrow(
      'Design is not awaiting approval',
    );
  });
});
