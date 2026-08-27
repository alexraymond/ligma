/**
 * The promoted plan is a graph the daemon can actually honor.
 *
 * execution-flow-review H1/H2/H3, in one place because they are one story: the
 * planner used to emit tasks with no identity (`tempId` was stamped on
 * afterwards, so `dependsOn` had no vocabulary and every dep was silently
 * dropped by a `.filter`), no priority signal (promote hard-coded
 * important/not-urgent for all of them, making the Eisenhower sort a no-op),
 * and the sheet quoted `tasks * 3` sessions for a panel that really costs a
 * roster-and-a-judge each.
 *
 * What is pinned here: the planner names its own ids, a plan whose structure
 * cannot be honored is REFUSED rather than flattened, risk drives urgency, and
 * the cost estimate is read off the same roster function the dispatcher's door
 * uses. No live model — the provider seam is stubbed, the governor mocked.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PromotePreview, Task } from '@ligma/api';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { GovernorDecision } from '../src/engine/quota-governor';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-promote-graph-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_plan_graph';

writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Link shortener',
        description: 'A URL shortener with rate limiting.',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-08-12T00:00:00.000Z',
        tags: [],
        deletedAt: null,
        repoPath: null,
        shape: 'headless',
      },
    ],
  }),
  'utf-8',
);
for (const [file, empty] of Object.entries({
  'tasks.json': { tasks: [] },
  'goals.json': { goals: [] },
  'decisions.json': { decisions: [] },
  'activity-log.json': { events: [] },
  'inbox.json': { messages: [] },
})) {
  writeFileSync(path.join(dataDir, file), JSON.stringify(empty), 'utf-8');
}

let decision: GovernorDecision = { allowed: true, backend: 'claude' };

vi.mock('../src/engine/quota-governor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/quota-governor')>();
  return {
    ...actual,
    claimSpawn: () => decision,
    status: () => ({
      windowHours: 5,
      used: 0,
      max: 40,
      reserveFloor: 8,
      remainingForAutonomy: 32,
      killSwitch: false,
    }),
  };
});

const { parsePromotionPlan } = await import('../src/studio/tools');
const { estimateSpawns, governorEstimate, commitPromote } = await import('../src/studio/promote');
const { verificationRosterSize } = await import('../src/engine/dispatcher');
const { loadConfig } = await import('../src/engine/config');
const { setStudioProvider } = await import('../src/studio/provider');
const { getTasks } = await import('../src/store/data');
const { POST } = await import('../src/routes/projects/_id/promote/preview/route');

afterEach(() => {
  setStudioProvider(null);
  decision = { allowed: true, backend: 'claude' };
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

/** A minimal well-formed task for the parser. */
function planTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    title: 'Shorten a URL',
    description: '',
    acceptanceCriteria: ['A visitor gets a short link back'],
    risk: 'low',
    dependsOn: [],
    designFilePaths: [],
    ...over,
  };
}

// ─── H1: dependencies that can resolve ───────────────────────────────────────

