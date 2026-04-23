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
