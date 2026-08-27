/**
 * The model wire for a design turn, behind one injectable seam.
 *
 * Why a seam at all: the daemon's tests must run a full design session without
 * a live subscription, and the existing harness tests already establish that
 * pattern. `setStudioProvider` is that hook — it is the only way a test drives
 * generation, and it is the only place production and test paths differ.
 *
 * ── The tool bridge ─────────────────────────────────────────────────────────
 *
 * The studio map's finding #1: the new agent loop was wired for text but handed
 * an empty `ToolRegistry` with `allowedTools: []`, and bridging its `Tool`
 * interface to the SDK's tool-use blocks "planned as an MCP bridge" was the
 * missing piece. This file is that bridge, and it is deliberately thin: an
 * in-process SDK MCP server whose every handler delegates to
 * `registry.get(name).run(...)`.
 *
 * That gives exactly one implementation of the scoped file tools
 * (`studio/tools.ts`), used identically by both providers:
 *   - the Claude subscription provider reaches them through MCP, so the SDK
 *     drives its own tool round-trips natively (which is what makes multi-file
 *     generation work at all);
 *   - any provider that surfaces `tool_call_batch` items — the test stub, and
 *     any future non-SDK wire — reaches them through the loop's `batchAndRun`.
 *
 * Either way the bytes are written by the same containment-checked code. What
 * must never happen is *both* at once for one call, which is why the Claude
 * provider does not re-emit MCP tool_use blocks as `tool_call_batch`: that
 * would execute every write twice.
 */

import { execFileSync } from 'node:child_process';
import type { ProviderStreamItem, ProviderTurn, ToolRegistry } from '@ligma/core/agent';
import { cachedConfig } from '../engine/config-cache';
import { logger } from '../engine/logger';
import { requireDeclaration, requireTool } from './tools';

/** One reference image, ready to become an image content block. */
export interface StudioImageInput {
  mediaType: string;
  base64: string;
}

/** Everything a provider needs to run one turn. */
export interface StudioTurnRequest {
  systemPrompt: string;
  prompt: string;
  /** Reference images shown with the prompt. Empty/absent for a text turn. */
  images?: StudioImageInput[];
  /** The scoped tools. The provider must execute through this and nothing else. */
  registry: ToolRegistry;
  /** The design's `src/` dir — the model's cwd, and the tools' root. */
  cwd: string;
  signal: AbortSignal;
  /** Model id, when the wire wants one. */
  model: string;
}

export type StudioProvider = (request: StudioTurnRequest) => Promise<ProviderTurn>;

// ─── The seam ────────────────────────────────────────────────────────────────

let provider: StudioProvider | null = null;

/**
 * Install the provider. Tests call this with a stub; nothing else should.
 * Returns the previous provider so a test can restore it.
 */
export function setStudioProvider(next: StudioProvider | null): StudioProvider | null {
  const previous = provider;
  provider = next;
  return previous;
}

export function getStudioProvider(): StudioProvider {
  if (provider) return provider;
  // The one model wire a rehearsal cannot pin through the CLI binary: the SDK
  // speaks its own protocol to `claude`, so a fake binary breaks the stream
  // instead of stubbing it. Off unless asked (acceptance campaign rehearsal).
  return process.env.LIGMA_STUB_STUDIO === '1' ? campaignStubProvider : claudeSubscriptionProvider;
}

// ─── The rehearsal stub (LIGMA_STUB_STUDIO=1) ────────────────────────────────

/** How many generation turns this process has stubbed — makes each turn differ. */
let stubbedTurns = 0;

function stubbedStream(...items: ProviderStreamItem[]): ProviderTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/**
 * A design turn with no model behind it, for `scripts/acceptance` rehearsals.
 *
 * It discriminates on what the registry declares — exactly as the production
 * bridge does — so all three lanes (generate, critique, plan) run their real
 * code: the tools, containment checks, snapshots, SSE frames and the governor
 * gate upstream are untouched. Every artifact it writes says it was stubbed, so
 * nothing it produces can be mistaken for a design a model made.
 */
