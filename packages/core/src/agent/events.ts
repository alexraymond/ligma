/**
 * Agent event schema — the streaming surface the UI, session log, hooks,
 * and tests all consume independently.
 *
 * Pattern borrowed from Claude Code's SDK core types (TextChunk /
 * ThinkingChunk / ToolStart / ToolEnd / PermissionRequest / TurnDone).
 * Each event carries only the fields its consumer needs so the same
 * stream can feed a progress bar, a structured log writer, and a
 * permission prompt without leaking concerns.
 *
 * Events are serializable. `ToolEnd.error` is a string (not an Error
 * instance) because this payload crosses an IPC boundary on its way to
 * the renderer.
 */

export const AGENT_EVENT_SCHEMA_VERSION = 1 as const;

export interface TextChunk {
  type: 'text_chunk';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  /** Incremental delta of assistant text. Consumers concatenate. */
  delta: string;
}

export interface ThinkingChunk {
  type: 'thinking_chunk';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  /** Incremental delta of assistant thinking/reasoning. */
  delta: string;
}

export interface ToolStart {
  type: 'tool_start';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  /** Provider-issued id correlating ToolStart with its ToolEnd. */
  toolUseId: string;
  toolName: string;
  input: unknown;
  /** Turn-local sequence so the UI can order interleaved tool calls. */
  seq: number;
}

export interface ToolEnd {
  type: 'tool_end';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  toolUseId: string;
  toolName: string;
  ok: boolean;
  /** Free-form tool result (string preferred; objects JSON-stringified by
   *  consumers that need a text view). */
  result?: unknown;
  /** Populated when `ok === false`. Never carries an Error instance. */
  error?: string;
  /** Wall time the tool spent executing, in ms. */
  durationMs: number;
  seq: number;
}

export interface PermissionRequest {
  type: 'permission_request';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  toolUseId: string;
  toolName: string;
  input: unknown;
  /** Human-readable reason a permission check fired (e.g. "write outside
   *  workspace root"). */
  reason: string;
}

export interface TurnDone {
  type: 'turn_done';
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  /** Why the turn ended. `stop` = normal completion, `aborted` =
   *  AbortSignal fired, `max_turns` / `error` map from SDK result events. */
  stopReason: 'stop' | 'aborted' | 'max_turns' | 'error';
  /** Assistant-visible concatenated text for the whole turn. */
  text: string;
  /** Total tool calls executed across all batches. */
  toolCalls: number;
  /** Populated when stopReason === 'error'. */
  error?: string;
}

export type AgentEvent =
  | TextChunk
  | ThinkingChunk
  | ToolStart
  | ToolEnd
  | PermissionRequest
  | TurnDone;

export function isToolEvent(event: AgentEvent): event is ToolStart | ToolEnd {
  return event.type === 'tool_start' || event.type === 'tool_end';
}
