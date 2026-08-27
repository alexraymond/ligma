/**
 * `projectStages` — pure, DOM-free, same convention as `studio/api.test.ts`.
 * Covers the new fixed four-stage bar (CONTRACTS-phase3): Brief · Studio ·
 * Build · Proof replace the old strip's many stages plus the sibling tab row.
 * References/Design Files/Notes/Terminal/Runs/Knowledge are gone from here —
 * they're drawers reachable from within a stage now (`stage-panels.tsx`), not
 * stages of their own.
 */
import { describe, expect, it } from 'vitest';
import { projectStages } from './pipeline-strip';

describe('projectStages — Build and Proof always render', () => {
  it('Build and Proof appear even with no tasks, as quiet chips, not hidden', () => {
    const stages = projectStages('proj_1', [], {});
    expect(stages.map((s) => s.key)).toEqual(['build', 'proof']);
    expect(stages.find((s) => s.key === 'build')).toMatchObject({
      chip: 'no tasks',
      state: 'queued',
    });
    expect(stages.find((s) => s.key === 'proof')).toMatchObject({
      chip: 'not proven',
      state: 'queued',
    });
  });

  it("link to the project's own stage routes", () => {
    const stages = projectStages('proj_1', []);
    expect(stages.find((s) => s.key === 'build')?.href).toBe('/projects/proj_1/board');
    expect(stages.find((s) => s.key === 'proof')?.href).toBe('/projects/proj_1/verify');
  });
});

describe('projectStages — Brief', () => {
  it('is absent with no brief and no adoption', () => {
    const stages = projectStages('proj_1', [], {});
    expect(stages.find((s) => s.key === 'brief')).toBeUndefined();
  });

  it('shows a placeholder chip for an adopted project with no brief yet', () => {
    const stages = projectStages('proj_1', [], { adopted: true });
    expect(stages.find((s) => s.key === 'brief')).toMatchObject({
      chip: 'adopted',
      state: 'queued',
    });
  });

  it('fails open on a pipeline fetch error rather than hiding a Brief that may exist', () => {
    const stages = projectStages('proj_1', [], { pipelineError: true });
    expect(stages.find((s) => s.key === 'brief')).toMatchObject({
      chip: 'unknown',
      state: 'queued',
    });
  });

  it('links to the brief route', () => {
    const stages = projectStages('proj_1', [], { adopted: true });
    expect(stages.find((s) => s.key === 'brief')?.href).toBe('/projects/proj_1/brief');
  });
});

describe('projectStages — Studio', () => {
  it('is absent for a headless project', () => {
    const stages = projectStages('proj_1', [], { shape: 'headless' });
    expect(stages.find((s) => s.key === 'studio')).toBeUndefined();
  });

  it('appears for a ui-shaped project, even with zero designs', () => {
    const stages = projectStages('proj_1', [], { shape: 'ui' });
    expect(stages.find((s) => s.key === 'studio')).toMatchObject({
      href: '/projects/proj_1/studio',
      chip: 'none yet',
      state: 'queued',
    });
  });
});