export const campaignStubProvider: StudioProvider = async (request) => {
  if (request.registry.has('submit_critique')) {
    return stubbedStream(
      { type: 'text', delta: 'LIGMA_STUB_STUDIO: no critic model ran.' },
      {
        type: 'tool_call_batch',
        calls: [
          {
            id: 'stub-critique',
            name: 'submit_critique',
            input: {
              score: 70,
              rules: [{ rule: 'stub', score: 70, note: 'LIGMA_STUB_STUDIO: no critic model ran' }],
            },
          },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    );
  }

  if (request.registry.has('submit_plan')) {
    return stubbedStream(
      {
        type: 'tool_call_batch',
        calls: [
          {
            id: 'stub-plan',
            name: 'submit_plan',
            input: {
              tasks: [
                {
                  title: 'Build the stubbed screen',
                  description: 'LIGMA_STUB_STUDIO: no planning model ran.',
                  acceptanceCriteria: [
                    'A visitor can open the screen',
                    'The screen renders its heading',
                  ],
                  dependsOn: [],
                  designFilePaths: ['index.html'],
                },
              ],
              invariants: ['never claims a stubbed design was reviewed by a model'],
              journeys: [
                { title: 'Open the screen', goal: 'See the screen', steps: ['Open the app'] },
              ],
            },
          },
        ],
      },
      { type: 'done', stopReason: 'stop' },
    );
  }

  stubbedTurns += 1;
  const revision = stubbedTurns;
  return stubbedStream(
    { type: 'text', delta: 'LIGMA_STUB_STUDIO: no generation model ran.' },
    {
      type: 'tool_call_batch',
      calls: [
        {
          id: `stub-write-${revision}`,
          name: 'write_file',
          input: {
            path: 'index.html',
            content: `<h1 class="hero">Stubbed screen (revision ${revision})</h1>\n<p>LIGMA_STUB_STUDIO: this file was written by the campaign rehearsal stub, not by a model.</p>\n<script>const T = /*EDITMODE-BEGIN*/{"accent":"#CC785C"}/*EDITMODE-END*/;</script>\n`,
          },
        },
        {
          id: `stub-write-${revision}b`,
          name: 'write_file',
          input: {
            path: 'detail.html',
            content: `<h1>Stubbed detail screen (revision ${revision})</h1>\n`,
          },
        },
      ],
    },
    { type: 'done', stopReason: 'stop' },
  );
};

// ─── The Claude subscription provider ────────────────────────────────────────

/** The MCP server name; tool names the model sees are `mcp__<server>__<tool>`. */
const MCP_SERVER = 'ligma_studio';

function mcpToolName(name: string): string {
  return `mcp__${MCP_SERVER}__${name}`;
}

/** Narrow shapes of the SDK messages this adapter reads. */
interface SdkBlock {
  type: string;
  text?: string;
  thinking?: string;
}
interface SdkMessage {
  type: string;
  subtype?: string;
  message?: { content?: SdkBlock[] };
  is_error?: boolean;
  result?: string;
}

/**
 * Map an SDK stream to `ProviderStreamItem`s.
 *
 * Tool-use blocks are intentionally NOT mapped to `tool_call_batch`: MCP has
 * already executed them in-process through the registry, and re-emitting them
 * would make the loop run every write a second time. Their observable effect
 * reaches the SSE stream through the registry's own hooks, which is where
 * file-progress comes from.
 */
async function* mapSdkStream(
  stream: AsyncIterable<SdkMessage>,
): AsyncGenerator<ProviderStreamItem> {
  for await (const message of stream) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          yield { type: 'text', delta: block.text };
        } else if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          block.thinking.length > 0
        ) {
          yield { type: 'thinking', delta: block.thinking };
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success' && message.is_error !== true) {
        yield { type: 'done', stopReason: 'stop' };
      } else if (message.subtype === 'error_max_turns') {
        yield { type: 'done', stopReason: 'max_turns' };
      } else {
        yield {
          type: 'done',
          stopReason: 'error',
          error: message.result ?? message.subtype ?? 'unknown SDK error',
        };
      }
      return;
    }
  }
  yield { type: 'done', stopReason: 'stop' };
}

/**
 * Build the in-process MCP server that exposes the registry to the SDK.
 *
 * Each handler is a pass-through to the registry's `run()`, so containment,
 * byte limits and the progress hooks all live in one place. A tool that fails
 * returns `isError` with the registry's message rather than throwing — the
 * model can act on "path escapes the design directory"; it cannot act on a
 * dropped connection.
 */
async function buildMcpServer(
  registry: ToolRegistry,
  signal: AbortSignal,
): Promise<{ server: unknown; allowedTools: string[] }> {
  const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as {
    createSdkMcpServer: (options: { name: string; version: string; tools: unknown[] }) => unknown;
    tool: (
      name: string,
      description: string,
      inputSchema: unknown,
      handler: (
        args: unknown,
      ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
    ) => unknown;
  };

  // Whatever registry it was handed — generation tools or the critic's
  // read-only set — is declared from the same table, so the two lanes cannot
  // drift apart in what the model is told they accept.
  const names = registry.list().map((tool) => tool.name);
  const tools = names.map((name) => {
    const declaration = requireDeclaration(name);
    return sdk.tool(name, declaration.description, declaration.shape, async (args) => {
      const result = await requireTool(registry, name).run(args, { signal });
      const text =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result ?? result.error ?? null);
      return {
        content: [
          { type: 'text' as const, text: result.ok ? text : (result.error ?? 'tool failed') },
        ],
        ...(result.ok ? {} : { isError: true }),
      };
    });
  });

  return {
    server: sdk.createSdkMcpServer({ name: MCP_SERVER, version: '1.0.0', tools }),
    allowedTools: names.map(mcpToolName),
  };
}