describe("parsePromotionPlan — the planner's own ids are the dependency vocabulary", () => {
  it("keeps the planner's ids and the deps keyed off them", () => {
    const plan = parsePromotionPlan({
      tasks: [
        planTask({ id: 't1' }),
        planTask({ id: 't2', title: 'Write it up', dependsOn: ['t1'] }),
      ],
    });
    expect(plan.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(plan.tasks[1]!.dependsOn).toEqual(['t1']);
  });

  it('refuses a duplicate id, naming it', () => {
    expect(() =>
      parsePromotionPlan({
        tasks: [planTask({ id: 't1' }), planTask({ id: 't1', title: 'Again' })],
      }),
    ).toThrow(/t1/);
  });

  it('refuses an id that is not t<number>', () => {
    expect(() => parsePromotionPlan({ tasks: [planTask({ id: 'task-one' })] })).toThrow(/task-one/);
  });

  it('refuses an unresolvable dependsOn instead of dropping it', () => {
    expect(() =>
      parsePromotionPlan({ tasks: [planTask({ id: 't1', dependsOn: ['t9'] })] }),
    ).toThrow(/t9/);
  });

  it('refuses a task that depends on itself', () => {
    expect(() =>
      parsePromotionPlan({ tasks: [planTask({ id: 't1', dependsOn: ['t1'] })] }),
    ).toThrow(/t1/);
  });

  it('refuses a dependency cycle, naming its members', () => {
    const boom = () =>
      parsePromotionPlan({
        tasks: [
          planTask({ id: 't1', dependsOn: ['t2'] }),
          planTask({ id: 't2', title: 'Two', dependsOn: ['t3'] }),
          planTask({ id: 't3', title: 'Three', dependsOn: ['t1'] }),
        ],
      });
    expect(boom).toThrow(/cycle/i);
    expect(boom).toThrow(/t1.*t2.*t3/);
  });

  it('parses a legacy plan with no ids by position, so an in-flight preview still works', () => {
    const plan = parsePromotionPlan({
      tasks: [
        { title: 'One', acceptanceCriteria: ['a'] },
        { title: 'Two', acceptanceCriteria: ['b'], dependsOn: ['t1'] },
      ],
    });
    expect(plan.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(plan.tasks[1]!.dependsOn).toEqual(['t1']);
    expect(plan.tasks[0]!.risk).toBe('low');
  });
});

// ─── H2: the planner decides priority ────────────────────────────────────────

describe('risk', () => {
  it('is carried through the parser', () => {
    const plan = parsePromotionPlan({ tasks: [planTask({ risk: 'high' })] });
    expect(plan.tasks[0]!.risk).toBe('high');
  });

  it('refuses a risk that is neither low nor high', () => {
    expect(() => parsePromotionPlan({ tasks: [planTask({ risk: 'medium' })] })).toThrow(/risk/);
  });
});

// ─── H3: an honest cost estimate ─────────────────────────────────────────────

describe('estimateSpawns', () => {
  it("is one builder plus the shape's roster plus a judge, per task", () => {
    const { naiveUserRuns, maxVerificationAttempts } = loadConfig().execution.harness;
    const perTask = verificationRosterSize('headless', naiveUserRuns) + 2;
    expect(estimateSpawns(4, 'headless')).toEqual({
      perRound: 4 * perTask,
      ceiling: 4 * perTask * maxVerificationAttempts,
    });
  });

  it('costs an unknown shape as the most expensive one, never the cheapest', () => {
    expect(estimateSpawns(1).perRound).toBeGreaterThanOrEqual(
      estimateSpawns(1, 'headless').perRound,
    );
  });

  it('is nothing for no tasks', () => {
    expect(estimateSpawns(0, 'ui')).toEqual({ perRound: 0, ceiling: 0 });
  });
});

describe('governorEstimate', () => {
  it('quotes one round, discloses the ceiling, and defers off the round', () => {
    const { perRound, ceiling } = estimateSpawns(3, 'headless');
    const estimate = governorEstimate(3, 'headless');
    expect(estimate.estimatedSpawns).toBe(perRound);
    expect(estimate.maxSpawns).toBe(ceiling);
    expect(estimate.willDefer).toBe(perRound > 32);
  });
});

// ─── End to end: preview → commit ────────────────────────────────────────────

/** Stub a planner that submits `tasks` verbatim. */
function plannerSubmits(tasks: unknown[]): void {
  setStudioProvider(async (request) => {
    const result = await request.registry
      .get('submit_plan')!
      .run(
        { tasks, invariants: ['never loses a mapping'], journeys: [] },
        { signal: new AbortController().signal },
      );
    if (!result.ok) throw new Error(`submit_plan refused the plan: ${result.error}`);
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', stopReason: 'stop' } as const;
      },
    };
  });
}

async function preview(): Promise<PromotePreview> {
  const request = new Request(`http://127.0.0.1/api/projects/${PROJECT_ID}/promote/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: 'A URL shortener with rate limiting.' }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: PROJECT_ID }) });
  return (await response.json()) as PromotePreview;
}

describe('promote — a declared dependency lands as a real blocker', () => {
  it('maps planner ids to task ids and risk to urgency', async () => {
    plannerSubmits([
      planTask({ id: 't1', title: 'Build the shortener', risk: 'high' }),
      planTask({ id: 't2', title: 'Write the README', risk: 'low', dependsOn: ['t1'] }),
    ]);

    const body = await preview();
    expect(body.error).toBeNull();
    expect(body.tasks.map((t) => t.tempId)).toEqual(['t1', 't2']);
    expect(body.tasks[1]!.dependsOn).toEqual(['t1']);
    expect(body.tasks[0]!.risk).toBe('high');

    const result = await commitPromote(PROJECT_ID, { preview: body });
    const landed = (await getTasks()).tasks as Task[];
    const byTemp = new Map(result.tasks.map((t) => [t.tempId, t.taskId]));

    const builder = landed.find((t) => t.id === byTemp.get('t1'))!;
    const writeUp = landed.find((t) => t.id === byTemp.get('t2'))!;

    // The dep that used to vanish into `.filter(id => id !== undefined)`.
    expect(writeUp.blockedBy).toEqual([builder.id]);
    expect(builder.blockedBy).toEqual([]);

    // Risk decides urgency; importance stays the promote-wide "important".
    expect(builder.urgency).toBe('urgent');
    expect(writeUp.urgency).toBe('not-urgent');
    expect(builder.importance).toBe('important');
  });

  it('promotes a legacy preview whose tasks carry no risk', async () => {
    plannerSubmits([planTask({ id: 't1', title: 'Legacy task' })]);
    const body = await preview();
    // A preview persisted before this change: no `risk` on any task.
    const legacy: PromotePreview = {
      ...body,
      tasks: body.tasks.map(({ risk: _risk, ...task }) => task),
    };
    const result = await commitPromote(PROJECT_ID, { preview: legacy });
    const landed = (await getTasks()).tasks as Task[];
    const first = landed.find((t) => t.id === result.tasks[0]!.taskId)!;
    expect(first.urgency).toBe('not-urgent');
    expect(first.importance).toBe('important');
  });
});
