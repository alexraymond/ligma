/**
 * Pure form logic for the Knowledge page's journey create/edit dialog.
 *
 * Kept separate from journeys-form-dialog.tsx so the shaping rules (steps are
 * trimmed and empties dropped, tags are comma-split) are testable without
 * rendering — the dialog itself is thin wiring on top of this.
 */

export interface JourneyFormState {
  title: string;
  goal: string;
  steps: string[];
  /** Raw comma-separated input, matching the rest of the app's tag fields. */
  tags: string;
}

export interface JourneyPayload {
  title: string;
  goal: string;
  steps: string[];
  tags: string[];
}

export function emptyJourneyForm(): JourneyFormState {
  return { title: '', goal: '', steps: [], tags: '' };
}

export function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Appends a trimmed, non-empty step. Returns the same array if there's nothing to add. */
export function addStep(steps: string[], text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return steps;
  return [...steps, trimmed];
}

export function removeStep(steps: string[], index: number): string[] {
  return steps.filter((_, i) => i !== index);
}

/** True once the two required fields (title, goal) hold something other than whitespace. */
export function isJourneyFormValid(form: JourneyFormState): boolean {
  return form.title.trim() !== '' && form.goal.trim() !== '';
}

/** Shapes form state into the body the daemon's journey routes expect. */
export function buildJourneyPayload(form: JourneyFormState): JourneyPayload {
  return {
    title: form.title.trim(),
    goal: form.goal.trim(),
    steps: form.steps.map((s) => s.trim()).filter(Boolean),
    tags: parseTags(form.tags),
  };
}
