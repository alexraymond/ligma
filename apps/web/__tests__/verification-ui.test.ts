import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { personaSeedLabel } from '@/components/verification-report';
import { GAP_THRESHOLD_MS, parseSteps, rowsForPersona } from '@/components/verification-timeline';
/**
 * The web-side readers of harness evidence: the timeline's gap maths and the
 * persona-seed label. They run against the same committed fixture the daemon's
 * verification-run tests use — the evidence shape is the harness's, so the
 * fixture lives with the harness.
 */
import { describe, expect, it } from 'vitest';

const FIXTURE_ROOT = path.resolve(__dirname, '../../daemon/__tests__/fixtures/verification-run');

// The timeline's whole point is that silence is evidence, so the gap maths gets
// its own check against the committed fixture steps.
describe('timeline gap computation', () => {
  it("turns a >=60s hole in a persona's step stream into an explicit gap row", async () => {
    const jsonl = await readFile(
      path.join(FIXTURE_ROOT, 'vrun_fixture/personas/naive-user-2/steps.jsonl'),
      'utf-8',
    );
    const steps = parseSteps(jsonl);
    expect(steps).toHaveLength(12);

    const rows = rowsForPersona('naive-user-2', 0, steps);
    const gaps = rows.filter((r) => r.type === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      type: 'gap',
      persona: 'naive-user-2',
      ms: 90_000,
      afterIndex: 7,
    });
    // The gap row sits where the silence was, not at the end.
    expect(rows.findIndex((r) => r.type === 'gap')).toBe(7);
  });

  it('does not invent gaps for a persona that never went quiet', async () => {
    const jsonl = await readFile(
      path.join(FIXTURE_ROOT, 'vrun_fixture/personas/spec-auditor/steps.jsonl'),
      'utf-8',
    );
    const rows = rowsForPersona('spec-auditor', 1, parseSteps(jsonl));
    expect(rows.filter((r) => r.type === 'gap')).toHaveLength(0);
  });

  it('ignores a hole shorter than the threshold', () => {
    const base = new Date('2026-08-09T14:00:00.000Z').getTime();
    const steps = [0, GAP_THRESHOLD_MS - 1_000].map((offset, i) => ({
      index: i + 1,
      action: 'click',
      detail: '{}',
      url: 'http://localhost/',
      startedAt: new Date(base + offset).toISOString(),
      durationMs: 100,
      screenshot: null,
      error: null,
    }));
    expect(rowsForPersona('p', 0, steps).filter((r) => r.type === 'gap')).toHaveLength(0);
  });
});

// personaSeed is a full descriptive paragraph, not a short id — the persona
// attempts table must not render the whole thing inline (it blows out the
// column layout). Only the derived label is trimmed; the full text still
// goes into the tooltip at the call site.
describe('personaSeedLabel', () => {
  it('passes short seeds through unchanged', () => {
    expect(personaSeedLabel('seed-42')).toBe('seed-42');
    expect(personaSeedLabel('a b c d')).toBe('a b c d');
  });

  it('truncates a multi-sentence paragraph to the first 4 words', () => {
    const seed = 'You are a small-business owner who lives in spreadsheets and hates surprises.';
    expect(personaSeedLabel(seed)).toBe('You are a small-business…');
  });
});
