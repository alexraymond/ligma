/**
 * W2 — golden-path dispatcher for the `useNewLoop` flag.
 *
 * Routes a `generate()`-shaped request through the async-generator
 * agent loop in `./agent/loop.ts`, backed by the Claude Max
 * subscription (`claude-cli` wire). Produces assistant text streamed
 * live into the renderer's existing `AgentStreamEvent` channel so the
 * UI renders incremental output the same way the pi-agent-core path
 * does today.
 *
 * v1 scope — text streaming only. `runTurn` is handed an empty
 * `ToolRegistry`; the Claude Agent SDK's tool_use blocks reference the
 * SDK's built-in Read/Write/Edit/Bash, which are NOT addressable by
 * the W2 `Tool` interface. v2 will bridge SDK tools via MCP; until
 * then this file proves the plumbing by running `allowedTools: []`
 * end-to-end and translating AgentEvents into `AgentStreamEvent`s.
 *
 * Why this lives in a new file rather than extending `agent.ts`:
 *   - agent.ts is tightly coupled to pi-agent-core; the new loop has
 *     none of that machinery.
 *   - the renderer-event translation is different enough (no
 *     turn_start/message_update equivalents from pi-agent-core) that
 *     forcing both paths through one function would create more
 *     branches than a clean split.
 */

import { adaptSdkStreamToProviderTurn, streamViaClaudeCli } from '@ligma/providers';
import { CodesignError, ERROR_CODES } from '@ligma/shared';
import { ToolRegistry, runTurn } from './agent/index.js';
import type { AgentEvent as NewLoopAgentEvent } from './agent/index.js';
import type { GenerateInput, GenerateOutput } from './index.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';

/**
 * Subset of `AgentStreamEvent` from `apps/desktop/src/preload/index.ts`
 * that `generateViaNewLoop` actually emits. Declared structurally so
 * core doesn't depend on the preload surface. The desktop dispatcher
 * narrows the callback to `AgentStreamEvent` at the call site —
 * compatible because every field here is a subset of the preload
 * contract.
 */
export interface NewLoopStreamEvent {
  type: 'turn_start' | 'text_delta' | 'turn_end' | 'agent_end' | 'error';
  designId: string;
  generationId: string;
  delta?: string;
  finalText?: string;
  message?: string;
  code?: string;
}

export type SendAgentEvent = (event: NewLoopStreamEvent) => void;

/**
 * Minimal ACK tracker surface the new-loop dispatcher needs. The
 * desktop main-process `FsAckTracker` satisfies this structurally
 * without core importing it. v1 never emits fs_updated (no tools run
 * SDK-side), so the tracker is passed through but unused — v2 wires
 * tool-write-backed fs_updated events into the same channel.
 */
export interface NewLoopAckTracker {
  nextSeq(): number;
  wait(seq: number): Promise<void>;
  ack(seq: number): void;
  abort(): void;
}

export interface GenerateViaNewLoopDeps {
  /**
   * Called for every AgentStreamEvent the renderer should observe.
   * Main wires this to `mainWindow.webContents.send('agent:event:v1', ...)`.
   */
  sendAgentEvent: SendAgentEvent;
  /** Optional structured logger — same shape the legacy path uses. */
  logger?: CoreLogger | undefined;
  /**
   * Per-run ACK tracker. Unused in v1 (no SDK-side tool writes), but
   * threaded through so v2 can emit fs_updated + await the ACK
   * without re-plumbing the dispatcher signature.
   */
  ackTracker?: NewLoopAckTracker | undefined;
  /**
   * Optional designId / generationId context — typically baked into
   * the sendAgentEvent closure by main. When omitted, events carry
   * empty strings (useful for unit tests that don't care about
   * routing).
   */
  designId?: string | undefined;
  generationId?: string | undefined;
}

/**
 * Run `input` through the W2 async-generator loop, backed by the
 * Claude Agent SDK via `streamViaClaudeCli`. Emits AgentStreamEvents
 * into `deps.sendAgentEvent` so the existing renderer chat UI
 * displays the streamed text as it arrives.
 *
 * Returns a minimal `GenerateOutput` — the v1 scope is text-only, so
 * `artifacts` is empty and token accounting is zeroed. Tool-based
 * artifact extraction lands in v2 alongside the MCP bridge.
 */
