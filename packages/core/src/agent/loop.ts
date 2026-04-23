/**
 * Async-generator agent loop. Replaces the flat `generate()` path with
 * a CC-style streaming turn that yields typed `AgentEvent`s and returns
 * the final `TurnDone`.
 *
 * The loop is provider-agnostic. Callers feed it:
 *   1. A `ProviderTurn` — an async iterable of `ProviderStreamItem`s
 *      the provider adapter produces. `packages/providers/src/
 *      claude-cli/sdk-to-agent-events.ts` is one such adapter.
 *   2. A `ToolRegistry` listing the tools the model is allowed to
 *      invoke. The loop drives execution through
 *      `batchAndRun(..)` whenever the provider surfaces a
 *      `tool_call_batch` item.
 *
 * Semantics (modelled on `~/collection-claude-code-source-code/
 * claude-code-source-code/src/query.ts:219-250`):
 *   - TextChunk and ThinkingChunk pass through verbatim.
 *   - PermissionRequest pass through verbatim (policy is enforced by
 *     the provider / the renderer).
 *   - A tool_call_batch triggers `batchAndRun`. The loop yields
 *     `tool_start` when a call begins, `tool_end` when it resolves.
 *     Results are handed back to the provider via the
 *     `provideToolResults` callback so the adapter can feed the next
 *     turn back into the SDK.
 *   - AbortSignal is honoured: the loop yields `TurnDone` with
 *     stopReason `'aborted'` the moment it observes abort.
 *   - A provider `result` or `done` item ends the turn with the
 *     stopReason carried on that item.
 *
 * The `TurnDone` is BOTH yielded (so streaming consumers don't need a
 * separate "return value" handler) and returned (so callers that
 * `await generator.next().value` get it without iterating twice).
 */

import type {
  AgentEvent,
  PermissionRequest,
  TextChunk,
  ThinkingChunk,
  ToolEnd,
  ToolStart,
  TurnDone,
} from './events.js';
import { AGENT_EVENT_SCHEMA_VERSION } from './events.js';
import { type TurnState, initialTurnState } from './state.js';
import type { ToolCall, ToolRegistry, ToolRunResult } from './tools/index.js';
import { type BatchAndRunResult, batchAndRun } from './tools/orchestration.js';

export type ProviderStreamItem =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | {
      type: 'tool_call_batch';
      calls: ToolCall[];
    }
  | {
      type: 'permission_request';
      toolUseId: string;
      toolName: string;
      input: unknown;
      reason: string;
    }
  | {
      type: 'done';
      stopReason: 'stop' | 'max_turns' | 'error';
      error?: string;
    };

export interface ProviderTurn extends AsyncIterable<ProviderStreamItem> {
  /** Called once the loop has finished executing a tool batch so the
   *  provider can feed results back into the model for the next
   *  round-trip. The provider decides whether the next round-trip is
   *  implicit (same async iterable) or requires a new call.
   *
   *  When the provider drives the round-trip itself (e.g. the Claude
   *  Code SDK's `Query` object which keeps streaming after tool
   *  responses are posted), this can simply forward results into the
   *  same session. */
  provideToolResults?: (results: BatchAndRunResult[]) => Promise<void> | void;
}

export interface RunTurnOptions {
  provider: ProviderTurn;
  tools: ToolRegistry;
  signal?: AbortSignal;
  /** Hard cap on the number of tool batches a single turn may execute.
   *  Stops runaway loops. Default 32. */
  maxToolBatches?: number;
  /** Override the concurrency cap for read-only tool batches. */
  maxToolConcurrency?: number;
}

const DEFAULT_MAX_TOOL_BATCHES = 32;

function textChunk(delta: string): TextChunk {
  return {
    type: 'text_chunk',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    delta,
  };
}

function thinkingChunk(delta: string): ThinkingChunk {
  return {
    type: 'thinking_chunk',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    delta,
  };
}

