/**
 * Claude Code subscription adapter.
 *
 * Routes generation through @anthropic-ai/claude-agent-sdk, which picks up
 * the locally-logged-in Claude Code session (Keychain on macOS, file on
 * Linux) without needing ANTHROPIC_API_KEY. This is a fork-local feature:
 * upstream rejects the subscription path because Anthropic's ToS restricts
 * claude.ai-auth-driven third-party products.
 *
 * Scope: a single non-streaming completion. Tool-using agent flow lives in
 * packages/core once the MCP bridge is wired up.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, PermissionCallback } from '@ligma/shared';
import { CodesignError, ERROR_CODES } from '@ligma/shared';
import type { GenerateOptions, GenerateResult } from '../index';

/**
 * Shape the SDK's `canUseTool` callback expects. Mirrored inline (not
 * imported) to keep this file's pattern of declaring SDK types locally.
 */
type SdkPermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

type SdkCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  },
) => Promise<SdkPermissionResult>;

/**
 * Adapt Ligma's host-shaped `PermissionCallback` to the SDK's `canUseTool`
 * signature. Mints a stable requestId per tool-call so the host's
 * IPC bridge can correlate responses. A `'deny'` decision is reported back
 * as a tool error (no `interrupt`), so Claude reads the denial and may
 * pivot or report the blockage rather than aborting the turn.
 */
function buildSdkCanUseTool(callback?: PermissionCallback): SdkCanUseTool | undefined {
  if (!callback) return undefined;
  return async (toolName, input, options) => {
    const decision = await callback({
      requestId: randomUUID(),
      toolName,
      input,
      ...(options.blockedPath !== undefined && { blockedPath: options.blockedPath }),
      ...(options.decisionReason !== undefined && { decisionReason: options.decisionReason }),
    });
    if (decision.behavior === 'allow') {
      return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
    }
    return { behavior: 'deny', message: decision.message ?? 'User denied this tool call.' };
  };
}

/**
 * Minimal logger shape used for heartbeat / truncation diagnostics. Matches
 * the `CoreLogger` surface used by packages/core so main can inject its
 * electron-log scope here without an adapter. Peer-shape instead of an
 * import to keep the providers package free of a core dependency.
 */
