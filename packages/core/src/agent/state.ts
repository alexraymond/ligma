/**
 * Turn-local mutable state carried between iterations of `runTurn`.
 *
 * Kept in one place because the loop's `Continue` transitions (see
 * `loop.ts`) write `state = { ... }` in a single assignment — mirrors
 * the Claude Code pattern in `query.ts`'s `queryLoop`.
 */

export interface TurnState {
  /** Concatenated text the assistant has emitted this turn. Mutated as
   *  text chunks stream in. Returned in `TurnDone.text`. */
  text: string;
  /** Count of tool calls executed this turn (across all batches). */
  toolCalls: number;
  /** Iteration count. Starts at 1. */
  turnCount: number;
  /** Reason the previous loop iteration continued (undefined on the
   *  first iteration). Lets tests assert recovery paths fired without
   *  inspecting message contents. */
  transition: Continue | undefined;
}

export type Continue =
  | { reason: 'tool_results_available'; count: number }
  | { reason: 'retry_after_transient_error'; attempt: number };

export function initialTurnState(): TurnState {
  return {
    text: '',
    toolCalls: 0,
    turnCount: 1,
    transition: undefined,
  };
}
