/**
 * `POST /api/projects/:id/promote/preview` never answers with a bare failure.
 *
 * d1-attempt-1's blocker (crit_5): every persona who reached Promote read a raw
 * "500 Internal Server Error" in the dialog and had nothing to do about it. Two
 * defects made that string: the request outlived Node's 300s `requestTimeout`
 * (fixed in `src/server.ts`, where the socket used to be destroyed under a live
 * handler), and the planner blocked for five minutes on a governor that had
 * already decided (fixed here — the denial is answered immediately).
 *
 * What these tests pin is the second half plus the shape the sheet renders: a
 * failed preview is an HTTP 200 carrying `error` AND a `causeKind` the web's one
 * failure-card family maps to a card with an action. No live model runs — the
 * provider seam is stubbed and the governor is mocked off the real ledger.
 */

import type { PromotePreview } from '@ligma/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GovernorDecision } from '../src/engine/quota-governor';

/** What `claimSpawn` answers next. Reassigned per test. */
let decision: GovernorDecision = { allowed: true, backend: 'claude' };

vi.mock('../src/engine/quota-governor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/quota-governor')>();
  return {
    ...actual,
    // Never touches the real quota ledger; `deferralFields` stays the real one,
    // because how a denial becomes {causeKind, resumesAt} is under test.
    claimSpawn: () => decision,
    status: () => ({
      windowHours: 5,
      used: 0,
      max: 40,
      reserveFloor: 32,
      remainingForAutonomy: 32,
      killSwitch: false,
    }),
  };
});

const { setStudioProvider } = await import('../src/studio/provider');
const { POST } = await import('../src/routes/projects/_id/promote/preview/route');

const PROJECT_ID = 'proj_promote_honesty';

async function preview(): Promise<{ status: number; body: PromotePreview }> {
  const request = new Request(`http://127.0.0.1/api/projects/${PROJECT_ID}/promote/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: 'A URL shortener with rate limiting.' }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: PROJECT_ID }) });
  return { status: response.status, body: (await response.json()) as PromotePreview };
}

afterEach(() => {
  setStudioProvider(null);
  decision = { allowed: true, backend: 'claude' };
});

describe('a failed promote preview is classified, never bare', () => {
  it('reports a dead model wire as a backend failure, not a 500', async () => {
    setStudioProvider(() => {
      throw new Error('Claude Code CLI not found on PATH');
    });

    const { status, body } = await preview();

    expect(status).toBe(200);
    expect(body.error).toContain('Claude Code CLI not found');
    expect(body.causeKind).toBe('backend');
    // Fail-honest: nothing is invented to fill the sheet.
    expect(body.tasks).toEqual([]);
    expect(body.criteria).toEqual([]);
  });

  it('reports a planner that never called submit_plan as a parse failure', async () => {
    setStudioProvider(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text', delta: 'here is a plan, in prose' } as const;
        yield { type: 'done', stopReason: 'stop' } as const;
      },
    }));

    const { status, body } = await preview();

    expect(status).toBe(200);
    expect(body.error).toContain('without calling submit_plan');
    expect(body.causeKind).toBe('parse');
  });

  it('answers a governor denial immediately, as a deferral with a resume time', async () => {
    decision = { allowed: false, reason: 'reserve', retryInMs: 90_000, backend: 'claude' };
    // The seam proves no spawn was attempted: reaching it at all is the failure.
    setStudioProvider(() => {
      throw new Error('the planner must not run on a denied slot');
    });

    const started = Date.now();
    const { status, body } = await preview();

    expect(status).toBe(200);
    expect(body.causeKind).toBe('rate-limit');
    expect(body.error).toContain('reserve');
    expect(Date.parse(body.resumesAt ?? '')).toBeGreaterThan(started);
    // The old code waited five minutes here and lost the socket doing it.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('carries a null cause on the success path, so the sheet renders no card', async () => {
    setStudioProvider(async (request) => {
      await request.registry.get('submit_plan')!.run(
        {
          tasks: [
            {
              title: 'Shorten a URL',
              description: 'Accept a long URL, hand back a short one',
              acceptanceCriteria: ['A visitor gets a short link back'],
              dependsOn: [],
              designFilePaths: [],
            },
          ],
          invariants: ['never loses a mapping'],
          journeys: [
            { title: 'Shorten one link', goal: 'Get a short link', steps: ['POST a URL'] },
          ],
        },
        { signal: new AbortController().signal },
      );
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', stopReason: 'stop' } as const;
        },
      };
    });

    const { status, body } = await preview();

    expect(status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.causeKind).toBeNull();
    expect(body.tasks).toHaveLength(1);
  });
});
