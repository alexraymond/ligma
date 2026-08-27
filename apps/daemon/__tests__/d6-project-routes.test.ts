/**
 * The two per-project routes D6 added a surface for: the criterion health board
 * the Overview renders, and the quirks section Knowledge appends to.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AcceptanceContract, CriterionHealthRow, ProjectKnowledge, Task } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let repo: string;
let previousData: string | undefined;

const task: Task = {
  id: 'task_1',
  title: 'Shorten a URL',
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'done',
  verificationStatus: 'unverified',
  projectId: 'proj_a',
  milestoneId: null,
  assignedTo: null,
  collaborators: [],
  dailyActions: [],
  subtasks: [],
  blockedBy: [],
  estimatedMinutes: null,
  actualMinutes: null,
  acceptanceCriteria: ['it works'],
  comments: [],
  tags: [],
  notes: '',
  dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  deletedAt: null,
};

const contract: AcceptanceContract = {
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
    { id: 'inv_1', kind: 'invariant', text: 'never 500s', holdout: true, provenance: null },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  signature: null,
};

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-d6-'));
  repo = mkdtempSync(path.join(tmpdir(), 'ligma-d6-repo-'));
  process.env.LIGMA_DATA_DIR = dataDir;

  writeFileSync(
    path.join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        {
          id: 'proj_a',
          name: 'A',
          description: '',
          status: 'active',
          color: '#fff',
          teamMembers: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          tags: [],
          deletedAt: null,
          repoPath: repo,
        },
      ],
    }),
    'utf-8',
  );
  writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [task] }), 'utf-8');
  mkdirSync(path.join(dataDir, 'contracts'), { recursive: true });
  writeFileSync(
    path.join(dataDir, 'contracts', 'task_1.jsonl'),
    `${JSON.stringify(contract)}\n`,
    'utf-8',
  );
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('GET /api/projects/:id/health', () => {
  it('serves one row per criterion, holdout marked, nothing pre-judged as passing', async () => {
    const { GET } = await import('../src/routes/projects/_id/health/route');
    const res = await GET(new Request('http://localhost/api/projects/proj_a/health'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { projectId: string; criteria: CriterionHealthRow[] };
    expect(body.projectId).toBe('proj_a');
    expect(body.criteria.map((c) => c.criterionId)).toEqual(['crit_1', 'inv_1']);
    expect(body.criteria.find((c) => c.criterionId === 'inv_1')?.holdout).toBe(true);
    expect(body.criteria.every((c) => c.status === 'unverified')).toBe(true);
    // Each row names what it belongs to, so no row is a bare id.
    expect(body.criteria[0].title).toBe('Shorten a URL');
  });

  it('404s for a project that does not exist', async () => {
    const { GET } = await import('../src/routes/projects/_id/health/route');
    const res = await GET(new Request('http://localhost/api/projects/nope/health'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/:id/knowledge/append', () => {
  const post = (body: unknown) =>
    new Request('http://localhost/api/projects/proj_a/knowledge/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('targets the quirks section when asked, and returns it back', async () => {
    const { POST } = await import('../src/routes/projects/_id/knowledge/append/route');
    const res = await POST(post({ note: 'the seed script is not idempotent', section: 'quirks' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { quirks: string; projectMd: string };
    expect(body.quirks).toContain('not idempotent');
    expect(body.projectMd).toContain('## Quirks');
  });

  it('still writes a plain dated note when no section is named', async () => {
    const { POST } = await import('../src/routes/projects/_id/knowledge/append/route');
    const res = await POST(post({ note: 'an ordinary note' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    const body = (await res.json()) as { quirks: string; projectMd: string };
    expect(body.projectMd).toContain('an ordinary note');
    expect(body.quirks).toBe('');
  });

  it('is what the Knowledge payload renders back', async () => {
    const { POST } = await import('../src/routes/projects/_id/knowledge/append/route');
    await POST(post({ note: 'ports below 3000 are taken', section: 'quirks' }), {
      params: Promise.resolve({ id: 'proj_a' }),
    });

    const { GET } = await import('../src/routes/projects/_id/knowledge/route');
    const knowledge = (await (
      await GET(new Request('http://localhost/api/projects/proj_a/knowledge'), {
        params: Promise.resolve({ id: 'proj_a' }),
      })
    ).json()) as ProjectKnowledge;
    expect(knowledge.quirks).toContain('ports below 3000');
  });
});