function permissionRequest(
  toolUseId: string,
  toolName: string,
  input: unknown,
  reason: string,
): PermissionRequest {
  return {
    type: 'permission_request',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    toolUseId,
    toolName,
    input,
    reason,
  };
}

function toolStart(call: ToolCall, seq: number): ToolStart {
  return {
    type: 'tool_start',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    toolUseId: call.id,
    toolName: call.name,
    input: call.input,
    seq,
  };
}

function toolEnd(call: ToolCall, result: ToolRunResult, durationMs: number, seq: number): ToolEnd {
  const base: ToolEnd = {
    type: 'tool_end',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    toolUseId: call.id,
    toolName: call.name,
    ok: result.ok,
    durationMs,
    seq,
  };
  if (result.result !== undefined) base.result = result.result;
  if (result.error !== undefined) base.error = result.error;
  return base;
}

function turnDone(state: TurnState, stopReason: TurnDone['stopReason'], error?: string): TurnDone {
  const done: TurnDone = {
    type: 'turn_done',
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    stopReason,
    text: state.text,
    toolCalls: state.toolCalls,
  };
  if (error !== undefined) done.error = error;
  return done;
}

export async function* runTurn(options: RunTurnOptions): AsyncGenerator<AgentEvent, TurnDone> {
  const state = initialTurnState();
  const signal = options.signal;
  const maxBatches = options.maxToolBatches ?? DEFAULT_MAX_TOOL_BATCHES;
  let batches = 0;
  let seq = 0;

  if (signal?.aborted) {
    const done = turnDone(state, 'aborted');
    yield done;
    return done;
  }

  try {
    for await (const item of options.provider) {
      if (signal?.aborted) {
        const done = turnDone(state, 'aborted');
        yield done;
        return done;
      }
      switch (item.type) {
        case 'text': {
          state.text += item.delta;
          yield textChunk(item.delta);
          break;
        }
        case 'thinking': {
          yield thinkingChunk(item.delta);
          break;
        }
        case 'permission_request': {
          yield permissionRequest(item.toolUseId, item.toolName, item.input, item.reason);
          break;
        }
        case 'tool_call_batch': {
          if (batches >= maxBatches) {
            const done = turnDone(state, 'error', `tool batch cap (${maxBatches}) exceeded`);
            yield done;
            return done;
          }
          batches += 1;
          const perCallSeq = new Map<string, number>();
          for (const call of item.calls) {
            seq += 1;
            yield toolStart(call, seq);
            perCallSeq.set(call.id, seq);
          }

          const runOpts: Parameters<typeof batchAndRun>[2] = {};
          if (signal !== undefined) runOpts.signal = signal;
          if (options.maxToolConcurrency !== undefined) {
            runOpts.maxConcurrency = options.maxToolConcurrency;
          }
          const results = await batchAndRun(item.calls, options.tools, runOpts);
          state.toolCalls += results.length;
          for (const entry of results) {
            const s = perCallSeq.get(entry.call.id) ?? ++seq;
            yield toolEnd(entry.call, entry.result, entry.durationMs, s);
          }
          state.transition = {
            reason: 'tool_results_available',
            count: results.length,
          };
          state.turnCount += 1;
          if (options.provider.provideToolResults) {
            await options.provider.provideToolResults(results);
          }
          break;
        }
        case 'done': {
          const stopReason: TurnDone['stopReason'] = signal?.aborted ? 'aborted' : item.stopReason;
          const done = turnDone(state, stopReason, item.error);
          yield done;
          return done;
        }
      }
    }
    const done = turnDone(state, signal?.aborted ? 'aborted' : 'stop');
    yield done;
    return done;
  } catch (err) {
    if (signal?.aborted) {
      const done = turnDone(state, 'aborted');
      yield done;
      return done;
    }
    const done = turnDone(state, 'error', err instanceof Error ? err.message : String(err));
    yield done;
    return done;
  }
}