export interface ClaudeCliLogger {
  warn: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * The SDK ships per-platform native binaries as optional deps, which pnpm +
 * electron-vite bundling strips. Instead of fighting the packaging, point
 * the SDK at the user's already-installed `claude` CLI — the same one the
 * subscription auth lives on.
 *
 * Path resolution happens exactly once per process via `prewarmClaudeExecutable()`
 * which main should call during boot. `completeViaClaudeCli` accepts the
 * resolved path as a parameter so individual requests never pay the
 * `which` syscall.
 *
 * Uses execFile (no shell) so no injection surface even though the argv is
 * static today.
 */
let cachedClaudePath: string | null | undefined;

/**
 * Resolve `claude` via `which` and memoise the result for the process
 * lifetime. Idempotent: safe to call from boot-init or test setup. Returns
 * `null` when the CLI is not on PATH.
 *
 * This is the ONLY function that should ever shell out to `which claude`.
 * `completeViaClaudeCli()` receives the resolved path as an argument.
 */
export function prewarmClaudeExecutable(): string | null {
  if (cachedClaudePath !== undefined) return cachedClaudePath;
  try {
    const raw = execFileSync('which', ['claude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const path = raw.trim().split('\n')[0];
    cachedClaudePath = path && path.length > 0 ? path : null;
  } catch {
    cachedClaudePath = null;
  }
  return cachedClaudePath;
}

/** Test-only helpers to reset the cache. Not part of the public module
 *  surface — callers should go through `prewarmClaudeExecutable()`. */
export const resolveClaudeExecutableForTest = {
  reset(): void {
    cachedClaudePath = undefined;
  },
};

interface SdkAssistantBlock {
  type: string;
  text?: string;
}

interface SdkAssistantEvent {
  type: 'assistant';
  message: { content: SdkAssistantBlock[] };
}

interface SdkResultEvent {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | string;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

type SdkEvent = SdkAssistantEvent | SdkResultEvent | { type: string };

interface SdkUserMessageContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

interface SdkUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | SdkUserMessageContentBlock[];
  };
}

export interface ClaudeCliCompleteOptions {
  modelId: string;
  messages: ChatMessage[];
  userImages?: GenerateOptions['userImages'];
  signal?: AbortSignal;
  maxTokens?: number;
  /**
   * Absolute path to the `claude` CLI, typically resolved once at process
   * boot via `prewarmClaudeExecutable()`. When omitted, this falls back to
   * the process-lifetime cache populated by the same prewarm helper.
   * Omitting the path is supported for test paths and back-compat callers
   * but is NOT the hot-path contract — main should always pass the prewarmed
   * value.
   */
  claudePath?: string | null;
  /**
   * Tool allow-list forwarded to the Agent SDK. Default `[]` keeps the
   * provider as a single non-streaming completion with no tool loop. W2
   * (agent runtime) populates this with whitelisted tool names once the
   * MCP bridge is wired up.
   */
  allowedTools?: string[];
  /**
   * Working directory passed to the SDK. When set, Claude's filesystem
   * tools (Read / Glob / Bash) are rooted here. When omitted, the SDK
   * inherits the host process cwd — `apps/desktop` in dev, the install
   * root in a packaged build — neither of which is what users expect.
   */
  cwd?: string;
  /**
   * Extra absolute paths Claude may read outside `cwd`. Maps to the SDK
   * option of the same name (CLI equivalent: `--add-dir`).
   */
  additionalDirectories?: string[];
  /**
   * Host permission hook. When supplied, every tool call routes through
   * this callback before execution; the host returns allow/deny.
   */
  canUseTool?: PermissionCallback;
  /**
   * Injected for heartbeat + truncation diagnostics. Matches the
   * `CoreLogger.warn` shape; omit in tests that don't care about logs.
   */
  logger?: ClaudeCliLogger;
  /**
   * Heartbeat window (ms). If no SDK event arrives within this many ms, the
   * logger's `warn` is called with `{ sinceLastEventMs }`. Defaults to 5000.
   */
  heartbeatMs?: number;
}

function splitSystemAndTurns(messages: ChatMessage[]): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemParts: string[] = [];
  const turnParts: string[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (content.length === 0) continue;
    if (message.role === 'system') {
      systemParts.push(content);
    } else if (message.role === 'assistant') {
      // Flatten assistant history inline; the SDK agent loop isn't aware of
      // this replay so label it for the model.
      turnParts.push(`[assistant]\n${content}`);
    } else {
      turnParts.push(content);
    }
  }
  return {
    systemPrompt: systemParts.join('\n\n'),
    userPrompt: turnParts.join('\n\n'),
  };
}

async function* buildPromptStream(
  userPrompt: string,
  userImages: GenerateOptions['userImages'],
): AsyncGenerator<SdkUserMessage> {
  const hasImages = (userImages?.length ?? 0) > 0;
  if (!hasImages) {
    yield {
      type: 'user',
      message: { role: 'user', content: userPrompt },
    };
    return;
  }
  const content: SdkUserMessageContentBlock[] = [{ type: 'text', text: userPrompt }];
  for (const image of userImages ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.data },
    });
  }
  yield {
    type: 'user',
    message: { role: 'user', content },
  };
}

const DEFAULT_HEARTBEAT_MS = 5000;

/**
 * Single non-streaming completion via Claude Code subscription. Lazy-imports
 * the SDK so the bundle isn't loaded unless a user actually selects this
 * provider — matches the `complete()` pattern for pi-ai.
 */
