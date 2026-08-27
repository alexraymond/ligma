/**
 * The critique panel (roadmap Phase 8) — three panelists where there was one.
 *
 * The properties under test are the ones the single critic already had and the
 * panel must not lose: every lane is governed, a denied lane is *skipped* and
 * never faked, and the combined score is the mean of the lanes that actually
 * scored — not of the lanes that were asked.
 *
 * No model turn runs here: `runCritiquePass` takes a judge seam, so the whole
 * orchestration (lane selection, slot claiming, event frames, aggregation,
 * transcript) is exercised against a stub verdict.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CritiqueLaneReport, DesignCriticEvent, DesignManifest } from '@ligma/api';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-critique-lanes-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { GovernorAbort } = await import('../src/engine/quota-governor');
type LaneJudge = import('../src/studio/critic').LaneJudge;
const { CRITIQUE_LANES, CRITIQUE_THRESHOLD, aggregateCritique, configuredLanes, runCritiquePass } =
  await import('../src/studio/critic');
const { readLatestCritiqueTranscript } = await import('../src/studio/critic-transcript');

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const envLanes = process.env.LIGMA_STUDIO_CRITIQUE_LANES;
beforeEach(() => {
  if (envLanes === undefined) delete process.env.LIGMA_STUDIO_CRITIQUE_LANES;
  else process.env.LIGMA_STUDIO_CRITIQUE_LANES = envLanes;
});

function manifest(overrides: Partial<DesignManifest> = {}): DesignManifest {
  return {
    id: 'd_panel',
    projectId: 'test_critique_lanes',
    title: 'Pricing page',
    status: 'critiquing',
    createdAt: 't0',
    updatedAt: 't0',
    designSystem: 'anthropic',
    sourcePrompt: 'a pricing page',
    versions: [],
    pins: [],
    tweaks: null,
    tweakValues: {},
    critique: null,
    approvedAt: null,
    promotedContractId: null,
    ...overrides,
  };
}

function lane(overrides: Partial<CritiqueLaneReport>): CritiqueLaneReport {
  return { lane: 'craft-rules', status: 'scored', score: 80, rules: [], error: null, ...overrides };
}

/** A judge that scores every lane it is asked, with a per-lane score. */
function scoringJudge(scores: Record<string, number>): LaneJudge {
  return async ({ lane: id }) => ({
    verdict: {
      score: scores[id] ?? 70,
      rules: [{ rule: id, score: scores[id] ?? 70, note: `${id} note` }],
    },
    stopReason: 'stop',
  });
}

const allowAll = async (): Promise<string> => 'claude';

describe('lane configuration', () => {
  it('defaults to the full panel', () => {
    expect(configuredLanes()).toEqual([...CRITIQUE_LANES]);
  });

  it('honours an explicit lane list', () => {
    process.env.LIGMA_STUDIO_CRITIQUE_LANES = 'accessibility,craft-rules';
    expect(configuredLanes()).toEqual(['accessibility', 'craft-rules']);
  });

  it('falls back to the single critic rather than to nothing when the list is unusable', () => {
    process.env.LIGMA_STUDIO_CRITIQUE_LANES = 'nonsense, also-nonsense';
    expect(configuredLanes()).toEqual(['craft-rules']);
  });
});

describe('aggregate score', () => {
  it('is the simple mean of the lanes that scored', () => {
    const report = aggregateCritique(
      [lane({ lane: 'craft-rules', score: 90 }), lane({ lane: 'accessibility', score: 60 })],
      null,
      't0',
    );
    expect(report.status).toBe('scored');
    expect(report.score).toBe(75);
  });

  it('never dilutes the mean with a lane that never ran', () => {
    const report = aggregateCritique(
      [
        lane({ lane: 'craft-rules', score: 90 }),
        lane({
          lane: 'design-system-fidelity',
          status: 'skipped',
          score: null,
          skipReason: 'quota',
          error: 'denied',
        }),
      ],
      null,
      't0',
    );
    // 90, not 45 — a skipped lane is silence, not a zero.
    expect(report.score).toBe(90);
  });

  it('is an error, not a score, when no lane scored at all', () => {
    const report = aggregateCritique(
      [lane({ status: 'skipped', score: null, skipReason: 'quota', error: 'governor denied' })],
      null,
      't0',
    );
    expect(report.status).toBe('error');
    expect(report.score).toBeNull();
    expect(report.error).toContain('governor denied');
  });

  it('reports an interrupted panel as interrupted, not errored', () => {
    const report = aggregateCritique(
      [lane({ status: 'interrupted', score: null, error: null })],
      null,
      't0',
    );
    expect(report.status).toBe('interrupted');
    expect(report.score).toBeNull();
  });

  it('keeps the flat rule list every pre-panel reader already speaks', () => {
    const report = aggregateCritique(
      [
        lane({ lane: 'craft-rules', rules: [{ rule: 'color', score: 90, note: 'ok' }] }),
        lane({ lane: 'accessibility', rules: [{ rule: 'contrast', score: 60, note: 'thin' }] }),
      ],
      null,
      't0',
    );
    expect(report.rules.map((r) => r.rule)).toEqual(['color', 'contrast']);
  });
});

