/**
 * Public surface of the new agent subtree.
 *
 * Callers should import from `@open-codesign/core` (the workspace
 * barrel). This file keeps the internal module boundaries clear and is
 * re-exported by `../agent.ts` so the flat `generate()` path and the
 * new loop path coexist without caller regressions.
 */

export {
  AGENT_EVENT_SCHEMA_VERSION,
  isToolEvent,
  type AgentEvent,
  type PermissionRequest,
  type TextChunk,
  type ThinkingChunk,
  type ToolEnd,
  type ToolStart,
  type TurnDone,
} from './events.js';

export {
  initialTurnState,
  type Continue,
  type TurnState,
} from './state.js';

export {
  runTurn,
  type ProviderStreamItem,
  type ProviderTurn,
  type RunTurnOptions,
} from './loop.js';

export {
  ToolRegistry,
  type Tool,
  type ToolCall,
  type ToolRunContext,
  type ToolRunResult,
} from './tools/index.js';

export {
  batchAndRun,
  partitionToolCalls,
  CONCURRENCY_CAP_DEFAULT,
  type BatchAndRunOptions,
  type BatchAndRunResult,
} from './tools/orchestration.js';

export {
  makeFsReadTool,
  type FsReadInput,
  type ReadFile,
} from './tools/fs-read.js';

export {
  makeFsWriteTool,
  type FsWriteInput,
  type WriteFile,
} from './tools/fs-write.js';

// ---------------------------------------------------------------------------
// UI-facing seam. The `GenerateInput` shape in `packages/core/src/index.ts`
// is owned by the monolith and W2 is not allowed to modify it. Instead,
// this sidecar type declares the one new flag the UI needs to opt in to
// the async-generator loop. Callers spread-merge this into their
// existing GenerateInput before invoking the new path:
//
//   const input: GenerateInput & GenerateInputExtensions = { ..., useNewLoop: true };
//
// Default behaviour (`useNewLoop` unset or false) is the flat generate()
// path, which keeps the "Run with new loop (beta)" button opt-in.
// ---------------------------------------------------------------------------

export interface GenerateInputExtensions {
  /** When true, the UI requests the async-generator loop path instead
   *  of the flat `generate()` call. The dispatcher reads this flag on
   *  the same `GenerateInput` object the legacy path uses; leaving it
   *  unset preserves bit-for-bit behaviour. */
  useNewLoop?: boolean;
}