/**
 * Find the user's already-signed-in `claude` CLI, once per process.
 *
 * The SDK ships per-platform native binaries that bundlers strip, so both
 * ligma-classic and this daemon point it at the CLI the user already installed
 * and logged in — which is also why ligma never handles an auth token: the
 * subscription session lives in the CLI's own keychain entry, not here.
 *
 * `@ligma/providers` has the same helper, but importing that package pulls its
 * whole source tree into the daemon's typecheck, where it does not currently
 * compile under this app's compiler options. The daemon's configured override
 * is honoured first, so the reuse that matters — one place to point at a
 * non-standard install — is the config, not the lookup.
 */
let cachedClaudePath: string | null | undefined;

function resolveClaudeExecutable(): string | null {
  if (cachedClaudePath !== undefined) return cachedClaudePath;
  const configured = cachedConfig().execution.claudeBinaryPath;
  if (configured) {
    cachedClaudePath = configured;
    return cachedClaudePath;
  }
  try {
    // Static argv, no shell — the same discipline engine/security.ts enforces.
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
      encoding: 'utf-8',
    })
      .split('\n')[0]
      ?.trim();
    cachedClaudePath = found ? found : null;
  } catch {
    cachedClaudePath = null;
  }
  return cachedClaudePath;
}

/**
 * The `prompt` argument for one turn: a plain string, or — when the composer
 * attached reference images — the SDK's streaming-input form.
 *
 * The SDK's `query()` takes `string | AsyncIterable<SDKUserMessage>`, and only
 * the second form can carry content blocks, which is the only way to put an
 * image in front of the model. One message, then the iterable ends, which is
 * what tells the SDK the input is complete. The images go *before* the text so
 * "make it look like this" has a referent by the time it is read.
 *
 * Pure, and exported, because it is the shape of the wire — the wire itself
 * cannot be exercised without spending a real model turn.
 */
export function buildPromptInput(
  prompt: string,
  images: StudioImageInput[] | undefined,
): string | AsyncIterable<unknown> {
  if (!images || images.length === 0) return prompt;
  const content = [
    ...images.map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
    })),
    { type: 'text' as const, text: prompt },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'user' as const,
        message: { role: 'user' as const, content },
        parent_tool_use_id: null,
      };
    },
  };
}

/**
 * Generation over Alex's Claude subscription (build brief §4 principle 9:
 * prefer `claude -p`, never lock him out of his own allocation — the governor
 * gate is upstream of this call, in `session.ts`).
 */
export const claudeSubscriptionProvider: StudioProvider = async (request) => {
  const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as {
    query: (args: {
      prompt: string | AsyncIterable<unknown>;
      options: Record<string, unknown>;
    }) => AsyncIterable<SdkMessage>;
  };

  const claudePath = resolveClaudeExecutable();
  if (claudePath === null) {
    throw new Error(
      'Claude Code CLI not found on PATH. Install it and run `claude` once to sign in — the studio uses the subscription wire, never an API key.',
    );
  }

  const { server, allowedTools } = await buildMcpServer(request.registry, request.signal);
  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener('abort', () => controller.abort(), { once: true });

  logger.info(
    'studio',
    `Generation turn via claude subscription (${allowedTools.length} scoped tools)`,
  );

  const stream = sdk.query({
    prompt: buildPromptInput(request.prompt, request.images),
    options: {
      model: request.model,
      systemPrompt: request.systemPrompt,
      // No user/project settings bleed into a generation turn: the design's
      // instructions are the whole context, and a stray CLAUDE.md would be an
      // invisible input to a supposedly reproducible artifact.
      settingSources: [],
      mcpServers: { [MCP_SERVER]: server },
      allowedTools,
      // Only the scoped MCP tools. The SDK's own Write/Edit/Bash would bypass
      // every containment check in studio/tools.ts.
      disallowedTools: ['Write', 'Edit', 'Read', 'Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      maxTurns: 60,
      cwd: request.cwd,
      abortController: controller,
      pathToClaudeCodeExecutable: claudePath,
    },
  });

  const turn: ProviderTurn = {
    [Symbol.asyncIterator]: () => mapSdkStream(stream)[Symbol.asyncIterator](),
  };
  return turn;
};