export async function generateViaNewLoop(
  input: GenerateInput,
  deps: GenerateViaNewLoopDeps,
): Promise<GenerateOutput> {
  const log = input.logger ?? deps.logger ?? NOOP_LOGGER;
  const designId = deps.designId ?? '';
  const generationId = deps.generationId ?? '';
  const baseCtx = { designId, generationId } as const;

  if (!input.prompt.trim()) {
    throw new CodesignError('Prompt cannot be empty', ERROR_CODES.INPUT_EMPTY_PROMPT);
  }
  if (input.wire !== 'claude-cli') {
    throw new CodesignError(
      'generateViaNewLoop only supports the claude-cli wire today (v1 scope).',
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  // Touch deps.ackTracker so the unused-symbol lint stays quiet while
  // v1 runs without tools. v2 swaps this for the real ack flow.
  void deps.ackTracker;

  log.info('[generate-new-loop] step=start', {
    provider: input.model.provider,
    modelId: input.model.modelId,
  });

  // Signal the UI that a run started — mirrors the pi-agent-core path's
  // turn_start event. Without this the sidebar stays in its idle state
  // until the first text_delta lands.
  deps.sendAgentEvent({ ...baseCtx, type: 'turn_start' });

  // Build the SDK stream + wrap it in the ProviderTurn shape runTurn
  // wants. Reuse the existing system-prompt-composition + message-
  // flattening in `streamViaClaudeCli` — we just hand it the prompt as
  // a single user turn with the prior history prepended.
  const streamOpts: Parameters<typeof streamViaClaudeCli>[0] = {
    modelId: input.model.modelId,
    messages: [...input.history, { role: 'user', content: input.prompt.trim() }],
    // v1: no tools. v2 populates this from the MCP bridge.
    allowedTools: [],
  };
  if (input.signal !== undefined) streamOpts.signal = input.signal;

  let sdkStream: Awaited<ReturnType<typeof streamViaClaudeCli>>;
  try {
    sdkStream = await streamViaClaudeCli(streamOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('[generate-new-loop] step=start.fail', { message });
    const code = err instanceof CodesignError ? err.code : ERROR_CODES.PROVIDER_ERROR;
    deps.sendAgentEvent({
      ...baseCtx,
      type: 'error',
      message,
      code,
    });
    throw err;
  }

  const provider = adaptSdkStreamToProviderTurn({ stream: sdkStream });
  const tools = new ToolRegistry();

  const runOpts: Parameters<typeof runTurn>[0] = { provider, tools };
  if (input.signal !== undefined) runOpts.signal = input.signal;

  let finalText = '';
  let stopReason: 'stop' | 'aborted' | 'max_turns' | 'error' = 'stop';
  let errorMessage: string | undefined;

  try {
    for await (const event of runTurn(runOpts)) {
      translateEvent(event, baseCtx, deps.sendAgentEvent);
      if (event.type === 'turn_done') {
        finalText = event.text;
        stopReason = event.stopReason;
        errorMessage = event.error;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('[generate-new-loop] step=stream.fail', { message });
    deps.sendAgentEvent({
      ...baseCtx,
      type: 'error',
      message,
      code: err instanceof CodesignError ? err.code : ERROR_CODES.PROVIDER_ERROR,
    });
    deps.sendAgentEvent({ ...baseCtx, type: 'agent_end' });
    throw err;
  }

  if (stopReason === 'error') {
    const msg = errorMessage ?? 'Provider stream ended with an error';
    log.error('[generate-new-loop] step=done.error', { stopReason, message: msg });
    deps.sendAgentEvent({ ...baseCtx, type: 'error', message: msg });
    deps.sendAgentEvent({ ...baseCtx, type: 'agent_end' });
    throw new CodesignError(msg, ERROR_CODES.PROVIDER_ERROR);
  }

  log.info('[generate-new-loop] step=done.ok', { stopReason, textLen: finalText.length });
  deps.sendAgentEvent({ ...baseCtx, type: 'agent_end' });

  return {
    message: finalText,
    artifacts: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

/**
 * Translate one AgentEvent from the W2 loop into the AgentStreamEvent
 * shape the renderer already handles. Unsupported / v2-only events
 * (thinking, tool_*, permission_request) are dropped silently — the
 * renderer tolerates unknown types today (see preload `AgentStreamEvent`
 * docstring) and v1 is text-only anyway.
 */
function translateEvent(
  event: NewLoopAgentEvent,
  baseCtx: { designId: string; generationId: string },
  send: SendAgentEvent,
): void {
  if (event.type === 'text_chunk') {
    send({ ...baseCtx, type: 'text_delta', delta: event.delta });
    return;
  }
  if (event.type === 'turn_done') {
    // Map stopReason into turn_end + (optional) error. agent_end is
    // emitted by the caller after the loop settles so it lands AFTER
    // any trailing error event.
    const mapped = mapStopReason(event.stopReason);
    send({ ...baseCtx, type: 'turn_end', finalText: event.text });
    if (mapped === 'error' && event.error !== undefined) {
      send({ ...baseCtx, type: 'error', message: event.error });
    }
    return;
  }
  // text_delta / turn_end / agent_end cover the v1 renderer contract;
  // every other AgentEvent type is intentionally ignored until v2
  // extends the renderer to display them.
}

function mapStopReason(
  stopReason: 'stop' | 'aborted' | 'max_turns' | 'error',
): 'success' | 'aborted' | 'error' {
  if (stopReason === 'stop') return 'success';
  if (stopReason === 'aborted') return 'aborted';
  return 'error';
}
