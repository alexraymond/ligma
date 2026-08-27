/**
 * A promote preview that was never confirmed — the record the Deck's
 * contract-promotion card is built from.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PromotePreview } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previous: string | undefined;

const PROJECT = {
  id: 'proj_a',
  name: 'A',
  description: '',
  status: 'active',
  color: '#fff',
  teamMembers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  deletedAt: null,
};

beforeEach(() => {
  previous = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-pending-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  writeFileSync(
    path.join(dataDir, 'projects.json'),
    JSON.stringify({ projects: [PROJECT] }),
    'utf-8',
  );
  vi.resetModules();
});

afterEach(() => {
  if (previous === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previous;
  rmSync(dataDir, { recursive: true, force: true });
});

const store = () => import('../src/studio/pending-promotion');
const route = () => import('../src/routes/projects/_id/promote/preview/route');

const preview = (over: Partial<PromotePreview> = {}): PromotePreview => ({
  projectId: 'proj_a',
  source: 'brief',
  designId: null,
  tasks: [
    {
      tempId: 't1',
      title: 'Shorten a URL',
      description: '',
      acceptanceCriteria: ['a'],
      dependsOn: [],
      designFilePaths: [],
    },
    {
      tempId: 't2',
      title: 'Rate limit',
      description: '',
      acceptanceCriteria: ['b'],
      dependsOn: [],
      designFilePaths: [],
    },
  ],
  criteria: [
    { taskTempId: 't1', text: 'a', kind: 'criterion', holdout: false, quote: 'a' },
    { taskTempId: 't2', text: 'b', kind: 'criterion', holdout: true, quote: 'b' },
  ],
  holdoutNote: 'the builder will see 1 of 2',
  journeys: [],
  governor: {
    estimatedSpawns: 6,
    windowHours: 5,
    used: 1,
    max: 40,
    reserveFloor: 32,
    remainingForAutonomy: 31,
    willDefer: false,
    killSwitch: false,
  },
  designBaseline: null,
  error: null,
  ...over,
});

describe('recording a pending promotion', () => {
  it('summarises what is waiting on the confirm', async () => {
    const { recordPendingPromotion } = await store();
    const record = recordPendingPromotion(preview());
    expect(record).not.toBeNull();
    expect(record?.taskCount).toBe(2);
    expect(record?.criteriaCount).toBe(2);
    expect(record?.holdoutNote).toBe('the builder will see 1 of 2');
    expect(record?.estimatedSpawns).toBe(6);
    expect(record?.key).toBe('brief');
  });

  it('records nothing for a preview that failed, or proposed no work', async () => {
    const { recordPendingPromotion, readPendingPromotions } = await store();
    expect(recordPendingPromotion(preview({ error: 'planner crashed' }))).toBeNull();
    expect(recordPendingPromotion(preview({ tasks: [] }))).toBeNull();
    expect(readPendingPromotions('proj_a')).toEqual([]);
  });

  it('keeps one record per entrance, and keeps how long it has been waiting', async () => {
    const { recordPendingPromotion, readPendingPromotions } = await store();
    const first = recordPendingPromotion(preview());
    recordPendingPromotion(preview({ designId: 'dsn_1', source: 'design' }));
    const again = recordPendingPromotion(preview({ tasks: preview().tasks.slice(0, 1) }));

    const pending = readPendingPromotions('proj_a');
    expect(pending.map((p) => p.key).sort()).toEqual(['brief', 'dsn_1']);
    // Re-previewing the same entrance replaces the summary but not the clock.
    expect(again?.taskCount).toBe(1);
    expect(again?.createdAt).toBe(first?.createdAt);
  });

  it('clears one entrance and leaves the other alone', async () => {
    const { recordPendingPromotion, clearPendingPromotion, readPendingPromotions } = await store();
    recordPendingPromotion(preview());
    recordPendingPromotion(preview({ designId: 'dsn_1', source: 'design' }));

    expect(clearPendingPromotion('proj_a', 'brief')).toBe(true);
    expect(readPendingPromotions('proj_a').map((p) => p.key)).toEqual(['dsn_1']);
    // Clearing something that was never pending is not an error, just false.
    expect(clearPendingPromotion('proj_a', 'brief')).toBe(false);
  });
});

describe('the preview route', () => {
  it('lists what is pending', async () => {
    const { recordPendingPromotion } = await store();
    recordPendingPromotion(preview());

    const { GET } = await route();
    const res = await GET(new Request('http://localhost/api/projects/proj_a/promote/preview'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    const body = (await res.json()) as { pending: Array<{ key: string }> };
    expect(res.status).toBe(200);
    expect(body.pending.map((p) => p.key)).toEqual(['brief']);
  });

  it('cancels one — DELETE names the entrance, absent means the brief one', async () => {
    const { recordPendingPromotion, readPendingPromotions } = await store();
    recordPendingPromotion(preview());
    recordPendingPromotion(preview({ designId: 'dsn_1', source: 'design' }));

    const { DELETE } = await route();
    const res = await DELETE(
      new Request('http://localhost/api/projects/proj_a/promote/preview?designId=dsn_1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'proj_a' }) },
    );
    expect(((await res.json()) as { cleared: boolean }).cleared).toBe(true);
    expect(readPendingPromotions('proj_a').map((p) => p.key)).toEqual(['brief']);
  });

  it('404s for a project that does not exist', async () => {
    const { GET } = await route();
    const res = await GET(new Request('http://localhost/api/projects/nope/promote/preview'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
