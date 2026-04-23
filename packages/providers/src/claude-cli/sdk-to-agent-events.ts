/**
 * Adapter: Claude-Agent SDK stream events → W2 agent loop stream.
 *
 * The loop in `@open-codesign/core` consumes `ProviderStreamItem`s,
 * which this file produces from the async-iterable the SDK's `query()`
 * function exposes.
 *
 * Mapping rules (item 8 of the W2 spec):
 *   - `assistant.text` block deltas               → ProviderStreamItem.text
 *   - `assistant.thinking` block deltas           → ProviderStreamItem.thinking
 *   - `assistant.tool_use` blocks (whole message) → one tool_call_batch
 *   - `result` (success/error)                    → done { stopReason }
 *
 * The SDK emits whole assistant messages (not per-token deltas), so
 * the text mapping currently yields one `text` item per assistant
 * message. Finer-grained streaming is a follow-up once the SDK exposes
 * partial-content deltas on a stable type.
 *
 * This module does NOT import from `@open-codesign/core` (avoid
 * circular deps). It only uses structural shapes declared inline. The
 * agent-loop side imports these types through the shared barrel.
 */

import type { ToolCall } from './sdk-to-agent-events.types.js';

export type { ToolCall };

// ---------------------------------------------------------------------------
// ProviderStreamItem mirror (structural — do NOT re-import from core to
// keep this package dependency-free against core).
// ---------------------------------------------------------------------------

export type ProviderStreamItem =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call_batch'; calls: ToolCall[] }
  | {
      type: 'permission_request';
      toolUseId: string;
      toolName: string;
      input: unknown;
      reason: string;
    }
  | { type: 'done'; stopReason: 'stop' | 'max_turns' | 'error'; error?: string };

// ---------------------------------------------------------------------------
// Narrow SDK shapes. We intentionally do NOT import the full SDK types
// here — the subset this adapter touches is tiny and the full module
// drags in @anthropic-ai/sdk types which blow up unrelated compile
// surface. If the SDK changes shape, the adapter's test suite is the
// place that catches it first.
// ---------------------------------------------------------------------------

export interface SdkTextBlock {
  type: 'text';
  text: string;
}

export interface SdkThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface SdkToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type SdkContentBlock =
  | SdkTextBlock
  | SdkThinkingBlock
  | SdkToolUseBlock
  | { type: string; [key: string]: unknown };

export interface SdkAssistantMessage {
  type: 'assistant';
  message: { content: SdkContentBlock[] };
}

export interface SdkResultMessage {
  type: 'result';
  subtype:
    | 'success'
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
    | string;
  is_error?: boolean;
  result?: string;
}

