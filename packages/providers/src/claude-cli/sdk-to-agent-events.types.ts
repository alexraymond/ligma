/**
 * Structural mirror of the agent loop's `ToolCall` shape. Declared
 * inside providers/ so the adapter does not take a dependency on
 * @ligma/core (which would be a circular import — core already
 * depends on @ligma/providers).
 *
 * Keep this shape in lockstep with
 * `packages/core/src/agent/tools/index.ts::ToolCall`.
 */

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Structural mirror of `BatchAndRunResult` from
 * `packages/core/src/agent/tools/orchestration.ts`. Used by
 * `adaptSdkStreamToProviderTurn`'s `provideToolResults` callback so
 * the adapter can forward results without taking a circular dep on
 * the core package.
 */
export interface ToolRunOutcome {
  call: ToolCall;
  result: {
    ok: boolean;
    result?: unknown;
    error?: string;
  };
  durationMs: number;
}
