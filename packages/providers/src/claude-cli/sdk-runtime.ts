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
import type { ChatMessage } from '@open-codesign/shared';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type { GenerateOptions, GenerateResult } from '../index';

/**
 * The SDK ships per-platform native binaries as optional deps, which pnpm +
 * electron-vite bundling strips. Instead of fighting the packaging, point
 * the SDK at the user's already-installed `claude` CLI — the same one the
 * subscription auth lives on. Resolved lazily and cached so we only pay the
 * `which` syscall once per process. Uses execFile (no shell) so no
 * injection surface even though the argv is static today.
 */
let cachedClaudePath: string | null | undefined;
function resolveClaudeExecutable(): string | null {
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
        pathToClaudeCodeExecutable?: string;
      };
    }) => AsyncIterable<SdkEvent>;
  };

  const claudePath = resolveClaudeExecutable();
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

  const textChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let errored: SdkResultEvent | null = null;

  try {
    for await (const event of sdk.query({
      prompt: buildPromptStream(userPrompt, opts.userImages),
      options: {
        model: opts.modelId,
        // Override Claude Code's default system prompt with ours, OR leave
        // empty so only our flattened messages drive behavior.
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : '',
        // Skip CLAUDE.md / settings.json discovery — open-codesign supplies
        // its own prompt and has no project-root semantics for design work.
        settingSources: [],
        // No built-in Claude Code tools at this layer. Tool calls live in
        // the agent path once MCP bridging lands.
        allowedTools: [],
        // Opus 4.7 with extended thinking burns turn budget on internal
        // reasoning before the final text block lands, and multi-artifact
        // design generations stretch further still. With `allowedTools: []`
        // no real tool loop can spin up, so the effective cap is wall time
        // via the caller's AbortSignal — not turn count. Set high.
        maxTurns: 100,
        abortController: controller,
        pathToClaudeCodeExecutable: claudePath,
      },
    })) {
      if (isAssistantEvent(event)) {
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
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }

  if (errored) {
    throw new CodesignError(
      `Claude Code SDK returned ${errored.subtype}${errored.result ? `: ${errored.result}` : ''}`,
      ERROR_CODES.PROVIDER_ERROR,
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
