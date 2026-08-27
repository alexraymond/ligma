/**
 * The promote planner must see a locked brief's discovery answers as hard
 * constraints, not just whatever free text reached it as `brief` (the studio
 * composer's retyped prompt, or the headless entrance's raw string). d2-
 * attempt-6's crit_goal failure: a user locked "No — tip total only" and "No
 * rounding" during discovery, and the promoted 8-task plan added per-person
 * splitting and a rounding toggle anyway — because nothing carried those
 * answers into the planner's prompt at all.
 *
 * Sibling of `promote-preview-honesty.test.ts`: same stubbed provider seam,
 * same mocked governor, no live model.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { GovernorDecision } from '../src/engine/quota-governor';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-promote-locked-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_locked_promote';

writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Tip calculator',
        description: '',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-08-12T00:00:00.000Z',
        tags: [],
        deletedAt: null,
        repoPath: null,
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
})) {
  writeFileSync(path.join(dataDir, file), JSON.stringify(empty), 'utf-8');
}

const decision: GovernorDecision = { allowed: true, backend: 'claude' };

vi.mock('../src/engine/quota-governor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/quota-governor')>();
  return {
    ...actual,
    claimSpawn: () => decision,
    status: () => ({
      windowHours: 5,
      used: 0,
      max: 40,
      reserveFloor: 32,
      remainingForAutonomy: 32,
      killSwitch: false,
    }),
  };
});

const { setStudioProvider } = await import('../src/studio/provider');
const { newBrief, writeBrief } = await import('../src/engine/discovery');
const { POST } = await import('../src/routes/projects/_id/promote/preview/route');

afterEach(() => setStudioProvider(null));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function lockBrief(): void {
  const brief = newBrief(PROJECT_ID, 'A tip calculator web app. Just two screens.', null);
  brief.status = 'locked';
  brief.lockedAt = new Date().toISOString();
  brief.turns.push({
    form: {
      id: 'frm_1',
      title: 'A few questions',
      description: '',
      questions: [
        {
          id: 'split',
          label: 'Split the bill per person?',
          type: 'single',
          options: ['Yes', 'No'],
          required: true,
          help: '',
        },
        {
          id: 'rounding',
          label: 'Round the total?',
          type: 'single',
          options: ['Yes', 'No'],
          required: true,
          help: '',
        },
      ],
    },
    answers: { split: 'No — tip total only', rounding: 'No — exact amounts only' },
    askedAt: new Date().toISOString(),
    answeredAt: new Date().toISOString(),
  });
  writeBrief(brief);
}

async function preview(brief: string, projectId: string = PROJECT_ID): Promise<Response> {
  const request = new Request(`http://127.0.0.1/api/projects/${projectId}/promote/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief }),
  });
  return POST(request, { params: Promise.resolve({ id: projectId }) });
}

describe("the promote planner carries a locked brief's answers as hard constraints", () => {
  it("puts the locked answers verbatim in the planner's system prompt", async () => {
    lockBrief();

    let seenSystemPrompt = '';
    let seenPrompt = '';
    setStudioProvider(async (req) => {
      seenSystemPrompt = req.systemPrompt;
      seenPrompt = req.prompt;
      await req.registry.get('submit_plan')!.run(
        {
          tasks: [
            {
              title: 'Build the calculator screen',
              description: 'A bill total and a tip total, nothing else',
              acceptanceCriteria: ['A visitor sees the tip total'],
              dependsOn: [],
              designFilePaths: [],
            },
          ],
          invariants: ['never rounds the total'],
          journeys: [],
        },
        { signal: new AbortController().signal },
      );
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', stopReason: 'stop' } as const;
        },
      };
    });

    // The web's brief page sends the brief's ID in this field, not text; the
    // stored brief must win so the planner never plans from "brf_…".
    const res = await preview('brf_opaque_reference_string');
    expect(res.status).toBe(200);

    expect(seenSystemPrompt).toContain('Locked constraints');
    expect(seenSystemPrompt).toContain('Split the bill per person?: No — tip total only');
    expect(seenSystemPrompt).toContain('Round the total?: No — exact amounts only');
    expect(seenPrompt).toContain('A tip calculator web app. Just two screens.');
    expect(seenPrompt).not.toContain('brf_opaque_reference_string');
  });

  it('omits the locked-constraints section entirely when the project has no brief', async () => {
    let seenSystemPrompt = '';
    setStudioProvider(async (req) => {
      seenSystemPrompt = req.systemPrompt;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', stopReason: 'stop' } as const;
        },
      };
    });

    await preview("some other project's brief text", 'proj_locked_promote_no_brief');

    expect(seenSystemPrompt).not.toContain('Locked constraints');
  });
});