describe('panel orchestration', () => {
  it('runs one governed judge turn per lane and aggregates their scores', async () => {
    const claimed: string[] = [];
    const report = await runCritiquePass(manifest(), 'dt_all', new AbortController().signal, {
      claimSlot: async (id) => {
        claimed.push(id);
        return 'claude';
      },
      judge: scoringJudge({ 'craft-rules': 90, 'design-system-fidelity': 80, accessibility: 70 }),
    });

    expect(claimed).toEqual([...CRITIQUE_LANES]);
    expect(report.status).toBe('scored');
    expect(report.score).toBe(80);
    expect(report.lanes?.map((l) => [l.lane, l.status, l.score])).toEqual([
      ['craft-rules', 'scored', 90],
      ['design-system-fidelity', 'scored', 80],
      ['accessibility', 'scored', 70],
    ]);
    expect(report.threshold).toBe(CRITIQUE_THRESHOLD);
  });

  it('reports a governor-denied lane as skipped — never as a zero, never faked', async () => {
    const report = await runCritiquePass(manifest(), 'dt_denied', new AbortController().signal, {
      claimSlot: async (id) => {
        if (id === 'accessibility')
          throw new GovernorAbort('governor denied studio critique (reason: reserve)');
        return 'claude';
      },
      judge: scoringJudge({ 'craft-rules': 90, 'design-system-fidelity': 80 }),
    });

    const a11y = report.lanes?.find((l) => l.lane === 'accessibility');
    expect(a11y?.status).toBe('skipped');
    expect(a11y?.skipReason).toBe('quota');
    expect(a11y?.score).toBeNull();
    // The panel still says something, out of the lanes that did run.
    expect(report.status).toBe('scored');
    expect(report.score).toBe(85);
  });

  it('degrades to exactly the single-critic pass when configured to one lane', async () => {
    process.env.LIGMA_STUDIO_CRITIQUE_LANES = 'craft-rules';
    const report = await runCritiquePass(manifest(), 'dt_one', new AbortController().signal, {
      claimSlot: allowAll,
      judge: scoringJudge({ 'craft-rules': 64 }),
    });
    expect(report.lanes).toHaveLength(1);
    expect(report.score).toBe(64);
    expect(report.rules).toEqual([{ rule: 'craft-rules', score: 64, note: 'craft-rules note' }]);
  });

  it('errors the lane, not the pass, when a judge never submits a verdict', async () => {
    const report = await runCritiquePass(manifest(), 'dt_silent', new AbortController().signal, {
      claimSlot: allowAll,
      judge: async ({ lane: id }) =>
        id === 'craft-rules'
          ? { verdict: null, stopReason: 'max_turns' }
          : { verdict: { score: 88, rules: [] }, stopReason: 'stop' },
    });
    const craft = report.lanes?.find((l) => l.lane === 'craft-rules');
    expect(craft?.status).toBe('error');
    expect(craft?.score).toBeNull();
    expect(craft?.error).toContain('submit_critique');
    expect(report.status).toBe('scored');
  });

  it('skips the design-system lane as not-applicable when no package is in use', async () => {
    const report = await runCritiquePass(
      manifest({ designSystem: null }),
      'dt_nods',
      new AbortController().signal,
      {
        claimSlot: allowAll,
        judge: scoringJudge({}),
      },
    );
    const fidelity = report.lanes?.find((l) => l.lane === 'design-system-fidelity');
    expect(fidelity?.status).toBe('skipped');
    expect(fidelity?.skipReason).toBe('not-applicable');
  });

  it('never throws — a judge that explodes comes back as an errored lane', async () => {
    const report = await runCritiquePass(manifest(), 'dt_boom', new AbortController().signal, {
      claimSlot: allowAll,
      judge: async () => {
        throw new Error('provider exploded');
      },
    });
    expect(report.status).toBe('error');
    expect(report.lanes?.every((l) => l.status === 'error')).toBe(true);
  });

  it('persists a lane-tagged transcript the replay control can read back', async () => {
    await runCritiquePass(manifest({ id: 'd_tx' }), 'dt_tx', new AbortController().signal, {
      claimSlot: allowAll,
      judge: scoringJudge({ 'craft-rules': 90, 'design-system-fidelity': 80, accessibility: 70 }),
    });

    const transcript = await readLatestCritiqueTranscript('test_critique_lanes', 'd_tx');
    const frames = transcript?.events ?? [];
    const laneFrames = frames.filter((e: DesignCriticEvent) => e.phase === 'lane');
    expect(laneFrames.map((e) => e.laneReport?.lane)).toEqual([...CRITIQUE_LANES]);
    expect(frames.filter((e) => e.phase === 'rule').every((e) => e.lane !== null)).toBe(true);
    expect(frames.at(-1)).toMatchObject({ phase: 'end', status: 'scored', score: 80 });
  });
});
