import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Brief, EvidencePin, Task } from '@ligma/api';
import { SHAPE_LABELS, SHAPE_QUESTION_ID, missingRequired, openForm } from '@ligma/api';
/**
 * The brief flow and evidence pins over real HTTP, against a throwaway data dir.
 *
 * Three things are actually load-bearing here and each has a test:
 *  - discovery returns a *form*, and the form always carries the shape question,
 *    because that answer is what the whole pipeline branches on;
 *  - a brief edited after its contract compiled flags its dependents stale and
 *    never invalidates them (build brief §2), and that flag is reversible —
 *    it is the Deck card's answer and its undo;
 *  - a pinned defect reaches the builder as a compiled instruction keyed by task.
 *
 * The LLM is stubbed by injection (`askNextForm({ agents })`) for the engine
 * tests and by `LIGMA_DISCOVERY_STUB` for the route tests — no spend either way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-briefs-api-'));
process.env.LIGMA_DATA_DIR = dataDir;
process.env.LIGMA_DISCOVERY_STUB = '1';

const PROJECT_ID = 'proj_brief_test';

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Pinned',
        description: '',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-08-11T00:00:00.000Z',
        tags: [],
        deletedAt: null,
        repoPath: null,
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
const { askNextForm, newBrief, readBrief, writeBrief, shapeFromAnswer } = await import(
  '../src/engine/discovery'
);

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

const get = (p: string) => fetch(`${base}${p}`);
const send = (method: string, p: string, body: unknown) =>
  fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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

describe('discovery turns', () => {
  it("always carries the shape question on the first form, ahead of the agent's own", async () => {
    const brief = await askNextForm(newBrief('proj_x', 'A tool for shortening URLs', null), {
      agents: {
        async ask() {
          return {
            id: 'frm_1',
            title: 'Questions',
            description: '',
            questions: [
              {
                id: 'rate',
                label: 'Rate limits?',
                type: 'single',
                options: ['Yes', 'No'],
                required: true,
                help: '',
              },
            ],
          };
        },
      },
    });
    const form = openForm(brief);
    expect(form?.questions[0].id).toBe(SHAPE_QUESTION_ID);
    expect(form?.questions.map((q) => q.id)).toEqual([SHAPE_QUESTION_ID, 'rate']);
  });

  it('still asks the shape when the agent says it has enough', async () => {
    const brief = await askNextForm(newBrief('proj_x', 'A CLI', null), {
      agents: {
        async ask() {
          return null;
        },
      },
    });
    expect(openForm(brief)?.questions).toHaveLength(1);
    expect(openForm(brief)?.questions[0].id).toBe(SHAPE_QUESTION_ID);
  });

  it('does not ask the shape twice', async () => {
    const first = await askNextForm(newBrief('proj_x', 'A CLI', null), {
      agents: {
        async ask() {
          return null;
        },
      },
    });
    const form = openForm(first);
    if (!form) throw new Error('expected an open form');
    const answered: Brief = {
      ...first,
      turns: first.turns.map((t) => ({
        ...t,
        answers: { [SHAPE_QUESTION_ID]: SHAPE_LABELS.headless },
        answeredAt: 'now',
      })),
    };
    const second = await askNextForm(answered, {
      agents: {
        async ask() {
          return {
            id: 'frm_2',
            title: 'More',
            description: '',
            questions: [
              { id: 'auth', label: 'Auth?', type: 'text', options: [], required: false, help: '' },
            ],
          };
        },
      },
    });
    expect(openForm(second)?.questions.map((q) => q.id)).toEqual(['auth']);
  });

  it('maps a shape answer back through its label, never a keyword match', () => {
    expect(shapeFromAnswer(SHAPE_LABELS.headless)).toBe('headless');
    expect(shapeFromAnswer('something the model invented')).toBeNull();
  });

  it('names every unanswered required field before submit', () => {
    const form = {
      id: 'f',
      title: 't',
      description: '',
      questions: [
        {
          id: 'a',
          label: 'Audience',
          type: 'text' as const,
          options: [],
          required: true,
          help: '',
        },
        { id: 'b', label: 'Budget', type: 'text' as const, options: [], required: true, help: '' },
        { id: 'c', label: 'Colour', type: 'text' as const, options: [], required: false, help: '' },
      ],
    };
    expect(missingRequired(form, { a: '  ' })).toEqual(['Audience', 'Budget']);
    expect(missingRequired(form, { a: 'devs', b: 'none' })).toEqual([]);
  });
});

describe('POST /api/briefs', () => {
  let projectId: string;

  it('creates the project and hands back an open discovery form', async () => {
    const res = await send('POST', '/api/briefs', {
      prompt: 'Build a REST API that shortens URLs',
    });
    expect(res.status).toBe(201);
    const { brief } = (await res.json()) as { brief: Brief };
    projectId = brief.projectId;
    expect(brief.status).toBe('discovery');
    expect(openForm(brief)?.questions[0].id).toBe(SHAPE_QUESTION_ID);

    const projects = (await (await get('/api/projects')).json()) as {
      projects: Array<{ id: string; briefId?: string }>;
    };
    expect(projects.projects.find((p) => p.id === projectId)?.briefId).toBe(brief.id);
  });

  it('rejects an empty prompt rather than creating a nameless project', async () => {
    expect((await send('POST', '/api/briefs', { prompt: '' })).status).toBe(400);
  });

  it('records answers, sets the project shape, and closes discovery', async () => {
    const form = openForm(readBrief(projectId) as Brief);
    if (!form) throw new Error('expected an open form');
    const res = await send('POST', `/api/projects/${projectId}/brief/answers`, {
      formId: form.id,
      answers: Object.fromEntries(
        form.questions.map((q) => [
          q.id,
          q.id === SHAPE_QUESTION_ID ? SHAPE_LABELS.headless : 'devs',
        ]),
      ),
    });
    expect(res.status).toBe(200);
    const { brief } = (await res.json()) as { brief: Brief };
    expect(brief.shape).toBe('headless');

    const projects = (await (await get('/api/projects')).json()) as {
      projects: Array<{ id: string; shape?: string }>;
    };
    expect(projects.projects.find((p) => p.id === projectId)?.shape).toBe('headless');
  });

  it('refuses answers that skip a required question', async () => {
    const seeded = writeBrief(
      await askNextForm(newBrief(PROJECT_ID, 'A thing', null), {
        agents: {
          async ask() {
            return null;
          },
        },
      }),
    );
    const form = openForm(seeded);
    if (!form) throw new Error('expected an open form');
    const res = await send('POST', `/api/projects/${PROJECT_ID}/brief/answers`, {
      formId: form.id,
      answers: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('shaped like');
  });

  it('locks the brief, and returns a null brief for a project that never had one', async () => {
    const res = await send('PATCH', `/api/projects/${projectId}/brief`, { lock: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { brief: Brief }).brief.status).toBe('locked');
    const none = await get('/api/projects/proj_nothing/brief');
    expect(none.status).toBe(200);
    expect(((await none.json()) as { brief: Brief | null }).brief).toBeNull();
  });
});

describe('editing a compiled brief', () => {
  const id = 'proj_compiled';
  const flagOf = async (res: Response) =>
    ((await res.json()) as { brief: Brief }).brief.staleFlaggedAt;

  it('flags dependents stale, and never invalidates them', async () => {
    writeBrief({
      ...newBrief(id, 'original ask', null),
      status: 'compiled',
      compiledAt: '2026-08-11T00:00:00.000Z',
    });

    const flagged = await flagOf(
      await send('PATCH', `/api/projects/${id}/brief`, { prompt: 'a changed ask' }),
    );
    expect(flagged).not.toBeNull();

    // The edit itself is applied — flagging is a claim about the dependents, not
    // a refusal to change the brief.
    expect(readBrief(id)?.prompt).toBe('a changed ask');

    // A second edit inside the same staleness episode keeps the original stamp,
    // so "when did this go stale" stays answerable.
    const again = await flagOf(
      await send('PATCH', `/api/projects/${id}/brief`, { prompt: 'changed again' }),
    );
    expect(again).toBe(flagged);
  });

  it("acknowledges and re-raises the flag — the Deck card's answer and its undo", async () => {
    expect(
      await flagOf(await send('PATCH', `/api/projects/${id}/brief`, { acknowledgeStale: true })),
    ).toBeNull();
    expect(
      await flagOf(await send('PATCH', `/api/projects/${id}/brief`, { flagStale: true })),
    ).not.toBeNull();
  });

  it('leaves an uncompiled brief unflagged — it is simply editable', async () => {
    writeBrief(newBrief('proj_draft', 'draft ask', null));
    const res = await send('PATCH', '/api/projects/proj_draft/brief', { prompt: 'edited draft' });
    expect(((await res.json()) as { brief: Brief }).brief.staleFlaggedAt).toBeNull();
  });

  it('rejects a PATCH that changes nothing', async () => {
    expect((await send('PATCH', '/api/projects/proj_draft/brief', {})).status).toBe(400);
  });
});

describe('evidence pins', () => {
  it('compiles a feedback pin into an instruction the builder route serves', async () => {
    const created = await send('POST', '/api/tasks', {
      title: 'Fix the header',
      description: '',
      importance: 'important',
      urgency: 'urgent',
    });
    const task = (await created.json()) as Task;

    const res = await send('POST', `/api/projects/${PROJECT_ID}/evidence-pins`, {
      runId: 'vrun_1',
      evidencePath: 'screenshots/step-3.png',
      x: 0.25,
      y: 0.5,
      comment: 'The nav overlaps the logo here',
      disposition: 'feedback',
      taskId: task.id,
    });
    expect(res.status).toBe(201);

    const served = (await (await get(`/api/tasks/${task.id}/evidence-pins`)).json()) as {
      pins: EvidencePin[];
      instruction: string;
    };
    expect(served.pins).toHaveLength(1);
    expect(served.instruction).toContain('REQUIRED FIXES');
    expect(served.instruction).toContain('The nav overlaps the logo here');
    expect(served.instruction).toContain('25% across, 50% down');
  });

  it('refuses a feedback pin with no task to carry it', async () => {
    const res = await send('POST', `/api/projects/${PROJECT_ID}/evidence-pins`, {
      runId: 'vrun_1',
      evidencePath: 'screenshots/step-3.png',
      x: 0,
      y: 0,
      comment: 'orphan',
      disposition: 'feedback',
    });
    expect(res.status).toBe(400);
  });

  it('creates a linked task for a new-task pin, and keeps it out of the feedback block', async () => {
    const res = await send('POST', `/api/projects/${PROJECT_ID}/evidence-pins`, {
      runId: 'vrun_2',
      evidencePath: 'screenshots/step-1.png',
      x: 0.1,
      y: 0.9,
      comment: 'The empty state needs a call to action',
      disposition: 'new-task',
    });
    const { pin } = (await res.json()) as { pin: EvidencePin };
    expect(pin.taskId).not.toBeNull();

    const tasks = (await (await get('/api/tasks')).json()) as { tasks: Task[] };
    const made = tasks.tasks.find((t) => t.id === pin.taskId);
    expect(made?.tags).toContain('evidence-pin');
    expect(made?.description).toContain('screenshots/step-1.png');

    // new-task pins are not feedback: they must not also be appended to a prompt.
    const served = (await (await get(`/api/tasks/${pin.taskId}/evidence-pins`)).json()) as {
      pins: EvidencePin[];
    };
    expect(served.pins).toHaveLength(0);
  });

  it('filters the project listing by run', async () => {
    const all = (await (await get(`/api/projects/${PROJECT_ID}/evidence-pins`)).json()) as {
      pins: EvidencePin[];
    };
    const one = (await (
      await get(`/api/projects/${PROJECT_ID}/evidence-pins?runId=vrun_2`)
    ).json()) as {
      pins: EvidencePin[];
    };
    expect(all.pins.length).toBeGreaterThan(one.pins.length);
    expect(one.pins.every((p) => p.runId === 'vrun_2')).toBe(true);
  });
});
