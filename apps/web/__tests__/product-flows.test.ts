import { projectStages } from '@/components/pipeline-strip';
import { type ComposerState, EMPTY_COMPOSER, composerRequest, gateComposer } from '@/lib/composer';
import { type Brief, type DiscoveryForm, isAnswered, missingRequired, openForm } from '@ligma/api';
import type { DesignSummary, Task } from '@ligma/api';
/**
 * The pure decisions behind the product flows: what the composer refuses and
 * why, and which pipeline stages a project actually has.
 *
 * Every one of these is a rule the spec states in prose. Left in a component
 * they would be untestable and would drift; pulled out here they fail loudly.
 *
 * The Deck-widening and spot-check-sampling coverage that used to live here
 * (verdict spot-check sampling determinism/rate, `buildDeckCards`'s full card
 * shapes, the demo-seeded-shapes regression against
 * `apps/daemon/scripts/seed-demo.ts`'s fixture) tested `@/lib/deck-cards`,
 * which is deleted (codebase audit W10, seam S3: the daemon's
 * `routes/deck/deck-cards.ts` is now the single implementation). That
 * coverage has no daemon-side equivalent yet — `apps/daemon/src/routes/deck/
 * deck-cards.test.ts` currently has two tests, both about decision hrefs — so
 * this is a real, unbackfilled coverage loss recorded for lane A (daemon)
 * rather than silently dropped.
 */
import { describe, expect, it } from 'vitest';

const state = (over: Partial<ComposerState> = {}): ComposerState => ({
  ...EMPTY_COMPOSER,
  ...over,
});

describe('kickoff composer gating', () => {
  it('names the prompt when there is nothing to build from', () => {
    const gate = gateComposer(state({ prompt: '   ' }));
    expect(gate.ok).toBe(false);
    expect(gate.missing).toMatch(/^Prompt —/);
  });

  it('opens once the prompt says something', () => {
    expect(gateComposer(state({ prompt: 'A URL shortener' }))).toEqual({ ok: true, missing: null });
  });

  it('names the repo path in adopt mode, and rejects a relative one', () => {
    expect(gateComposer(state({ mode: 'adopt' })).missing).toMatch(/^Repo path —/);
    // A relative path would resolve against the daemon's cwd, not the user's —
    // it would adopt a different directory than the one they meant.
    expect(gateComposer(state({ mode: 'adopt', repoPath: '../thing' })).missing).toMatch(
      /absolute/,
    );
    expect(gateComposer(state({ mode: 'adopt', repoPath: '/Users/a/thing' })).ok).toBe(true);
    expect(gateComposer(state({ mode: 'adopt', repoPath: 'C:\\code\\thing' })).ok).toBe(true);
  });

  it('ignores the prompt in adopt mode and the path in prompt mode', () => {
    expect(gateComposer(state({ mode: 'adopt', prompt: 'ignored', repoPath: '/x' })).ok).toBe(true);
    expect(gateComposer(state({ prompt: 'build me a thing', repoPath: '' })).ok).toBe(true);
  });

  it('routes each mode to its own entrance', () => {
    expect(composerRequest(state({ prompt: ' a thing ', kind: 'CLI tool' }))).toEqual({
      url: '/api/briefs',
      body: { prompt: 'a thing', kind: 'CLI tool' },
    });
    expect(composerRequest(state({ mode: 'adopt', repoPath: ' /x ' }))).toEqual({
      url: '/api/projects/adopt',
      body: { repoPath: '/x' },
    });
  });
});

describe('discovery question forms', () => {
  const form: DiscoveryForm = {
    id: 'frm_1',
    title: 'A few questions',
    description: '',
    questions: [
      {
        id: 'shape',
        label: 'What is this, shaped like?',
        type: 'single',
        options: ['a', 'b'],
        required: true,
        help: '',
      },
      {
        id: 'tags',
        label: 'Which surfaces?',
        type: 'multi',
        options: ['web', 'cli'],
        required: true,
        help: '',
      },
      {
        id: 'notes',
        label: 'Anything else?',
        type: 'textarea',
        options: [],
        required: false,
        help: '',
      },
    ],
  };

  it("names every unanswered required question, in the form's own order", () => {
    expect(missingRequired(form, {})).toEqual(['What is this, shaped like?', 'Which surfaces?']);
    expect(missingRequired(form, { shape: 'a', tags: ['web'] })).toEqual([]);
  });

  it('counts an empty multi-select and a whitespace answer as unanswered', () => {
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(['web'])).toBe(true);
    expect(isAnswered('   ')).toBe(false);
    expect(missingRequired(form, { shape: ' ', tags: [] })).toHaveLength(2);
  });

  it('finds the open form and nothing else', () => {
    const brief = briefWith({
      turns: [
        { form, answers: { shape: 'a', tags: ['web'] }, askedAt: 't', answeredAt: 't' },
        { form: { ...form, id: 'frm_2' }, answers: null, askedAt: 't', answeredAt: null },
      ],
    });
    expect(openForm(brief)?.id).toBe('frm_2');
    expect(openForm(briefWith({}))).toBeNull();
  });
});

