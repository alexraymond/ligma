import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The MCP tool handlers over a throwaway data dir — list/create/answer
 * round-trips through the SAME route handlers the HTTP surface uses, since
 * that's the whole point of wrapping them in-process instead of
 * reimplementing the logic.
 *
 * `LIGMA_DATA_DIR` must be set before `../mcp-server` (or anything it
 * transitively imports) is first loaded — mirrors __tests__/briefs-api.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-mcp-server-'));
process.env.LIGMA_DATA_DIR = dataDir;

writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify({ projects: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify({ events: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'active-runs.json'), JSON.stringify({ runs: [] }), 'utf-8');

const {
  listProjectsTool,
  createProjectTool,
  listTasksTool,
  listDecisionsTool,
  answerDecisionTool,
  getRunStatusTool,
  resolveIdleExitMs,
} = await import('./mcp-server');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('create_project / list_projects', () => {
  it('creates a project and the list tool sees it', async () => {
    const created = await createProjectTool({ name: 'MCP test project' } as never);
    expect(created.status).toBe(201);
    const projectId = (created.body as { id: string }).id;

    const listed = await listProjectsTool({});
    expect(listed.status).toBe(200);
    const projects = (listed.body as { projects: Array<{ id: string; name: string }> }).projects;
    expect(projects.some((p) => p.id === projectId && p.name === 'MCP test project')).toBe(true);
  });

  it('rejects a nameless project the same way POST /api/projects does', async () => {
    const result = await createProjectTool({ name: '' } as never);
    expect(result.status).toBe(400);
  });
});

describe('list_tasks', () => {
  it('filters by projectId, mirroring GET /api/tasks', async () => {
    const project = await createProjectTool({ name: 'Task filter project' } as never);
    const projectId = (project.body as { id: string }).id;

    // Route handlers are wrapped, not duplicated — go through the real POST.
    const tasksRoute = await import('./routes/tasks/route');
    await tasksRoute.POST(
      new Request('http://x/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Scoped task', projectId }),
      }),
    );
    await tasksRoute.POST(
      new Request('http://x/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Unrelated task' }),
      }),
    );

    const scoped = await listTasksTool({ projectId });
    expect(scoped.status).toBe(200);
    const scopedTasks = (scoped.body as { tasks: Array<{ title: string }> }).tasks;
    expect(scopedTasks.map((t) => t.title)).toEqual(['Scoped task']);
  });
});

describe('list_decisions / answer_decision', () => {
  it('answers a pending decision and the list tool reflects it', async () => {
    const decisionsRoute = await import('./routes/decisions/route');
    const created = await decisionsRoute.POST(
      new Request('http://x/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Ship it?' }),
      }),
    );
    const decisionId = ((await created.json()) as { id: string }).id;

    const pending = await listDecisionsTool({ status: 'pending' });
    expect(
      (pending.body as { decisions: Array<{ id: string }> }).decisions.some(
        (d) => d.id === decisionId,
      ),
    ).toBe(true);

    const answered = await answerDecisionTool({ id: decisionId, answer: 'Yes' } as never);
    expect(answered.status).toBe(200);
    expect((answered.body as { status: string; answer: string }).status).toBe('answered');
    expect((answered.body as { status: string; answer: string }).answer).toBe('Yes');

    const stillPending = await listDecisionsTool({ status: 'pending' });
    expect(
      (stillPending.body as { decisions: Array<{ id: string }> }).decisions.some(
        (d) => d.id === decisionId,
      ),
    ).toBe(false);
  });

  it('rejects an empty answer', async () => {
    const result = await answerDecisionTool({ id: 'dec_missing', answer: '' } as never);
    expect(result.status).toBe(400);
  });
});

describe('resolveIdleExitMs', () => {
  it('defaults to 30 minutes when unset', () => {
    expect(resolveIdleExitMs({})).toBe(30 * 60 * 1000);
  });

  it('uses a valid override, floored', () => {
    expect(resolveIdleExitMs({ LIGMA_MCP_IDLE_EXIT_MS: '1234.9' })).toBe(1234);
  });

  it('clamps an override above 24h down to the max', () => {
    expect(resolveIdleExitMs({ LIGMA_MCP_IDLE_EXIT_MS: String(48 * 60 * 60 * 1000) })).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('treats 0 as disabling idle exit', () => {
    expect(resolveIdleExitMs({ LIGMA_MCP_IDLE_EXIT_MS: '0' })).toBe(0);
  });

  it('falls back to the default for invalid values', () => {
    for (const value of ['', '   ', '-1', 'not-a-number']) {
      expect(resolveIdleExitMs({ LIGMA_MCP_IDLE_EXIT_MS: value })).toBe(30 * 60 * 1000);
    }
  });
});

describe('get_run_status', () => {
  it('returns the full list with no runId, and 404s an unknown one', async () => {
    const all = await getRunStatusTool({});
    expect(all.status).toBe(200);
    expect((all.body as { runs: unknown[] }).runs).toEqual([]);

    const missing = await getRunStatusTool({ runId: 'run_nope' });
    expect(missing.status).toBe(404);
  });
});
