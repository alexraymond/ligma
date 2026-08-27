/**
 * The two guards on the one confirm (process audit P5, P6).
 *
 * Promote is the most consequential write in the product: it lands tasks and
 * freezes signed contracts. It used to take its body as an unchecked cast, and
 * to commit the same reviewed preview as many times as it was sent.
 */

import type { PromotePreview } from '@ligma/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonRequest } from '../../../../http';

/** `Response.json()` is `unknown` under this config; every assertion below reads fields. */
async function json<T = Record<string, string>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const commitPromoteMock = vi.fn();
const ensureProductRepoMock = vi.fn(async () => {});
const clearPendingMock = vi.fn();

vi.mock('../../../../studio/promote', async () => {
  // The real error class — the route branches on `instanceof`.
  const actual = await vi.importActual<typeof import('../../../../studio/promote')>(
    '../../../../studio/promote',
  );
  return {
    PromoteAlreadyCommittedError: actual.PromoteAlreadyCommittedError,
    commitPromote: (...args: unknown[]) => commitPromoteMock(...args),
  };
});
vi.mock('../../../../store/product-repo', () => ({
  ensureProductRepo: () => ensureProductRepoMock(),
}));
vi.mock('../../../../studio/pending-promotion', () => ({
  clearPendingPromotion: (...args: unknown[]) => clearPendingMock(...args),
  promotionKey: (designId: string | null) => designId ?? 'brief',
}));

const GOVERNOR = {
  estimatedSpawns: 3,
  windowHours: 5,
  used: 0,
  max: 20,
  reserveFloor: 2,
  remainingForAutonomy: 18,
  willDefer: false,
  killSwitch: false,
};

function preview(overrides: Partial<PromotePreview> = {}): Record<string, unknown> {
  return {
    projectId: 'proj_1',
    nonce: 'promo_abc',
    source: 'brief',
    designId: null,
    tasks: [
      {
        tempId: 't1',
        title: 'Scaffold API',
        description: '',
        acceptanceCriteria: ['It responds 200 on /health'],
        dependsOn: [],
        designFilePaths: [],
      },
    ],
    criteria: [
      {
        taskTempId: 't1',
        text: 'It responds 200 on /health',
        kind: 'criterion',
        holdout: false,
        quote: 'health',
      },
    ],
    holdoutNote: 'the builder will see 1 of 1',
    journeys: [],
    governor: GOVERNOR,
    designBaseline: null,
    error: null,
    ...overrides,
  } as Record<string, unknown>;
}

function post(body: unknown): DaemonRequest {
  return new DaemonRequest('http://internal/api/projects/proj_1/promote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'proj_1' });

beforeEach(() => {
  vi.clearAllMocks();
  commitPromoteMock.mockResolvedValue({
    projectId: 'proj_1',
    source: 'brief',
    designId: null,
    tasks: [],
    journeyIds: [],
    journeysDropped: [],
    designBaselineIngested: false,
  });
});

describe('POST /api/projects/:id/promote — body validation (P6)', () => {
  it('commits a well-formed preview', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ preview: preview() }), { params });

    expect(res.status).toBe(201);
    expect(commitPromoteMock).toHaveBeenCalledTimes(1);
    expect(clearPendingMock).toHaveBeenCalledWith('proj_1', 'brief');
  });

  it('rejects a criterion kind outside criterion|invariant, and commits nothing', async () => {
    const { POST } = await import('./route');
    const body = preview({
      criteria: [{ taskTempId: 't1', text: 'x', kind: 'behavior', holdout: true, quote: 'x' }],
    } as never);
    const res = await POST(post({ preview: body }), { params });

    expect(res.status).toBe(400);
    const parsed = await json<{ error: string; details: Array<{ path: string }> }>(res);
    expect(parsed.error).toBe('Validation failed');
    expect(parsed.details.some((d: { path: string }) => d.path.includes('kind'))).toBe(true);
    // The whole point: a contract with 0 visible criteria never gets signed.
    expect(commitPromoteMock).not.toHaveBeenCalled();
    expect(ensureProductRepoMock).not.toHaveBeenCalled();
  });

  it('rejects a missing preview rather than casting undefined', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({}), { params })).status).toBe(400);
    expect(commitPromoteMock).not.toHaveBeenCalled();
  });

  it('rejects an empty task breakdown', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ preview: preview({ tasks: [] }) }), { params });

    expect(res.status).toBe(400);
    expect(commitPromoteMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed journey instead of dropping it silently', async () => {
    const { POST } = await import('./route');
    const body = preview({ journeys: [{ tempId: 'j1', title: 'Buy a thing' }] } as never);

    expect((await POST(post({ preview: body }), { params })).status).toBe(400);
    expect(commitPromoteMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/:id/promote — replay (P5)', () => {
  it('409s when the same preview is committed twice', async () => {
    const { PromoteAlreadyCommittedError } = await import('../../../../studio/promote');
    commitPromoteMock.mockRejectedValueOnce(new PromoteAlreadyCommittedError('promo_abc'));
    const { POST } = await import('./route');

    const res = await POST(post({ preview: preview() }), { params });

    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/already committed/i);
  });

  it('keeps a genuine bad request at 400', async () => {
    commitPromoteMock.mockRejectedValueOnce(new Error('Preview is for project proj_2, not proj_1'));
    const { POST } = await import('./route');

    expect((await POST(post({ preview: preview() }), { params })).status).toBe(400);
  });
});
