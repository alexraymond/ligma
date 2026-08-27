/**
 * @ligma/core — the design brain. Everything between "the user typed a brief"
 * and "an artifact came back".
 *
 * Owns the system-prompt composer (`./prompts`), the builtin skill loader
 * (`./skills`), the agent tool surface (`./tools`, `./agent`), and the two
 * generation entry points: the flat `generate()` / `applyComment()` path and
 * the tool-using `generateViaAgent` / `generateViaNewLoop` loops.
 *
 * Depends on @ligma/providers for transport and @ligma/artifacts for parsing;
 * it never talks to a provider SDK directly.
 */
import { type ArtifactEvent, createArtifactParser } from '@ligma/artifacts';
import type { GenerateResult, ReasoningLevel } from '@ligma/providers';
import {
  type RetryReason,
  complete,
  completeWithRetry,
  filterActive,
  formatSkillsForPrompt,
} from '@ligma/providers';
import type {
  Artifact,
  ChatMessage,
  LoadedSkill,
  ModelRef,
  PermissionCallback,
  SelectedElement,
  StoredDesignSystem,
  WireApi,
  WorkspaceContext,
} from '@ligma/shared';
import { ERROR_CODES, LigmaError } from '@ligma/shared';
import { remapProviderError } from './errors.js';
import {
  type AttachmentContext,
  type ReferenceUrlContext,
  buildContextSections,
  buildPrompt,
  collectAllSkillBlobs,
  imageInputsForWire,
} from './generate-context.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import { type PromptComposeOptions, composeSystemPrompt } from './prompts/index.js';
import { loadBuiltinSkills } from './skills/loader.js';

export type { PromptComposeOptions };
export type { AttachmentContext, ReferenceUrlContext } from './generate-context.js';
export type { CoreLogger } from './logger.js';
export {
  PROVIDER_KEY_HELP_URL,
  remapProviderError,
  rewriteUpstreamMessage,
} from './errors.js';

export { loadAllSkills, loadSkillsFromDir, parseFrontmatter } from './skills/index.js';
export type { LoadAllSkillsOptions, ParsedMd } from './skills/index.js';

export { generateViaAgent } from './agent.js';
export type { AgentEvent, GenerateViaAgentDeps } from './agent.js';
export { generateViaNewLoop } from './generate-via-new-loop.js';
export type {
  GenerateViaNewLoopDeps,
  NewLoopStreamEvent,
  SendAgentEvent,
} from './generate-via-new-loop.js';
export { FRAME_TEMPLATES, type FrameName } from './frames/index.js';
export { DESIGN_SKILLS, type DesignSkillName } from './design-skills/index.js';
export {
  makeTextEditorTool,
  type TextEditorFsCallbacks,
  type TextEditorDetails,
} from './tools/text-editor.js';
export { makeSetTodosTool, type SetTodosDetails } from './tools/set-todos.js';
export { makeListFilesTool, type ListFilesDetails } from './tools/list-files.js';
export { makeReadUrlTool, type ReadUrlDetails } from './tools/read-url.js';
export {
  makeReadDesignSystemTool,
  type ReadDesignSystemDetails,
} from './tools/read-design-system.js';
export {
  makeDoneTool,
  type DoneDetails,
  type DoneError,
  type DoneRuntimeVerifier,
} from './tools/done.js';

