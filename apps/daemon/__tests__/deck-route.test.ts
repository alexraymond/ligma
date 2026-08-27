import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  Brief,
  DecisionItem,
  DecisionsFile,
  Project,
  ProjectsFile,
  Task,
  TasksFile,
} from '@ligma/api';
/**
 * GET /api/deck — composition parity with the old client-side selector, on a
 * seeded fixture, but assembled from the daemon's real stores this time:
 * decisions + tasks + projects (for the decision→project lookup), a stale
 * brief (engine/discovery's real writeBrief), and an adoption run awaiting
 * review (engine/adopt-repo's real saveAdoptionRun). Design approvals and
 * verdict spot-checks are covered at the pure-function level in
 * deck-cards-composition.test.ts and end-to-end against the demo seed by
 * drill-d4.ts — seeding a design (blob store + critique) or a signed verdict
 * here would duplicate that coverage for the fixture cost of a second
 * harness, not for a different risk.
 *
 * Throwaway `LIGMA_DATA_DIR`, dynamic imports after seeding — see
 * decisions-bulk-route.test.ts's header for why.
 */
import { describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-deck-route-'));
process.env.LIGMA_DATA_DIR = dataDir;

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    status: 'active',
    color: '#000',
    teamMembers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    deletedAt: null,
  };
}

function task(id: string, projectId: string | null): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    verificationStatus: 'unverified',
    projectId,
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: [],
    comments: [],
    tags: [],
    notes: '',
    dueDate: null,
    deletedAt: null,
  };
}

function decision(id: string, overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id,
    requestedBy: 'developer',
    taskId: null,
    question: `Question ${id}?`,
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({ projects: [project('proj_1')] } satisfies ProjectsFile),
  'utf-8',
);
writeFileSync(
  path.join(dataDir, 'tasks.json'),
  JSON.stringify({ tasks: [task('task_1', 'proj_1')] } satisfies TasksFile),
  'utf-8',
);
writeFileSync(
  path.join(dataDir, 'decisions.json'),
  JSON.stringify({
    decisions: [
      decision('dec_with_project', { taskId: 'task_1' }),
      decision('dec_workspace'),
      // Pending but deferred — must not appear (same rule the deck page uses).
      decision('dec_deferred', { deferUntil: '2099-01-01T00:00:00.000Z' }),
      // Already resolved — must not appear.
      decision('dec_answered', {
        status: 'answered',
        answer: 'done',
        answeredAt: '2026-01-01T00:00:00.000Z',
      }),
    ],
  } satisfies DecisionsFile),
  'utf-8',
);

const { GET } = await import('../src/routes/deck/route');
const { writeBrief } = await import('../src/engine/discovery');
const { saveAdoptionRun } = await import('../src/engine/adopt-repo');

const brief: Brief = {
  id: 'brf_1',
  projectId: 'proj_1',
  prompt: 'A landing page.',
  kind: 'web-app',
  shape: 'ui',
  status: 'compiled',
  turns: [],
  constraints: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lockedAt: '2026-01-01T00:00:00.000Z',
  compiledAt: '2026-01-01T00:00:00.000Z',
  staleFlaggedAt: '2026-01-02T00:00:00.000Z',
};
writeBrief(brief);

saveAdoptionRun({
  id: 'arun_1',
  repoPath: '/some/repo',
  projectId: null,
  status: 'awaiting-review',
  shape: null,
  boot: null,
  bootRationale: 'inferred from package.json',
  proposedJourneys: [],
  confusionLog: [],
  envId: null,
  error: null,
  startedAt: '2026-01-03T00:00:00.000Z',
  finishedAt: null,
});

interface DeckCard {
  id: string;
  kind: string;
  projectId: string | null;
  decision: DecisionItem | null;
}
interface DeckResponse {
  cards: DeckCard[];
  meta: { total: number; byKind: Record<string, number> };
}

describe('GET /api/deck', () => {
  it("composes decisions (with their task's project), a stale brief and an adoption review from the daemon's own stores", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeckResponse;

    expect(body.meta.total).toBe(body.cards.length);

    const decisionCards = body.cards.filter((c) => c.kind === 'decision');
    expect(decisionCards.map((c) => c.id).sort()).toEqual(['dec_with_project', 'dec_workspace']);
    // Deferred and already-answered decisions never became cards.
    expect(body.cards.some((c) => c.id === 'dec_deferred')).toBe(false);
    expect(body.cards.some((c) => c.id === 'dec_answered')).toBe(false);

    const withProject = decisionCards.find((c) => c.id === 'dec_with_project')!;
    expect(withProject.projectId).toBe('proj_1');
    const workspace = decisionCards.find((c) => c.id === 'dec_workspace')!;
    expect(workspace.projectId).toBeNull();

    expect(body.cards.some((c) => c.kind === 'stale-brief' && c.projectId === 'proj_1')).toBe(true);
    expect(body.cards.some((c) => c.kind === 'adoption-review')).toBe(true);

    expect(body.meta.byKind).toEqual({ decision: 2, 'stale-brief': 1, 'adoption-review': 1 });

    // KIND_ORDER: decisions, then stale-brief, then adoption-review.
    const kindsInOrder = body.cards.map((c) => c.kind);
    expect(kindsInOrder.indexOf('decision')).toBeLessThan(kindsInOrder.indexOf('stale-brief'));
    expect(kindsInOrder.indexOf('stale-brief')).toBeLessThan(
      kindsInOrder.indexOf('adoption-review'),
    );
  });
});