describe('pipeline stages', () => {
  // Phase 3: the eleven tabs became four stages (Brief · Studio · Build ·
  // Proof, UX-REDESIGN §11) — references/design-files/notes are drawers now,
  // not stages, and Build/Proof always render (quiet when empty) so the
  // pipeline stays legible.
  it('renders no Brief stage for a project that has none, and Build/Proof always', () => {
    expect(projectStages('p', []).map((s) => s.key)).toEqual(['build', 'proof']);
  });

  it('shows discovery, then locked, then stale on the Brief chip', () => {
    const discovering = briefWith({
      turns: [
        {
          form: { id: 'f', title: 't', description: '', questions: [] },
          answers: null,
          askedAt: 't',
          answeredAt: null,
        },
      ],
    });
    expect(stageChip(projectStages('p', [], { brief: discovering }), 'brief')).toContain(
      'discovery',
    );
    expect(
      stageChip(projectStages('p', [], { brief: briefWith({ status: 'locked' }) }), 'brief'),
    ).toContain('locked');
    expect(
      stageChip(
        projectStages('p', [], { brief: briefWith({ staleFlaggedAt: '2026-08-11T00:00:00Z' }) }),
        'brief',
      ),
    ).toBe('stale');
  });

  it('never renders a Studio stage for a headless project — even with designs', () => {
    const stages = projectStages('p', [], {
      shape: 'headless',
      designs: [design('d')],
      adopted: true,
    });
    expect(stages.some((s) => s.key === 'studio')).toBe(false);
  });

  it('renders the Studio stage for a ui project with no designs at all', () => {
    // Creating the first design happens in the Studio, so a stage you can only
    // reach once you have already used it would be a dead end.
    const stages = projectStages('p', [], { shape: 'ui' });
    expect(stages.find((s) => s.key === 'studio')?.href).toBe('/projects/p/studio');
  });

  it("says 'adopted' where an adopted project has no brief yet", () => {
    const stages = projectStages('p', [], { adopted: true, shape: 'ui' });
    expect(stageChip(stages, 'brief')).toBe('adopted');
  });

  it('withholds the Studio stage until the shape is confirmed', () => {
    // An unconfirmed shape has not said it has a face — same rule the Studio's
    // own `studioVisible` applies, which is why both read one predicate.
    expect(projectStages('p', [], { shape: undefined }).some((s) => s.key === 'studio')).toBe(
      false,
    );
  });

  it('keeps Build and Proof behind the Brief for a locked headless project', () => {
    const task: Task = { id: 't1', kanban: 'in-progress' } as Task;
    const stages = projectStages('p', [task], {
      brief: briefWith({ status: 'locked' }),
      shape: 'headless',
    });
    expect(stages.map((s) => s.key)).toEqual(['brief', 'build', 'proof']);
  });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function briefWith(over: Partial<Brief>): Brief {
  return {
    id: 'brf_1',
    projectId: 'p',
    prompt: 'the ask',
    kind: null,
    shape: null,
    status: 'discovery',
    turns: [],
    constraints: [],
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    lockedAt: null,
    compiledAt: null,
    staleFlaggedAt: null,
    ...over,
  };
}

function design(id: string, status: DesignSummary['status'] = 'critiquing'): DesignSummary {
  return {
    id,
    projectId: 'p1',
    title: 'Landing page',
    status,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    designSystem: null,
    versionCount: 3,
    files: [],
    critiqueScore: 82,
    pendingPinCount: 1,
  };
}

function stageChip(stages: ReturnType<typeof projectStages>, key: string): string | undefined {
  return stages.find((s) => s.key === key)?.chip;
}