export interface GenerateInput {
  prompt: string;
  history: ChatMessage[];
  model: ModelRef;
  apiKey: string;
  /**
   * Optional async getter invoked once per agent turn so OAuth tokens can be
   * refreshed over a long tool-using run. Returns the current bearer token.
   * When omitted, the agent reuses the static `apiKey` captured at request
   * start — fine for providers with long-lived API keys.
   */
  getApiKey?: (() => Promise<string>) | undefined;
  baseUrl?: string | undefined;
  /** v3 wire — when set, pi-ai synthesizes a model for the wire protocol so
   * custom endpoints route correctly even if the provider id is unknown. */
  wire?: WireApi | undefined;
  /** v3 extra HTTP headers merged into the outbound request (gateway auth). */
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  /**
   * Per-call reasoning level override. Typically sourced from
   * `ProviderEntry.reasoningLevel`. When absent, core computes a default
   * via `reasoningForModel`.
   */
  reasoningLevel?: ReasoningLevel | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  /** Override the system prompt entirely. When set, `mode` is ignored. */
  systemPrompt?: string | undefined;
  /**
   * Generation mode for this call. Only `'create'` is supported here.
   * Use `applyComment()` for `'revise'`; `'tweak'` has no public entry point yet.
   */
  mode?: Extract<PromptComposeOptions['mode'], 'create'> | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  logger?: CoreLogger | undefined;
  /**
   * Opt-in to the W2 async-generator agent loop (golden-path beta). When
   * true AND `wire === 'claude-cli'`, the desktop dispatcher routes the
   * request through `generateViaNewLoop` instead of the legacy flat
   * `generate()` path. Default undefined / false keeps every existing
   * caller on the legacy path bit-for-bit.
   *
   * Mirrors `GenerateInputExtensions.useNewLoop` from
   * `./agent/index.ts` so the UI doesn't have to spread-merge a second
   * type just to pass one flag. Kept as the only non-negotiable
   * addition to the monolith `GenerateInput` — every other new field
   * belongs on the sidecar extension interface.
   */
  useNewLoop?: boolean | undefined;
  /**
   * Workspace scoping for SDK-driven providers (currently `claude-cli`).
   * Sets the agent's filesystem cwd + extra read-allowed dirs so Claude's
   * `Read`/`Glob`/`Bash` tools see the user's project, not Ligma's launch dir.
   */
  workspace?: WorkspaceContext | undefined;
  /**
   * Per-request permission hook invoked by SDK providers before each tool
   * call. Allows the host UI to async-prompt the user for allow/deny.
   */
  canUseTool?: PermissionCallback | undefined;
  /**
   * Per-request fidelity preset. Injected into the composed system prompt
   * as a WIREFRAME_PRESET or HI_FIDELITY_PRESET block so this generation
   * commits to a specific visual fidelity.
   */
  fidelity?: 'wireframe' | 'highFidelity' | undefined;
}

export interface ApplyCommentInput {
  html: string;
  comment: string;
  selection: SelectedElement;
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  /** @see GenerateInput.reasoningLevel */
  reasoningLevel?: ReasoningLevel | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  logger?: CoreLogger | undefined;
}

