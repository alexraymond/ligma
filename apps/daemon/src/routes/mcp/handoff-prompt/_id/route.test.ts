import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Handoff-prompt compilation (OD-104/OD-100), against a throwaway data dir.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-mcp-handoff-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_handoff_test';
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Handoff Target',
        description: 'A project worth handing off',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-08-11T00:00:00.000Z',
        tags: [],
        deletedAt: null,
        repoPath: '/Users/alex/code/handoff-target',
      },
      {
        id: 'proj_no_repo',
        name: 'No Repo',
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
writeFileSync(
  path.join(dataDir, 'tasks.json'),
  JSON.stringify({
    tasks: [
      {
        id: 'task_1',
        title: 'Wire the button',
        projectId: PROJECT_ID,
        kanban: 'in-progress',
        deletedAt: null,
      },
      {
        id: 'task_2',
        title: 'Deleted task',
        projectId: PROJECT_ID,
        kanban: 'not-started',
        deletedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        id: 'task_3',
        title: "Other project's task",
        projectId: 'proj_no_repo',
        kanban: 'not-started',
        deletedAt: null,
      },
    ],
  }),
  'utf-8',
);
// A workspace-wide digest covering every project. It must never leak into a
// prompt scoped to ONE project — this file, if read at all, is the bug.
writeFileSync(
  path.join(dataDir, 'ai-context-readable.md'),
  '# Snapshot\nSECRET-OTHER-PROJECT-FACT belongs to a different project.\n',
  'utf-8',
);

const { GET } = await import('./route');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/mcp/handoff-prompt/:id', () => {
  it('compiles the project and its open tasks, project-scoped only', async () => {
    const res = await GET(new Request(`http://x/api/mcp/handoff-prompt/${PROJECT_ID}`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    expect(res.status).toBe(200);
    const { prompt, vscodeUrl } = (await res.json()) as {
      prompt: string;
      vscodeUrl: string | null;
    };

    expect(prompt).toContain('Handoff Target');
    expect(prompt).toContain('A project worth handing off');
    expect(prompt).toContain('task_1: Wire the button [in-progress]');
    expect(prompt).not.toContain('Deleted task');
    expect(prompt).not.toContain("Other project's task");
    expect(vscodeUrl).toBe('vscode://file//Users/alex/code/handoff-target');
  });

  it('never leaks the workspace-wide snapshot into a project-scoped handoff', async () => {
    const res = await GET(new Request(`http://x/api/mcp/handoff-prompt/${PROJECT_ID}`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    const { prompt } = (await res.json()) as { prompt: string };

    expect(prompt).not.toContain('SECRET-OTHER-PROJECT-FACT');
    expect(prompt).not.toContain('workspace snapshot');
  });

  it('reports no repo instead of a broken vscode link', async () => {
    const res = await GET(new Request('http://x/api/mcp/handoff-prompt/proj_no_repo'), {
      params: Promise.resolve({ id: 'proj_no_repo' }),
    });
    const { prompt, vscodeUrl } = (await res.json()) as {
      prompt: string;
      vscodeUrl: string | null;
    };
    expect(prompt).toContain('Repo: none');
    expect(vscodeUrl).toBeNull();
  });

  it('404s an unknown project', async () => {
    const res = await GET(new Request('http://x/api/mcp/handoff-prompt/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