export type SdkStreamMessage =
  | SdkAssistantMessage
  | SdkResultMessage
  | { type: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ToolResultEnvelope {
  toolUseId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AdaptSdkStreamOptions {
  /** Async iterable the SDK's `query()` returns. */
  stream: AsyncIterable<SdkStreamMessage>;
  /** Invoked when the loop has executed a tool batch. Wire-through
   *  callback so downstream transports that require an explicit "post
   *  tool results" hop can do it here. Left undefined when the SDK
   *  drives the follow-up round-trip internally. */
  provideToolResults?: (results: ToolResultEnvelope[]) => Promise<void> | void;
}

/**
 * Wrap an SDK stream in the `ProviderTurn` contract the agent loop
 * consumes. Returns an object that is both the async iterable of
 * `ProviderStreamItem`s AND carries the `provideToolResults` callback.
 */
export function adaptSdkStreamToProviderTurn(
  options: AdaptSdkStreamOptions,
): AsyncIterable<ProviderStreamItem> & {
  provideToolResults?: (results: ToolResultEnvelope[]) => Promise<void> | void;
} {
  const iterable: AsyncIterable<ProviderStreamItem> = {
    [Symbol.asyncIterator]() {
      return iterate(options.stream)[Symbol.asyncIterator]();
    },
  };
  if (options.provideToolResults !== undefined) {
    return Object.assign(iterable, {
      provideToolResults: options.provideToolResults,
    });
  }
  return iterable;
}

async function* iterate(
  stream: AsyncIterable<SdkStreamMessage>,
): AsyncGenerator<ProviderStreamItem, void> {
  for await (const raw of stream) {
    if (isAssistantMessage(raw)) {
      const blocks = raw.message.content;
      const toolCalls: ToolCall[] = [];
      for (const block of blocks) {
        if (isTextBlock(block) && block.text.length > 0) {
          yield { type: 'text', delta: block.text };
        } else if (isThinkingBlock(block) && block.thinking.length > 0) {
          yield { type: 'thinking', delta: block.thinking };
        } else if (isToolUseBlock(block)) {
          toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }
      if (toolCalls.length > 0) {
        yield { type: 'tool_call_batch', calls: toolCalls };
      }
      continue;
    }
    if (isResultMessage(raw)) {
      if (raw.subtype === 'success') {
        yield { type: 'done', stopReason: 'stop' };
        return;
      }
      if (raw.subtype === 'error_max_turns') {
        yield { type: 'done', stopReason: 'max_turns' };
        return;
      }
      const done: ProviderStreamItem = {
        type: 'done',
        stopReason: 'error',
      };
      if (raw.result !== undefined) done.error = raw.result;
      yield done;
      return;
    }
    // System / user / unknown envelopes are not forwarded. Adding a
    // hook here is the seam for follow-ups (e.g. compact_boundary
    // messages that should surface as SessionLog sibling entries).
  }
}

function isAssistantMessage(m: SdkStreamMessage): m is SdkAssistantMessage {
  return (
    m.type === 'assistant' &&
    typeof (m as SdkAssistantMessage).message === 'object' &&
    Array.isArray((m as SdkAssistantMessage).message.content)
  );
}

function isResultMessage(m: SdkStreamMessage): m is SdkResultMessage {
  return m.type === 'result';
}

function isTextBlock(b: SdkContentBlock): b is SdkTextBlock {
  return b.type === 'text' && typeof (b as SdkTextBlock).text === 'string';
}

function isThinkingBlock(b: SdkContentBlock): b is SdkThinkingBlock {
  return b.type === 'thinking' && typeof (b as SdkThinkingBlock).thinking === 'string';
}

function isToolUseBlock(b: SdkContentBlock): b is SdkToolUseBlock {
  return (
    b.type === 'tool_use' &&
    typeof (b as SdkToolUseBlock).id === 'string' &&
    typeof (b as SdkToolUseBlock).name === 'string'
  );
}

// ---------------------------------------------------------------------------
// Replay mapper — item 8 literal: `tool_use blocks → ToolStart+ToolEnd
// pair`. Used for rehydrating a completed transcript from the session
// log (W4) where the tool result is already known. The agent loop does
// NOT use this — it emits ToolStart/ToolEnd itself around real tool
// execution so durations and failures are real.
// ---------------------------------------------------------------------------

export interface ReplayAgentEvent {
  type: 'text_chunk' | 'thinking_chunk' | 'tool_start' | 'tool_end' | 'turn_done';
  [key: string]: unknown;
}

export function assistantMessageToReplayEvents(
  message: SdkAssistantMessage,
  resolvedResults: Map<string, ToolResultEnvelope>,
): ReplayAgentEvent[] {
  const out: ReplayAgentEvent[] = [];
  let seq = 0;
  for (const block of message.message.content) {
    if (isTextBlock(block)) {
      out.push({ type: 'text_chunk', delta: block.text });
    } else if (isThinkingBlock(block)) {
      out.push({ type: 'thinking_chunk', delta: block.thinking });
    } else if (isToolUseBlock(block)) {
      seq += 1;
      out.push({
        type: 'tool_start',
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
        seq,
      });
      const resolved = resolvedResults.get(block.id);
      out.push({
        type: 'tool_end',
        toolUseId: block.id,
        toolName: block.name,
        ok: resolved?.ok ?? false,
        result: resolved?.result,
        error: resolved?.error,
        seq,
        durationMs: 0,
      });
    }
  }
  return out;
}