export interface GenerateOutput {
  message: string;
  artifacts: Artifact[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * Non-fatal issues surfaced during this generate call (e.g. builtin skill
   * loader failed). Callers MUST forward these to the UI — this is the
   * "no silent fallbacks" escape hatch for best-effort substeps.
   */
  warnings?: string[];
}

interface Collected {
  text: string;
  artifacts: Artifact[];
}

interface ModelRunInput {
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((info: RetryReason) => void) | undefined;
  messages: ChatMessage[];
  userImages?: Array<{ data: string; mimeType: string }> | undefined;
  logger?: CoreLogger | undefined;
  /** Log step namespace, e.g. 'generate' or 'apply_comment'. Defaults to 'generate'. */
  logScope?: string | undefined;
  workspace?: WorkspaceContext | undefined;
  canUseTool?: PermissionCallback | undefined;
}

function createHtmlArtifact(content: string, index: number): Artifact {
  return {
    id: `design-${index + 1}`,
    type: 'html',
    title: 'Design',
    content,
    designParams: [],
    createdAt: new Date().toISOString(),
  };
}

function collect(events: Iterable<ArtifactEvent>, into: Collected): void {
  for (const ev of events) {
    if (ev.type === 'text') {
      into.text += ev.delta;
    } else if (ev.type === 'artifact:end') {
      const artifact = createHtmlArtifact(ev.fullContent, into.artifacts.length);
      if (ev.identifier) artifact.id = ev.identifier;
      into.artifacts.push(artifact);
    }
  }
}

function stripEmptyFences(text: string): string {
  // Streaming parsers emit ```html and the closing ``` as text deltas around
  // structured artifact events, so the artifact body is consumed but the empty
  // fence shell remains in the chat message. Drop those leftover wrappers.
  return text.replace(/```[a-zA-Z0-9]*\s*```/g, '').trim();
}

function extractHtmlDocument(source: string): string | null {
  const doctypeMatch = source.match(/<!doctype html[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();

  const htmlMatch = source.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();

  return null;
}

// Note: extractFallbackArtifact (prose ```html / bare <html> recovery) was
// removed in the JSX-runtime overhaul. Artifacts now come exclusively from
// the agent's `<artifact>` stream or the text_editor virtual fs; tolerating
// inline source encouraged double-emission and spammed the chat view.
void extractHtmlDocument;

function buildRevisionPrompt(input: ApplyCommentInput, contextSections: string[]): string {
  const parts = [
    'Revise the existing HTML artifact below.',
    'Keep the overall structure, copy, and layout intact unless the user request requires a broader change.',
    'Prioritize the selected element first and avoid unrelated edits.',
    `User request: ${input.comment.trim()}`,
    `Selected element tag: <${input.selection.tag}>`,
    `Selected element selector: ${input.selection.selector}`,
    `Selected element snippet:\n${input.selection.outerHTML || '(empty)'}`,
    `Current full HTML:\n${input.html}`,
  ];
  if (contextSections.length > 0) {
    parts.push(
      'You also have the following supporting context. Use it to preserve brand consistency while applying the requested change.',
    );
    parts.push(contextSections.join('\n\n'));
  }
  parts.push(
    'Return exactly one full updated HTML artifact wrapped in the required <artifact> tag. Do not use Markdown code fences. A short summary outside the artifact is enough.',
  );
  return parts.join('\n\n');
}

async function runModel(input: ModelRunInput): Promise<GenerateOutput> {
  const log = input.logger ?? NOOP_LOGGER;
  const scope = input.logScope ?? 'generate';
  const ctx = {
    provider: input.model.provider,
    modelId: input.model.modelId,
  } as const;

  log.info(`[${scope}] step=send_request`, ctx);
  const sendStart = Date.now();
  let result: GenerateResult;
  let reasoning = input.reasoningLevel ?? reasoningForModel(input.model, input.baseUrl);
  // Self-healing: if the upstream rejects on reasoning mismatch, flip the
  // knob once and retry. Handles new reasoning-mandatory models (and
  // not-supported models) without code changes.
  for (let attempt = 1; ; attempt++) {
    try {
      result = await completeWithRetry(
        input.model,
        input.messages,
        {
          apiKey: input.apiKey,
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(input.wire !== undefined ? { wire: input.wire } : {}),
          ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
          ...(input.userImages !== undefined ? { userImages: input.userImages } : {}),
          ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
          maxTokens: MAX_OUTPUT_TOKENS,
          ...(reasoning !== undefined ? { reasoning } : {}),
          ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
          ...(input.canUseTool !== undefined ? { canUseTool: input.canUseTool } : {}),
        },
        {
          ...(input.onRetry !== undefined ? { onRetry: input.onRetry } : {}),
          logger: log,
          provider: input.model.provider,
        },
        complete,
      );
      break;
    } catch (err) {
      const adjustment = attempt === 1 ? reasoningMismatch(err, reasoning) : null;
      if (adjustment === 'add') {
        log.info(`[${scope}] step=send_request.retry_with_reasoning`, ctx);
        input.onRetry?.({
          attempt,
          totalAttempts: attempt + 1,
          delayMs: 0,
          reason: 'reasoning required by upstream',
        });
        reasoning = 'medium';
        continue;
      }
      if (adjustment === 'drop') {
        log.info(`[${scope}] step=send_request.retry_without_reasoning`, ctx);
        input.onRetry?.({
          attempt,
          totalAttempts: attempt + 1,
          delayMs: 0,
          reason: 'reasoning not supported by upstream',
        });
        reasoning = undefined;
        continue;
      }
      const remapped = remapProviderError(err, input.model.provider);
      log.error(`[${scope}] step=send_request.fail`, {
        ...ctx,
        ms: Date.now() - sendStart,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        status: extractStatus(err),
        code: remapped instanceof LigmaError ? remapped.code : undefined,
      });
      throw remapped;
    }
  }
  log.info(`[${scope}] step=send_request.ok`, { ...ctx, ms: Date.now() - sendStart });

  log.info(`[${scope}] step=parse_response`, ctx);
  const parseStart = Date.now();
  try {
    const parser = createArtifactParser();
    const collected: Collected = { text: '', artifacts: [] };
    collect(parser.feed(result.content), collected);
    collect(parser.flush(), collected);

    log.info(`[${scope}] step=parse_response.ok`, {
      ...ctx,
      ms: Date.now() - parseStart,
      artifacts: collected.artifacts.length,
    });

    return {
      message: stripEmptyFences(collected.text),
      artifacts: collected.artifacts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    };
  } catch (err) {
    log.error(`[${scope}] step=parse_response.fail`, {
      ...ctx,
      ms: Date.now() - parseStart,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    throw err;
  }
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

/** Detect upstream-error messages that indicate a reasoning-knob mismatch.
 *  Phrases vary across upstreams (OpenRouter, Anthropic, OpenAI, Vertex, etc.),
 *  so use broad patterns over a long alternation rather than chasing exact
 *  strings — false positives only cost one extra request, false negatives
 *  surface to the user as an opaque 400. */
const REASONING_REQUIRED_PATTERNS = [
  /reasoning is mandatory/i,
  /reasoning is required/i,
  /requires reasoning/i,
  /thinking is mandatory/i,
  /thinking is required/i,
  /must (?:enable|provide|include) (?:reasoning|thinking)/i,
];
const REASONING_UNSUPPORTED_PATTERNS = [
  /does(?:n't| not) support (?:reasoning|thinking)/i,
  /(?:reasoning|thinking)(?: is)? not supported/i,
  /(?:reasoning|thinking)(?: is)? unsupported/i,
  /unknown (?:parameter|field).*reasoning/i,
  /unexpected (?:parameter|field).*reasoning/i,
  /(?:reasoning|thinking).*not allowed/i,
];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

function reasoningMismatch(
  err: unknown,
  sentReasoning: ReasoningLevel | undefined,
): 'add' | 'drop' | null {
  // Don't gate on extractStatus(err) === 400: pi-ai (and several upstream
  // SDKs) surface the HTTP code as a leading "400 ..." substring in the
  // message rather than as an `err.status` property. The reasoning patterns
  // below are specific enough that a false positive is highly unlikely; the
  // cost of one is a single extra request, while a false negative bubbles up
  // as an opaque PROVIDER_ERROR the user has no path to recover from.
  const msg = errorMessage(err);
  if (sentReasoning === undefined && REASONING_REQUIRED_PATTERNS.some((p) => p.test(msg))) {
    return 'add';
  }
  if (sentReasoning !== undefined && REASONING_UNSUPPORTED_PATTERNS.some((p) => p.test(msg))) {
    return 'drop';
  }
  return null;
}

/**
 * Output-token budget for every generation. Tripled from pi-ai's default
 * (~1/3 of context window, ~10k for Opus 4) to give Claude room for both
 * extended-thinking traces and a full HTML artifact.
 */
const MAX_OUTPUT_TOKENS = 32000;

/** Match Anthropic's Claude 4.x family, which supports extended thinking. */
const CLAUDE_4_MODEL_RE = /claude-(?:opus|sonnet)-4/i;
/** OpenAI reasoning families (o-series and gpt-5). Anchored to the start of
 *  the modelId so a tenant prefix or pass-through path can't sneak through. */
const OPENAI_REASONING_MODEL_RE = /^(?:o1|o3|o4|gpt-5)(?:[-.].*)?$/i;
/** OpenRouter reasoning-mandatory model ids. These endpoints reject requests
 *  that do not declare a reasoning level (HTTP 400), so we MUST send one.
 *  Patterns are anchored to the org-prefix slugs OpenRouter uses; the explicit
 *  `:thinking` suffix covers Anthropic's thinking variants exposed via OR. */
const OPENROUTER_REASONING_MODEL_RE = new RegExp(
  [
    ':thinking$',
    '^anthropic/claude-(?:opus|sonnet)-4',
    '^openai/(?:o1|o3|o4|gpt-5)(?:[-.].*)?$',
    '^minimax/minimax-m\\d',
    '^deepseek/deepseek-r\\d',
    '^qwen/qwq',
  ].join('|'),
  'i',
);

export function reasoningForModel(
  model: ModelRef,
  baseUrl?: string | undefined,
): ReasoningLevel | undefined {
  // Proxy detection: when the provider id is 'anthropic' but baseUrl points
  // somewhere other than api.anthropic.com, we're talking to a Claude Code-
  // style proxy. Those commonly gate reasoning by plan and consumer-tier
  // accepts only 'medium'. Cap defaults at 'medium' so requests don't 400
  // out of the gate; users on higher-tier proxies override via Settings →
  // Reasoning depth.
  const looksLikeAnthropicProxy =
    model.provider === 'anthropic' &&
    baseUrl !== undefined &&
    baseUrl.length > 0 &&
    !/(^|\/\/)api\.anthropic\.com($|[/:])/i.test(baseUrl);

  switch (model.provider) {
    case 'anthropic':
      if (!CLAUDE_4_MODEL_RE.test(model.modelId)) return undefined;
      return looksLikeAnthropicProxy ? 'medium' : 'high';
    case 'openai':
      return OPENAI_REASONING_MODEL_RE.test(model.modelId) ? 'high' : undefined;
    case 'openrouter':
      // OpenRouter rejects reasoning-mandatory endpoints with 400 when no
      // reasoning level is declared. Use 'medium' (not 'high') as the default
      // — pi-ai may translate the knob differently across upstreams, and
      // 'medium' is a safer landing zone for unknown reasoning back-ends.
      return OPENROUTER_REASONING_MODEL_RE.test(model.modelId) ? 'medium' : undefined;
    case 'claude-code-imported':
      // Claude Code proxy endpoints gate reasoning tiers by plan — the
      // consumer-tier endpoint only accepts "medium". Sending "high" (or
      // letting pi-agent-core default up) yields a 400.
      return CLAUDE_4_MODEL_RE.test(model.modelId) ? 'medium' : undefined;
    default:
      return undefined;
  }
}

export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  const log = input.logger ?? NOOP_LOGGER;
  const ctx = {
    provider: input.model.provider,
    modelId: input.model.modelId,
  } as const;

  if (!input.prompt.trim()) {
    throw new LigmaError('Prompt cannot be empty', ERROR_CODES.INPUT_EMPTY_PROMPT);
  }

  // Narrow guard: only 'create' is wired through buildPrompt. Callers passing
  // 'tweak' or 'revise' would silently get wrong output — reject early instead.
  // When systemPrompt is provided the caller owns the full system message, so
  // mode is irrelevant and we skip the guard (the contract says mode is ignored).
  if (!input.systemPrompt && input.mode && input.mode !== 'create') {
    throw new LigmaError(
      'generate() built-in prompt only supports mode "create". Use applyComment() for revise; tweak is not yet wired.',
      ERROR_CODES.INPUT_UNSUPPORTED_MODE,
    );
  }

  log.info('[generate] step=resolve_model', ctx);
  const resolveStart = Date.now();
  // Tier 1: model is already resolved by the caller (no primary/fast fallback
  // here yet). Step exists so logs/UI can show the same name even when the
  // logic later picks between primary/fast.
  log.info('[generate] step=resolve_model.ok', { ...ctx, ms: Date.now() - resolveStart });

  log.info('[generate] step=build_request', ctx);
  const buildStart = Date.now();
  const skillResult = input.systemPrompt
    ? { blobs: [], warnings: [] }
    : await collectAllSkillBlobs(log, input.model.provider);
  const skillBlobs = skillResult.blobs;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        input.systemPrompt ??
        composeSystemPrompt({
          mode: 'create',
          userPrompt: input.prompt,
          ...(skillBlobs.length > 0 ? { skills: skillBlobs } : {}),
          ...(input.fidelity !== undefined ? { fidelity: input.fidelity } : {}),
        }),
    },
    ...input.history,
    { role: 'user', content: buildPrompt(input.prompt, buildContextSections(input)) },
  ];
  log.info('[generate] step=build_request.ok', {
    ...ctx,
    ms: Date.now() - buildStart,
    messages: messages.length,
    skills: skillBlobs.length,
    skillWarnings: skillResult.warnings.length,
  });

  const output = await runModel({
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    wire: input.wire,
    httpHeaders: input.httpHeaders,
    allowKeyless: input.allowKeyless,
    reasoningLevel: input.reasoningLevel,
    signal: input.signal,
    onRetry: input.onRetry,
    messages,
    userImages: imageInputsForWire(input.attachments, input.wire),
    logger: input.logger,
    workspace: input.workspace,
    canUseTool: input.canUseTool,
  });
  return skillResult.warnings.length > 0
    ? { ...output, warnings: [...(output.warnings ?? []), ...skillResult.warnings] }
    : output;
}

export async function applyComment(input: ApplyCommentInput): Promise<GenerateOutput> {
  const log = input.logger ?? NOOP_LOGGER;
  const ctx = {
    provider: input.model.provider,
    modelId: input.model.modelId,
  } as const;

  if (!input.comment.trim()) {
    throw new LigmaError('Comment cannot be empty', ERROR_CODES.INPUT_EMPTY_COMMENT);
  }
  if (!input.html.trim()) {
    throw new LigmaError('Existing HTML cannot be empty', ERROR_CODES.INPUT_EMPTY_HTML);
  }

  log.info('[apply_comment] step=resolve_model', ctx);
  const resolveStart = Date.now();
  log.info('[apply_comment] step=resolve_model.ok', { ...ctx, ms: Date.now() - resolveStart });

  log.info('[apply_comment] step=build_request', ctx);
  const buildStart = Date.now();
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: composeSystemPrompt({
        mode: 'revise',
      }),
    },
    { role: 'user', content: buildRevisionPrompt(input, buildContextSections(input)) },
  ];
  log.info('[apply_comment] step=build_request.ok', {
    ...ctx,
    ms: Date.now() - buildStart,
    messages: messages.length,
  });

  return runModel({
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    wire: input.wire,
    httpHeaders: input.httpHeaders,
    allowKeyless: input.allowKeyless,
    reasoningLevel: input.reasoningLevel,
    signal: input.signal,
    onRetry: input.onRetry,
    messages,
    userImages: imageInputsForWire(input.attachments, input.wire),
    logger: input.logger,
    logScope: 'apply_comment',
  });
}

// ---------------------------------------------------------------------------
// Title generation — small synchronous completion used after the first prompt
// to replace "Untitled design" with a 2-5 word summary. Uses the same provider
// the user already configured so no extra key is needed. Failures bubble as
// LigmaError so the caller can fall back to a simple truncation.
// ---------------------------------------------------------------------------

export interface GenerateTitleInput {
  prompt: string;
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  signal?: AbortSignal | undefined;
  logger?: CoreLogger | undefined;
}

const TITLE_SYSTEM_PROMPT = [
  'You write short titles for UI design projects.',
  'Output ONLY the title — 2 to 5 words, no quotes, no trailing punctuation, no emoji.',
  'Describe WHAT is being designed, not the action verb.',
  'Good: "Fintech pitch deck", "Calm Spaces meditation app", "Mobile onboarding".',
  'Bad: "A presentation for a fintech startup", "Design a slide deck for...".',
].join('\n');

function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/```[a-zA-Z0-9]*\n?|```/g, '')
    .replace(/^[\s'"“”‘’`*#\-•]+|[\s'"“”‘’`*#\-•。、，,.!?！？:：;；]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return '';
  // Guard against models that ignore the length hint and emit a paragraph.
  if (cleaned.length > 40) return `${cleaned.slice(0, 40).trimEnd()}…`;
  return cleaned;
}

export async function generateTitle(input: GenerateTitleInput): Promise<string> {
  const log = input.logger ?? NOOP_LOGGER;
  const trimmed = input.prompt.trim();
  if (trimmed.length === 0) {
    throw new LigmaError(
      'generateTitle requires a non-empty prompt',
      ERROR_CODES.INPUT_EMPTY_PROMPT,
    );
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Summarize this design prompt as a short title:\n\n${trimmed}`,
    },
  ];
  const started = Date.now();
  log.info('[title] step=send_request', {
    provider: input.model.provider,
    modelId: input.model.modelId,
  });
  try {
    const result = await completeWithRetry(
      input.model,
      messages,
      {
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
        ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
        ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        maxTokens: 200,
      },
      {
        logger: log,
        provider: input.model.provider,
      },
    );
    log.info('[title] step=send_request.ok', { ms: Date.now() - started });
    const title = sanitizeTitle(result.content);
    if (title.length === 0) {
      throw new LigmaError('Model returned empty title', ERROR_CODES.PROVIDER_ERROR);
    }
    return title;
  } catch (err) {
    log.error('[title] step=send_request.fail', {
      ms: Date.now() - started,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    throw remapProviderError(err, input.model.provider);
  }
}
