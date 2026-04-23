/**
 * Structural mirror of the agent loop's `ToolCall` shape. Declared
 * inside providers/ so the adapter does not take a dependency on
 * @open-codesign/core (which would be a circular import — core already
 * depends on @open-codesign/providers).
 *
 * Keep this shape in lockstep with
 * `packages/core/src/agent/tools/index.ts::ToolCall`.
 */

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}
