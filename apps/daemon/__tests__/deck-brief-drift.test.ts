import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Brief, Project, ProjectsFile, Task, TasksFile } from '@ligma/api';
import { DRIFT_TASK_THRESHOLD } from '@ligma/api';
/**
 * The brief drift trigger, composed for real: `GET /api/deck` reading
 * tasks.json for "how many of this project's tasks completed after the brief
 * was last touched" and folding that into `isBriefDrifted` (build brief §16
 * Phase 2). The age × task-count truth table itself is pinned at the pure
 * level in packages/api/src/briefs.test.ts; this is the derivation from real
 * stores plus the card-options branch it feeds (deck-cards.ts).
 *
 * Throwaway `LIGMA_DATA_DIR`, dynamic imports after seeding.
 */
import { describe, expect, it } from 'vitest';
import { type DeckSources, buildDeckCards } from '../src/routes/deck/deck-cards';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-deck-drift-'));
process.env.LIGMA_DATA_DIR = dataDir;

const OLD_UPDATED_AT = '2026-01-01T00:00:00.000Z'; // 200+ days before "today" in these tests

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    status: 'active',
    color: '#000',
    teamMembers: [],
    createdAt: OLD_UPDATED_AT,
    tags: [],
    deletedAt: null,
  };
}

function doneTask(id: string, projectId: string, completedAt: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'done',
    verificationStatus: 'unverified',
    projectId,
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    createdAt: OLD_UPDATED_AT,
    updatedAt: completedAt,
    completedAt,
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

function tasksCompletedAfter(projectId: string, count: number): Task[] {
  return Array.from({ length: count }, (_, i) =>
    doneTask(`task_${i}`, projectId, '2026-02-01T00:00:00.000Z'),
  );
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [project('proj_drift'), project('proj_stable'), project('proj_snoozed')],
  } satisfies ProjectsFile),
  'utf-8',
);
writeFileSync(
  path.join(dataDir, 'tasks.json'),
  JSON.stringify({
    tasks: [
      ...tasksCompletedAfter('proj_drift', DRIFT_TASK_THRESHOLD),
      ...tasksCompletedAfter('proj_stable', DRIFT_TASK_THRESHOLD - 1), // one short — must not drift
      ...tasksCompletedAfter('proj_snoozed', DRIFT_TASK_THRESHOLD),
    ],
  } satisfies TasksFile),
  'utf-8',
);
writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');

const { GET } = await import('../src/routes/deck/route');
const { writeBrief, newBrief } = await import('../src/engine/discovery');

function seedBrief(projectId: string, staleSnoozedUntil: string | null = null): Brief {
  return writeBrief({
    ...newBrief(projectId, 'ask', null),
    status: 'locked',
    updatedAt: OLD_UPDATED_AT,
    staleSnoozedUntil,
  });
}

seedBrief('proj_drift');
seedBrief('proj_stable');
seedBrief('proj_snoozed', '2099-01-01T00:00:00.000Z'); // snoozed well into the future

interface DeckCardLike {
  id: string;
  kind: string;
  projectId: string | null;
  options: string[];
}

describe('GET /api/deck — brief drift, composed from tasks.json', () => {
  it('fires the stale-brief card, with the drift options, once age and task-count both clear', async () => {
    const res = await GET();
    const body = (await res.json()) as { cards: DeckCardLike[] };

    const drifted = body.cards.find(
      (c) => c.projectId === 'proj_drift' && c.kind === 'stale-brief',
    );
    expect(drifted?.options).toEqual(['Re-run discovery', 'Still true (snooze 90 days)']);
  });

  it('does not fire for a brief one task short of the threshold', async () => {
    const res = await GET();
    const body = (await res.json()) as { cards: DeckCardLike[] };
    expect(body.cards.some((c) => c.projectId === 'proj_stable' && c.kind === 'stale-brief')).toBe(
      false,
    );
  });

  it('does not fire while snoozed', async () => {
    const res = await GET();
    const body = (await res.json()) as { cards: DeckCardLike[] };
    expect(body.cards.some((c) => c.projectId === 'proj_snoozed' && c.kind === 'stale-brief')).toBe(
      false,
    );
  });
});

describe('buildDeckCards — stale-brief options by trigger', () => {
  const base: DeckSources = {
    decisions: [],
    designs: [],
    staleBriefs: [],
    adoptionRuns: [],
    spotChecks: [],
  };

  it('offers the drift pair when drifted', () => {
    const cards = buildDeckCards({
      ...base,
      staleBriefs: [
        {
          projectId: 'p1',
          projectName: 'P',
          prompt: 'x',
          staleFlaggedAt: '2026-01-01T00:00:00.000Z',
          drifted: true,
        },
      ],
    });
    expect(cards[0].options).toEqual(['Re-run discovery', 'Still true (snooze 90 days)']);
  });

  it('keeps the plain acknowledge option when only the edit-flag fired', () => {
    const cards = buildDeckCards({
      ...base,
      staleBriefs: [
        {
          projectId: 'p1',
          projectName: 'P',
          prompt: 'x',
          staleFlaggedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(cards[0].options).toEqual(['Acknowledge — the change is cosmetic']);
  });
});
