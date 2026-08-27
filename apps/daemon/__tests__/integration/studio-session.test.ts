/**
 * A whole design session, with the model stubbed.
 *
 * This is the test that proves the studio is wired rather than merely present:
 * a turn runs through `packages/core`'s agent loop with the REAL scoped tool
 * registry, files land on disk, the version rail records a content-addressed
 * snapshot, SSE frames carry the file progress the Wall renders from, a pin
 * compiles into the instruction the apply-turn sends, approval freezes the
 * design, and promote compiles a signed contract that carries the design
 * baseline (design-as-oracle).
 *
 * The stub drives the loop through `tool_call_batch` items, which means
 * `batchAndRun` executes the same containment-checked tools the production MCP
 * bridge calls. The wire is stubbed; the machinery under test is not.
 */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DesignFilesResponse, PromotePreview } from '@ligma/api';
import type { ProviderStreamItem, ProviderTurn } from '@ligma/core/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getContract, getLatestContract, verifyContract } from '../../src/harness/contract-store';
import { DaemonRequest } from '../../src/http';
import { CENTRAL_PROJECTS_DIR, DATA_DIR } from '../../src/paths';
import { mutateProjects } from '../../src/store/data';
import { type StudioFrame, subscribeStudio } from '../../src/studio/events';
import { sourceDir } from '../../src/studio/paths';
import { type StudioTurnRequest, setStudioProvider } from '../../src/studio/provider';
import { readManifest } from '../../src/studio/store';

import * as approveRoute from '../../src/routes/projects/_id/designs/_did/approve/route';
import * as filesRoute from '../../src/routes/projects/_id/designs/_did/files/route';
import * as pinsPreviewRoute from '../../src/routes/projects/_id/designs/_did/pins/preview/route';
import * as pinsRoute from '../../src/routes/projects/_id/designs/_did/pins/route';
import * as designRoute from '../../src/routes/projects/_id/designs/_did/route';
import * as snapshotsRoute from '../../src/routes/projects/_id/designs/_did/snapshots/route';
import * as turnRoute from '../../src/routes/projects/_id/designs/_did/turn/route';
import * as designsRoute from '../../src/routes/projects/_id/designs/route';
import * as promotePreviewRoute from '../../src/routes/projects/_id/promote/preview/route';
import * as promoteRoute from '../../src/routes/projects/_id/promote/route';

const projectId = `test_studio_int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/** The transcript this session produced — printed on failure, asserted below. */
const frames: StudioFrame[] = [];
let unsubscribe: (() => void) | undefined;

// ─── The stub ────────────────────────────────────────────────────────────────

function stream(...items: ProviderStreamItem[]): ProviderTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

let generationCalls = 0;
let lastGenerationPrompt = '';

/**
 * One stub for all three lanes, discriminated by what the registry contains —
 * exactly how the production bridge decides what to declare.
 */
const stubProvider = async (request: StudioTurnRequest): Promise<ProviderTurn> => {
  if (request.registry.has('submit_critique')) {
    return stream(
      { type: 'text', delta: 'Reviewing the design against the craft rules.' },
      {
        type: 'tool_call_batch',
        calls: [
          {
            id: 'c1',
            name: 'submit_critique',
            input: {
              score: 81,
              rules: [
                { rule: 'typography', score: 84, note: 'clear hierarchy' },
                { rule: 'color', score: 78, note: 'accent contrast is tight on the CTA' },
              ],
            },
          },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    );
  }

  if (request.registry.has('submit_plan')) {
    return stream(
      {
        type: 'tool_call_batch',
        calls: [
          {
            id: 'p1',
            name: 'submit_plan',
            input: {
              tasks: [
                {
                  title: 'Build the pricing page',
                  description: 'Implement the approved pricing layout.',
                  acceptanceCriteria: [
                    'A visitor can see three pricing tiers side by side',
                    'A visitor can switch between monthly and annual pricing',
                    'The page is usable on a phone-sized screen',
                  ],
                  dependsOn: [],
                  designFilePaths: ['pricing.html'],
                },
              ],
              invariants: [
                'never shows a price without its billing period',
                "never loses the visitor's selected billing period on navigation",
              ],
              journeys: [
                {
                  title: 'Compare plans',
                  goal: 'Choose the right plan',
                  steps: ['Open pricing', 'Compare tiers'],
                },
              ],
            },
          },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    );
  }

  generationCalls += 1;
  lastGenerationPrompt = request.prompt;
  const heading = generationCalls === 1 ? 'Simple' : 'Bold';
  return stream(
    { type: 'text', delta: 'Writing the pricing screen.' },
    {
      type: 'tool_call_batch',
      calls: [
        {
          id: `w${generationCalls}a`,
          name: 'write_file',
          input: {
            path: 'pricing.html',
            content: `<h1 class="hero">${heading} pricing</h1>\n<script>const T = /*EDITMODE-BEGIN*/{"accent":"#CC785C"}/*EDITMODE-END*/;</script>`,
          },
        },
        {
          id: `w${generationCalls}b`,
          name: 'write_file',
          input: { path: 'shared/tokens.css', content: ':root{--accent:#CC785C}' },
        },
      ],
    },
    {
      type: 'tool_call_batch',
      calls: [
        {
          id: `s${generationCalls}`,
          name: 'declare_tweak_schema',
          input: { schema: { accent: { kind: 'color', live: true } } },
        },
      ],
    },
    { type: 'done', stopReason: 'stop' },
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function post(url: string, body: unknown): DaemonRequest {
  return new DaemonRequest(`http://127.0.0.1${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Turns are detached; wait for the turn-done frame the stream would carry. */
