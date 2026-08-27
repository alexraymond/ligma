/**
 * Project shapes — the pipeline adapts to what the project actually is
 * (UX spec §3). Design is a stage, not a gate: a headless project never sees a
 * Studio tab, so the shape is data the whole product reads, not a UI toggle.
 */

/**
 * "artifact" is a project that is not a running program at all — a research
 * paper, a spec, a document repo, a library with no UI. It is verified by
 * reading what it produces, not by driving it (execution-flow review H5).
 */
export const PROJECT_SHAPES = ['ui', 'headless', 'mixed', 'artifact'] as const;

export type ProjectShape = (typeof PROJECT_SHAPES)[number];

export function isProjectShape(value: unknown): value is ProjectShape {
  return typeof value === 'string' && (PROJECT_SHAPES as readonly string[]).includes(value);
}
