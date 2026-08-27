import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesignCriticEvent } from '@ligma/api';
/**
 * The critique lane's Replay control reads back exactly what a run wrote —
 * this is the round trip that has to hold for replay to be trustworthy.
 */
import { afterAll, describe, expect, it } from 'vitest';

// Set before anything resolves `src/paths`, same seam `studio-snapshots.test.ts` uses.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-critic-transcript-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { readLatestCritiqueTranscript, writeCritiqueTranscript } = await import(
  '../src/studio/critic-transcript'
);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const projectId = 'test_critic_transcript';

function event(overrides: Partial<DesignCriticEvent>): DesignCriticEvent {
  return {
    designId: 'd1',
    turnId: 'dt_1',
    phase: 'start',
    status: 'running',
    rule: null,
    score: null,
    threshold: 75,
    error: null,
    ...overrides,
  };
}

describe('critique transcript persistence', () => {
  it("reads back a run's whole event stream identical to what was written", async () => {
    const events: DesignCriticEvent[] = [
      event({ phase: 'start' }),
      event({ phase: 'rule', rule: { rule: 'typography', score: 80, note: 'consistent scale' } }),
      event({ phase: 'score', score: 80 }),
      event({ phase: 'end', status: 'scored', score: 80 }),
    ];
    await writeCritiqueTranscript(projectId, 'd1', 'dt_1', events);

    const result = await readLatestCritiqueTranscript(projectId, 'd1');
    expect(result?.turnId).toBe('dt_1');
    expect(result?.events).toEqual(events);
  });

  it('returns null for a design that has never completed a critique pass', async () => {
    expect(await readLatestCritiqueTranscript(projectId, 'no-such-design')).toBeNull();
  });

  it('tolerates an empty event stream (a run that errored before its first event)', async () => {
    await writeCritiqueTranscript(projectId, 'd-empty', 'dt_x', []);
    const result = await readLatestCritiqueTranscript(projectId, 'd-empty');
    expect(result).toEqual({ turnId: 'dt_x', events: [] });
  });

  it('picks the most recently written run as latest', async () => {
    await writeCritiqueTranscript(projectId, 'd2', 'dt_a', [event({ turnId: 'dt_a' })]);
    await new Promise((resolve) => setTimeout(resolve, 10)); // force a distinct mtime
    await writeCritiqueTranscript(projectId, 'd2', 'dt_b', [event({ turnId: 'dt_b' })]);

    const result = await readLatestCritiqueTranscript(projectId, 'd2');
    expect(result?.turnId).toBe('dt_b');
  });
});
