import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Brief, DecisionItem } from '@ligma/api';
import { SHAPE_LABELS, SHAPE_QUESTION_ID } from '@ligma/api';
/**
 * POST /api/projects/:id/brief/amend, over real HTTP against a throwaway data
 * dir — the daemon route wiring `applyAmendment` (discovery-amend.test.ts)
 * into the brief store, an appended decision row, and a locked brief's
 * consequence (build brief §16 Phase 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-brief-amend-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_amend_route';

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Amend route project',
        description: '',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        tags: [],
        deletedAt: null,
      },
    ],
  }),
  'utf-8',
);
writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'goals.json'), JSON.stringify({ goals: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify({ events: [] }), 'utf-8');

const { createApp } = await import('../src/server');
const { newBrief, writeBrief, readBrief } = await import('../src/engine/discovery');

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

const get = (p: string) => fetch(`${base}${p}`);
const send = (method: string, p: string, body: unknown) =>
  fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function seedAnsweredBrief(status: Brief['status'] = 'discovery'): Brief {
  const brief: Brief = {
    ...newBrief(PROJECT_ID, 'A tool for shortening URLs', null),
    status,
    turns: [
      {
        form: {
          id: 'frm_1',
          title: 'A few questions',
          description: '',
          questions: [
            {
              id: SHAPE_QUESTION_ID,
              label: 'What is this, shaped like?',
              type: 'single',
              options: Object.values(SHAPE_LABELS),
              required: true,
              help: '',
            },
            {
              id: 'auth',
              label: 'Who signs in?',
              type: 'single',
              options: ['Nobody', 'One admin', 'Many accounts'],
              required: true,
              help: '',
            },
          ],
        },
        answers: { [SHAPE_QUESTION_ID]: SHAPE_LABELS.headless, auth: 'Nobody' },
        askedAt: '2026-01-01T00:00:00.000Z',
        answeredAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    shape: 'headless',
  };
  return writeBrief(brief);
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /api/projects/:id/brief/amend', () => {
  it('amends an answered question, appends a decision row with consequenceTaskIds, and reports staleFlagged: false pre-lock', async () => {
    seedAnsweredBrief('discovery');

    const res = await send('POST', `/api/projects/${PROJECT_ID}/brief/amend`, {
      formId: 'frm_1',
      questionId: 'auth',
      answer: 'One admin',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; decisionId: string; staleFlagged: boolean };
    expect(body.ok).toBe(true);
    expect(body.staleFlagged).toBe(false);

    expect(readBrief(PROJECT_ID)?.turns[0].answers?.auth).toBe('One admin');

    const decisions = (await (await get('/api/decisions')).json()) as { decisions: DecisionItem[] };
    const row = decisions.decisions.find((d) => d.id === body.decisionId);
    expect(row).toBeDefined();
    expect(row?.question).toContain('Brief answer changed — Who signs in?');
    expect(row?.status).toBe('answered');
    expect(row?.answer).toBe('One admin');
    // The field must exist even though nothing re-derives off it yet.
    expect(row?.consequenceTaskIds).toEqual([]);
  });

  it("sets staleFlagged: true and raises the brief's own flag once it is locked", async () => {
    seedAnsweredBrief('locked');

    const res = await send('POST', `/api/projects/${PROJECT_ID}/brief/amend`, {
      formId: 'frm_1',
      questionId: 'auth',
      answer: 'Many accounts',
    });
    const body = (await res.json()) as { staleFlagged: boolean };
    expect(body.staleFlagged).toBe(true);
    expect(readBrief(PROJECT_ID)?.staleFlaggedAt).not.toBeNull();
  });

  it('still refuses a formId that was never answered (the open-form / stale-client case)', async () => {
    seedAnsweredBrief('discovery');
    const res = await send('POST', `/api/projects/${PROJECT_ID}/brief/amend`, {
      formId: 'frm_never_answered',
      questionId: 'auth',
      answer: 'One admin',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('no longer the open one');
  });

  it('404s for a project with no brief', async () => {
    const res = await send('POST', '/api/projects/proj_nothing/brief/amend', {
      formId: 'frm_1',
      questionId: 'auth',
      answer: 'One admin',
    });
    expect(res.status).toBe(404);
  });
});
