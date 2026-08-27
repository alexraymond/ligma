/**
 * What one ESC press does in the full-screen Studio workspace (spec
 * `2026-08-26-studio-fullscreen-workspace-design`, "Leave").
 *
 * ESC walks outward, one layer per press — never two at once, and never
 * straight out of the workspace while something inner is still open. Pure and
 * in its own file because the surface needs a browser and this vitest config is
 * node-only; the chain is the load-bearing part, so it is the part with a test.
 */

export interface StudioEscapeState {
  /** A pin comment is being written — the innermost layer ESC can close. */
  pinDraft: boolean;
  /** Click-to-pin is armed over the focus canvas. */
  commentMode: boolean;
  mode: 'wall' | 'focus';
}

export type StudioEscapeStep = 'close-pin-draft' | 'disarm-pin' | 'leave-focus' | 'exit-studio';

export function studioEscapeStep(state: StudioEscapeState): StudioEscapeStep {
  if (state.pinDraft) return 'close-pin-draft';
  if (state.commentMode) return 'disarm-pin';
  if (state.mode === 'focus') return 'leave-focus';
  return 'exit-studio';
}