async function waitForTurn(turnId: string, timeoutMs = 10_000): Promise<StudioFrame> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const done = frames.find(
      (f) => f.event === 'design.turn-done' && (f.data as { turnId: string }).turnId === turnId,
    );
    if (done) return done;
    if (Date.now() > deadline)
      throw new Error(`turn ${turnId} did not finish within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The critique lands after turn-done; wait for the manifest to carry it. */
async function waitForCritique(designId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const manifest = await readManifest(projectId, designId);
    if (manifest?.critique) return;
    if (Date.now() > deadline) throw new Error('critique never landed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Tasks this suite compiled contracts for, so afterAll can remove them. */
const compiledTaskIds: string[] = [];

let designId = '';
let previousProvider: ReturnType<typeof setStudioProvider>;

beforeAll(async () => {
  previousProvider = setStudioProvider(stubProvider);
  await mutateProjects(async (data) => {
    data.projects.push({
      id: projectId,
      name: 'Studio integration',
      description: 'A pricing page for a small SaaS',
      status: 'active',
    } as unknown as (typeof data.projects)[number]);
  });
});

afterAll(async () => {
  setStudioProvider(previousProvider);
  unsubscribe?.();
  await rm(path.join(CENTRAL_PROJECTS_DIR, projectId), { recursive: true, force: true });
  // Contracts are tracked in git (docs/history/CONTRACTS.md), so a test that compiles
  // real ones has to take them away again or every run dirties the tree.
  for (const taskId of compiledTaskIds) {
    await rm(path.join(DATA_DIR, 'contracts', `${taskId}.jsonl`), { force: true });
  }
});

// ─── The session ─────────────────────────────────────────────────────────────

describe('a design session, end to end', () => {
  it('starts a session and streams the first turn onto the Wall', async () => {
    const response = await designsRoute.POST(
      post(`/api/projects/${projectId}/designs`, {
        prompt: 'A pricing page with three tiers',
        designSystem: null,
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);

    const created = (await response.json()) as { design: { id: string }; turn: { turnId: string } };
    designId = created.design.id;
    unsubscribe = subscribeStudio(designId, (frame) => frames.push(frame));

    const done = await waitForTurn(created.turn.turnId);
    expect((done.data as { stopReason: string }).stopReason).toBe('stop');
    expect((done.data as { filesWritten: number }).filesWritten).toBe(2);

    // The Wall's progressive render feeds off these.
    const progress = frames.filter((f) => f.event === 'design.file-progress');
    expect(progress.map((f) => (f.data as { path: string }).path).sort()).toEqual([
      'pricing.html',
      'shared/tokens.css',
    ]);
    expect(progress.every((f) => (f.data as { done: boolean }).done)).toBe(true);
  });

  it('wrote the files through the scoped registry, inside the design directory', async () => {
    const body = await readFile(path.join(sourceDir(projectId, designId), 'pricing.html'), 'utf-8');
    expect(body).toContain('Simple pricing');
    expect(body).toContain('EDITMODE-BEGIN');
  });

  it("recorded a content-addressed snapshot and the agent's tweak schema", async () => {
    const manifest = (await readManifest(projectId, designId))!;
    expect(manifest.versions).toHaveLength(1);
    expect(manifest.versions[0]!.origin).toBe('prompt');
    expect(manifest.versions[0]?.files.map((f) => f.path).sort()).toEqual([
      'pricing.html',
      'shared/tokens.css',
    ]);
    expect(manifest.versions[0]?.files.every((f) => /^[a-f0-9]{64}$/.test(f.fingerprint))).toBe(
      true,
    );
    expect(manifest.tweaks).toEqual({ accent: { kind: 'color', live: true } });

    const snapshotFrame = frames.find((f) => f.event === 'design.snapshot');
    expect(snapshotFrame).toBeDefined();
  });

  it('ran the critique panel and scored it honestly', async () => {
    await waitForCritique(designId);
    const manifest = (await readManifest(projectId, designId))!;
    expect(manifest.critique?.status).toBe('scored');
    // The mean of the lanes that scored. This session uses no design system,
    // so the fidelity lane is skipped as not-applicable and contributes
    // nothing — not a zero, and not a slot.
    expect(manifest.critique?.score).toBe(81);
    expect(manifest.critique?.error).toBeNull();
    expect(manifest.critique?.lanes?.map((lane) => [lane.lane, lane.status])).toEqual([
      ['craft-rules', 'scored'],
      ['design-system-fidelity', 'skipped'],
      ['accessibility', 'scored'],
    ]);
    // Two rules per scoring lane, flattened for readers that predate the panel.
    expect(manifest.critique?.rules).toHaveLength(4);

    const criticFrames = frames.filter((f) => f.event === 'design.critic');
    expect(criticFrames.map((f) => (f.data as { phase: string }).phase)).toEqual([
      'start',
      // craft-rules
      'start',
      'rule',
      'rule',
      'score',
      'lane',
      // design-system-fidelity — skipped before it started a turn
      'start',
      'lane',
      // accessibility
      'start',
      'rule',
      'rule',
      'score',
      'lane',
      'end',
    ]);
    // Status returns to drafting — approval is a human act, not a score threshold.
    expect(manifest.status).toBe('drafting');
  });

  it("serves the generated bodies back for the Wall's iframes", async () => {
    // Proves the round trip: the loop's tools wrote these, the snapshot stored
    // them as blobs, and the files route reads them back renderable.
    const response = await filesRoute.GET(
      new DaemonRequest(`http://127.0.0.1/api/projects/${projectId}/designs/${designId}/files`),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    const body = (await response.json()) as DesignFilesResponse;
    expect(body.files.map((f) => f.path).sort()).toEqual(['pricing.html', 'shared/tokens.css']);
    expect(body.files.find((f) => f.path === 'pricing.html')?.body).toContain('Simple pricing');
  });

  it('pins a comment and previews exactly what the apply-turn will send', async () => {
    const pinResponse = await pinsRoute.POST(
      post(`/api/projects/${projectId}/designs/${designId}/pins`, {
        filePath: 'pricing.html',
        selector: 'h1.hero',
        tag: 'h1',
        outerHTML: '<h1 class="hero">Simple pricing</h1>',
        text: 'make this headline bolder',
      }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    expect(pinResponse.status).toBe(201);
    const pin = (await pinResponse.json()) as { id: string };

    const previewResponse = await pinsPreviewRoute.POST(
      post(`/api/projects/${projectId}/designs/${designId}/pins/preview`, { prompt: '' }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    const preview = (await previewResponse.json()) as { instruction: string; pinIds: string[] };
    expect(preview.pinIds).toEqual([pin.id]);
    expect(preview.instruction).toContain('## REQUIRED EDITS');
    expect(preview.instruction).toContain('## File: pricing.html');
    expect(preview.instruction).toContain('### Edit 1: make this headline bolder');
    expect(preview.instruction).toContain('- **Target**: `<h1>` at `h1.hero`');

    // The load-bearing assertion of F4: the turn sends the previewed bytes.
    const turnResponse = await turnRoute.POST(
      post(`/api/projects/${projectId}/designs/${designId}/turn`, { kind: 'comment-apply' }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    expect(turnResponse.status).toBe(202);
    const accepted = (await turnResponse.json()) as { turnId: string };
    await waitForTurn(accepted.turnId);
    expect(lastGenerationPrompt).toBe(preview.instruction);

    const manifest = (await readManifest(projectId, designId))!;
    const applied = manifest.pins.find((p) => p.id === pin.id)!;
    expect(applied.status).toBe('applied');
    // F4: each applied pin links to the turn that applied it.
    expect(applied.appliedInVersionId).toBe(manifest.versions[manifest.versions.length - 1]!.id);
  });

  it('grew the rail rather than overwriting it, and restores by appending', async () => {
    const listed = await snapshotsRoute.GET(new DaemonRequest('http://127.0.0.1/x'), {
      params: Promise.resolve({ id: projectId, did: designId }),
    });
    const { snapshots } = (await listed.json()) as {
      snapshots: Array<{ versionId: string; n: number }>;
    };
    expect(snapshots.map((s) => s.n)).toEqual([1, 2]);

    const restored = await snapshotsRoute.POST(
      post(`/api/projects/${projectId}/designs/${designId}/snapshots`, {
        versionId: snapshots[0]?.versionId,
      }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    expect(restored.status).toBe(201);

    const manifest = (await readManifest(projectId, designId))!;
    expect(manifest.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(manifest.versions[2]!.restoredFrom).toBe(snapshots[0]!.versionId);
    // The working tree really went back, and v2 is still on the rail.
    expect(
      await readFile(path.join(sourceDir(projectId, designId), 'pricing.html'), 'utf-8'),
    ).toContain('Simple pricing');
  });

  it('applies a live tweak without spending a governor slot', async () => {
    const response = await turnRoute.POST(
      post(`/api/projects/${projectId}/designs/${designId}/turn`, {
        kind: 'tweak',
        values: { accent: '#123456' },
      }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    expect(response.status).toBe(202);
    const accepted = (await response.json()) as {
      appliedWithoutSpawn: boolean;
      versionId: string | null;
    };
    expect(accepted.appliedWithoutSpawn).toBe(true);
    expect(accepted.versionId).not.toBeNull();

    // `replaceEditmodeBlock` re-serialises the token block, so match on the
    // parsed value rather than a byte-exact spelling of the JSON.
    const body = await readFile(path.join(sourceDir(projectId, designId), 'pricing.html'), 'utf-8');
    const block = body.match(/EDITMODE-BEGIN\*\/([\s\S]*?)\/\*EDITMODE-END/)?.[1];
    expect(JSON.parse(block ?? '{}')).toEqual({ accent: '#123456' });
    const manifest = (await readManifest(projectId, designId))!;
    expect(manifest.tweakValues).toEqual({ accent: '#123456' });
  });

  it('approves the design, freezing a specific version as the baseline', async () => {
    const response = await approveRoute.POST(
      new DaemonRequest('http://127.0.0.1/x', { method: 'POST' }),
      {
        params: Promise.resolve({ id: projectId, did: designId }),
      },
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      status: string;
      baseline: { designId: string; versionId: string; files: unknown[] };
    };
    expect(result.status).toBe('approved');
    expect(result.baseline.designId).toBe(designId);
    expect(result.baseline.files.length).toBeGreaterThan(0);

    const manifest = (await readManifest(projectId, designId))!;
    // The baseline pins a version, not "latest" — latest keeps moving.
    expect(result.baseline.versionId).toBe(manifest.versions[manifest.versions.length - 1]!.id);
  });

  it('previews the promotion with the holdout disclosed and a governor estimate', async () => {
    const response = await promotePreviewRoute.POST(
      post(`/api/projects/${projectId}/promote/preview`, { designId }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const preview = (await response.json()) as PromotePreview;

    expect(preview.error).toBeNull();
    expect(preview.source).toBe('design');
    expect(preview.tasks).toHaveLength(1);
    expect(preview.tasks[0]!.designFilePaths).toEqual(['pricing.html']);
    expect(preview.designBaseline?.designId).toBe(designId);

    // 3 criteria + 2 invariants, invariants always held out, at least one visible.
    expect(preview.criteria).toHaveLength(5);
    expect(preview.criteria.filter((c) => c.kind === 'invariant').every((c) => c.holdout)).toBe(
      true,
    );
    expect(preview.criteria.some((c) => !c.holdout)).toBe(true);
    expect(preview.criteria.some((c) => c.holdout)).toBe(true);
    expect(preview.holdoutNote).toMatch(/The builder will see \d+ of 5 criteria/);

    // Roster-derived, not `tasks * 3` (execution-flow-review H3): a builder,
    // the shape's persona panel and a judge. The ceiling is disclosed too.
    expect(preview.governor.estimatedSpawns).toBeGreaterThan(3);
    expect(preview.governor.maxSpawns).toBeGreaterThanOrEqual(preview.governor.estimatedSpawns);
    expect(preview.journeys).toHaveLength(1);

    // Promote commits the reviewed breakdown, not a fresh one.
    const committed = await promoteRoute.POST(
      post(`/api/projects/${projectId}/promote`, { preview }),
      {
        params: Promise.resolve({ id: projectId }),
      },
    );
    expect(committed.status).toBe(201);
    const result = (await committed.json()) as {
      tasks: Array<{
        taskId: string;
        contractId: string;
        visibleCriteria: number;
        holdoutCriteria: number;
      }>;
      designBaselineIngested: boolean;
    };
    expect(result.designBaselineIngested).toBe(true);
    expect(result.tasks).toHaveLength(1);
    compiledTaskIds.push(...result.tasks.map((t) => t.taskId));

    // The contract is signed AND carries the design baseline — design-as-oracle.
    const contract = getLatestContract(result.tasks[0]!.taskId)!;
    expect(contract).not.toBeNull();
    expect(verifyContract(contract)).toBe(true);
    expect(contract.designBaseline?.designId).toBe(designId);
    expect(contract.designBaseline?.files.length).toBeGreaterThan(0);
    expect(contract.criteria).toHaveLength(5);
    expect(result.tasks[0]!.visibleCriteria + result.tasks[0]!.holdoutCriteria).toBe(5);

    // Re-fetch by version to prove it was actually persisted, not just returned.
    expect(getContract(result.tasks[0]!.taskId, contract.version)?.designBaseline?.versionId).toBe(
      contract.designBaseline?.versionId,
    );
  });

  it('refuses to promote a design that was never approved', async () => {
    const fresh = await designsRoute.POST(
      post(`/api/projects/${projectId}/designs`, { title: 'unapproved' }),
      {
        params: Promise.resolve({ id: projectId }),
      },
    );
    const { design } = (await fresh.json()) as { design: { id: string } };
    const response = await promotePreviewRoute.POST(
      post(`/api/projects/${projectId}/promote/preview`, { designId: design.id }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('only an approved design can be an oracle'),
    });
  });

  it('serves the whole session state in one request', async () => {
    const response = await designRoute.GET(new DaemonRequest('http://127.0.0.1/x'), {
      params: Promise.resolve({ id: projectId, did: designId }),
    });
    const body = (await response.json()) as {
      design: { status: string; pins: unknown[]; tweaks: unknown };
      snapshots: unknown[];
      turnInFlight: boolean;
    };
    expect(body.design.status).toBe('approved');
    expect(body.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(body.design.pins).toHaveLength(1);
    expect(body.design.tweaks).toEqual({ accent: { kind: 'color', live: true } });
    expect(body.turnInFlight).toBe(false);
  });
});