export async function completeViaClaudeCli(
  opts: ClaudeCliCompleteOptions,
): Promise<GenerateResult> {
  const { systemPrompt, userPrompt } = splitSystemAndTurns(opts.messages);
  if (userPrompt.length === 0) {
    throw new CodesignError(
      'Claude CLI provider requires at least one non-empty user message.',
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as {
    query: (args: {
      prompt: string | AsyncIterable<SdkUserMessage>;
      options: {
        model?: string;
        systemPrompt?: string | { type: 'preset'; preset: 'claude_code' };
        settingSources?: Array<'user' | 'project' | 'local'>;
        allowedTools?: string[];
        disallowedTools?: string[];
        maxTurns?: number;
        abortController?: AbortController;
        cwd?: string;
        additionalDirectories?: string[];
        canUseTool?: SdkCanUseTool;
        pathToClaudeCodeExecutable?: string;
      };
    }) => AsyncIterable<SdkEvent>;
  };

  // Prefer the caller-supplied path; fall back to the process-lifetime cache
  // from `prewarmClaudeExecutable()`. Never shells out from the hot path.
  const claudePath = opts.claudePath !== undefined ? opts.claudePath : prewarmClaudeExecutable();
  if (claudePath === null) {
    throw new CodesignError(
      'Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` and run `claude` once to sign in.',
      ERROR_CODES.PROVIDER_AUTH_MISSING,
    );
  }

  // The SDK returns its own AbortController shape; the caller's AbortSignal
  // is bridged through a local controller we abort on signal.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  const sdkCanUseTool = buildSdkCanUseTool(opts.canUseTool);

  const textChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let errored: SdkResultEvent | null = null;
  let sawAssistantEvent = false;

  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  let lastEventAt = Date.now();
  // The heartbeat is a Node.js interval timer; we null-check + clear in
  // finally so an early return / throw can't orphan it.
  const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
    const sinceLastEventMs = Date.now() - lastEventAt;
    if (sinceLastEventMs < heartbeatMs) return;
    opts.logger?.warn('claude-cli.stream.heartbeat', {
      sinceLastEventMs,
      modelId: opts.modelId,
    });
  }, heartbeatMs);

  try {
    for await (const event of sdk.query({
      prompt: buildPromptStream(userPrompt, opts.userImages),
      options: {
        model: opts.modelId,
        // Override Claude Code's default system prompt with ours, OR leave
        // empty so only our flattened messages drive behavior.
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : '',
        // Skip CLAUDE.md / settings.json discovery — ligma supplies its own
        // prompt and has no project-root semantics for design work.
        settingSources: [],
        // Tool allow-list is a caller-supplied hand-off. Default `[]` keeps
        // this a single-turn completion; W2 populates it with whitelisted
        // tool names via the MCP bridge.
        allowedTools: opts.allowedTools ?? [],
        // Opus 4.7 with extended thinking burns turn budget on internal
        // reasoning before the final text block lands, and multi-artifact
        // design generations stretch further still. Effective cap is wall
        // time via the caller's AbortSignal — not turn count. Set high.
        maxTurns: 100,
        abortController: controller,
        ...(opts.cwd !== undefined && { cwd: opts.cwd }),
        ...(opts.additionalDirectories !== undefined && {
          additionalDirectories: opts.additionalDirectories,
        }),
        ...(sdkCanUseTool !== undefined && { canUseTool: sdkCanUseTool }),
        pathToClaudeCodeExecutable: claudePath,
      },
    })) {
      lastEventAt = Date.now();
      if (isAssistantEvent(event)) {
        sawAssistantEvent = true;
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            textChunks.push(block.text);
          }
        }
      } else if (isResultEvent(event)) {
        if (event.is_error === true || event.subtype !== 'success') {
          errored = event;
        }
        inputTokens = event.usage?.input_tokens ?? 0;
        outputTokens = event.usage?.output_tokens ?? 0;
        costUsd = event.total_cost_usd ?? 0;
      }
    }
  } finally {
    clearInterval(heartbeat);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }

  if (errored) {
    throw new CodesignError(
      `Claude Code SDK returned ${errored.subtype}${errored.result ? `: ${errored.result}` : ''}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  // Stream-truncation detection. Real completion must deliver at least one
  // assistant event containing text; anything less means the upstream pipe
  // closed early (network blip, SDK subprocess crash, sub2api proxy 502,
  // etc.) — surface it so the caller can retry or report.
  if (!sawAssistantEvent || textChunks.length === 0) {
    throw new CodesignError(
      'Claude Code stream ended with no assistant output.',
      ERROR_CODES.PROVIDER_STREAM_TRUNCATED,
    );
  }

  return {
    content: textChunks.join(''),
    inputTokens,
    outputTokens,
    // Subscription users don't pay per token; surface the SDK-reported
    // figure as a transparency signal, not a billable cost.
    costUsd,
  };
}

function isAssistantEvent(event: SdkEvent): event is SdkAssistantEvent {
  return (
    event.type === 'assistant' &&
    'message' in event &&
    typeof (event as SdkAssistantEvent).message === 'object'
  );
}

function isResultEvent(event: SdkEvent): event is SdkResultEvent {
  return event.type === 'result';
}

// ---------------------------------------------------------------------------
// Raw-stream helper — the W2 agent loop consumes the SDK's async iterable
// directly via `adaptSdkStreamToProviderTurn`, so it needs the unparsed
// stream (not the flattened text+usage shape `completeViaClaudeCli`
// returns). Keep the prewarm / signal / heartbeat / error-code
// discipline from the single-turn completion path so the two codepaths
// behave identically at boundaries.
// ---------------------------------------------------------------------------

/** Minimal shape of one SDK stream message — re-declared here to avoid a
 *  circular re-export with the sdk-to-agent-events adapter. The adapter
 *  narrows this further. */
export interface SdkStreamMessage {
  type: string;
  [key: string]: unknown;
}

export interface ClaudeCliStreamOptions {
  modelId: string;
  messages: ChatMessage[];
  userImages?: GenerateOptions['userImages'];
  signal?: AbortSignal;
  /**
   * Absolute path to the `claude` CLI — same semantics as
   * `ClaudeCliCompleteOptions.claudePath`.
   */
  claudePath?: string | null;
  /**
   * Tool allow-list forwarded to the SDK. W2 v1 runs text-only, so
   * callers typically pass `[]` — no SDK-side tool invocation, text
   * streaming only. v2 (MCP bridge) populates this.
   */
  allowedTools?: string[];
  /** Same semantics as `ClaudeCliCompleteOptions.cwd`. */
  cwd?: string;
  /** Same semantics as `ClaudeCliCompleteOptions.additionalDirectories`. */
  additionalDirectories?: string[];
  /** Same semantics as `ClaudeCliCompleteOptions.canUseTool`. */
  canUseTool?: PermissionCallback;
  /** Same heartbeat contract as `completeViaClaudeCli`. */
  logger?: ClaudeCliLogger;
  /** Heartbeat window (ms). Defaults to 5000. */
  heartbeatMs?: number;
}

/**
 * Stream Claude Agent SDK messages as an `AsyncIterable<SdkStreamMessage>`
 * suitable for the W2 agent loop's `adaptSdkStreamToProviderTurn`
 * adapter. Coexists with `completeViaClaudeCli` — the completion path is
 * still used when the caller just needs a single non-streaming result.
 *
 * The caller owns the iteration; this function only prepares the
 * underlying query + wires heartbeat / abort.
 */
export async function streamViaClaudeCli(
  opts: ClaudeCliStreamOptions,
): Promise<AsyncIterable<SdkStreamMessage>> {
  const { systemPrompt, userPrompt } = splitSystemAndTurns(opts.messages);
  if (userPrompt.length === 0) {
    throw new CodesignError(
      'Claude CLI provider requires at least one non-empty user message.',
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as {
    query: (args: {
      prompt: string | AsyncIterable<SdkUserMessage>;
      options: {
        model?: string;
        systemPrompt?: string | { type: 'preset'; preset: 'claude_code' };
        settingSources?: Array<'user' | 'project' | 'local'>;
        allowedTools?: string[];
        disallowedTools?: string[];
        maxTurns?: number;
        abortController?: AbortController;
        cwd?: string;
        additionalDirectories?: string[];
        canUseTool?: SdkCanUseTool;
        pathToClaudeCodeExecutable?: string;
      };
    }) => AsyncIterable<SdkStreamMessage>;
  };

  const claudePath = opts.claudePath !== undefined ? opts.claudePath : prewarmClaudeExecutable();
  if (claudePath === null) {
    throw new CodesignError(
      'Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` and run `claude` once to sign in.',
      ERROR_CODES.PROVIDER_AUTH_MISSING,
    );
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const sdkCanUseTool = buildSdkCanUseTool(opts.canUseTool);

  const raw = sdk.query({
    prompt: buildPromptStream(userPrompt, opts.userImages),
    options: {
      model: opts.modelId,
      systemPrompt: systemPrompt.length > 0 ? systemPrompt : '',
      settingSources: [],
      allowedTools: opts.allowedTools ?? [],
      maxTurns: 100,
      abortController: controller,
      ...(opts.cwd !== undefined && { cwd: opts.cwd }),
      ...(opts.additionalDirectories !== undefined && {
        additionalDirectories: opts.additionalDirectories,
      }),
      ...(sdkCanUseTool !== undefined && { canUseTool: sdkCanUseTool }),
      pathToClaudeCodeExecutable: claudePath,
    },
  });

  // Wrap the SDK iterable so we can stamp `lastEventAt`, run the
  // heartbeat interval, and clean up the abort listener on completion
  // without leaking them into the caller.
  return {
    [Symbol.asyncIterator](): AsyncIterator<SdkStreamMessage> {
      const inner = raw[Symbol.asyncIterator]();
      let lastEventAt = Date.now();
      const heartbeat = setInterval(() => {
        const sinceLastEventMs = Date.now() - lastEventAt;
        if (sinceLastEventMs < heartbeatMs) return;
        opts.logger?.warn('claude-cli.stream.heartbeat', {
          sinceLastEventMs,
          modelId: opts.modelId,
        });
      }, heartbeatMs);
      if (typeof heartbeat === 'object' && 'unref' in heartbeat) {
        (heartbeat as { unref?: () => void }).unref?.();
      }
      const cleanup = () => {
        clearInterval(heartbeat);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      };
      return {
        async next(): Promise<IteratorResult<SdkStreamMessage>> {
          try {
            const result = await inner.next();
            lastEventAt = Date.now();
            if (result.done === true) cleanup();
            return result;
          } catch (err) {
            cleanup();
            throw err;
          }
        },
        async return(value?: SdkStreamMessage): Promise<IteratorResult<SdkStreamMessage>> {
          cleanup();
          if (typeof inner.return === 'function') return inner.return(value);
          return { done: true, value: undefined as unknown as SdkStreamMessage };
        },
      };
    },
  };
}
