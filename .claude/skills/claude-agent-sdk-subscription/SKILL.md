---
name: claude-agent-sdk-subscription
description: Use when integrating @anthropic-ai/claude-agent-sdk into an app to leverage a user's Claude Max subscription instead of an ANTHROPIC_API_KEY. Trigger words — "Claude Max SDK", "claude subscription auth", "claude -p from code", "claude agent sdk cost", "SDK 65k tokens", "settingSources SDK", "Claude Code login in SDK", "wrap claude CLI in my app", "Anthropic SDK without API key".
allowed-tools: Read, Write, Edit, Bash, Grep
---

# Claude Agent SDK — subscription-auth integration

Non-obvious things that bit us when wrapping `@anthropic-ai/claude-agent-sdk` around
a user's Claude Max plan instead of an API key.

## 1. Subscription auth just works — but the docs bury the line

If the user has run `claude /login` in their terminal once, the SDK picks up the
credentials automatically from the OS keychain (macOS) or filesystem (Linux). No
env var required.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

delete process.env.ANTHROPIC_API_KEY; // prove we're not using a key
for await (const ev of query({ prompt: 'ping', options: { model: 'claude-haiku-4-5', maxTurns: 1 } })) {
  /* works */
}
```

Anthropic's docs say: *"If you have already authenticated Claude Code by running
`claude` in your terminal, the SDK will use that authentication automatically."*
But the same page says: *"Anthropic generally does not permit third-party developers
to offer claude.ai login or rate limits for their products, so API key
authentication is the recommended method."* → fine for local/personal forks,
not for products you ship to others.

## 2. The hidden 65k-token tax (critical)

Out of the box, a one-token reply costs 65k input tokens. Run this first time and
inspect `cache_creation_input_tokens` on the result event — you'll see `~65201`.

**Why:** the SDK's `settingSources` defaults to `['user', 'project', 'local']`,
which loads `CLAUDE.md`, the user's `~/.claude/settings.json`, local project
settings, hooks, etc. On top of that, if `systemPrompt` is unset it used to inject
Claude Code's full prompt (fixed in v0.1.0, but still worth being explicit).

**Fix:** always set both, unless you specifically want Claude Code's context:

```ts
for await (const ev of query({
  prompt: yourPromptStream,
  options: {
    model: 'claude-sonnet-4-6',
    systemPrompt: yourSystemPrompt,        // use your own; or '' for bare
    settingSources: [],                    // do NOT load CLAUDE.md / settings
    allowedTools: [],                      // no built-in Claude Code tools
    maxTurns: 1,
    abortController: new AbortController(),
  },
})) { /* ... */ }
```

After this change, same one-token reply costs ~10 input tokens, not 65k.

## 3. `total_cost_usd` is reported but subscription-meaningless

The SDK still emits a `total_cost_usd` field in the result event — it's the
**would-be** API cost, computed from token counts. On a Max plan the user doesn't
pay per token, so don't surface it as a billable cost. Zero it in your
`GenerateResult` shape or label it as a "reference figure".

## 4. Streaming input needs an async generator

The `prompt` field accepts either a plain string OR an `AsyncIterable` of user
messages. For conversation history / image attachments / follow-up turns you
need the generator form:

```ts
async function* buildPrompt(userText: string, images: Array<{data: string; mimeType: string}>) {
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: images.length === 0
        ? userText
        : [
            { type: 'text' as const, text: userText },
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mimeType, data: img.data },
            })),
          ],
    },
  };
}
```

## 5. AbortSignal bridging pattern

The SDK takes an `AbortController`, not an `AbortSignal`. Bridge the caller's
signal through a local controller:

```ts
const controller = new AbortController();
const onAbort = () => controller.abort();
if (callerSignal) {
  if (callerSignal.aborted) controller.abort();
  else callerSignal.addEventListener('abort', onAbort, { once: true });
}
try {
  for await (const ev of query({ prompt, options: { abortController: controller /*, ...*/ } })) { /* ... */ }
} finally {
  if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
}
```

## 6. Event shapes to handle

Events you actually care about from the async iterable:

- `{ type: 'assistant', message: { content: [{type:'text', text:string} | {type:'tool_use', ...}] } }` — streamed model output per turn.
- `{ type: 'result', subtype: 'success' | 'error_max_turns' | 'error_during_execution', usage, total_cost_usd, is_error }` — single terminal event. Collect usage/cost here.
- `{ type: 'user' }` — your streamed inputs echoed back; usually ignore.
- `{ type: 'system' }` — init event with context; usually ignore.

Treat anything other than `result.subtype === 'success'` as an error; `is_error === true` can flip even inside a `success` subtype in some cases.

## 7. Zod v4 peer warning for custom tools

`createSdkMcpServer` + `tool()` depend on zod v4. If your host app uses zod v3
(common), `pnpm add` will warn about the unmet peer. Workarounds:

- Keep `query()` usage (no custom tools) → no zod needed.
- Add an MCP subprocess (`mcpServers: { myTools: { command: 'node', args: [...] } }`) → isolates zod v4 in the subprocess.
- Install `zod@^4` alongside v3 (risky — duplicate module identity breaks instanceof checks).

## 8. `model` accepts Anthropic aliases

Strings like `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7` work.
Dated ids (`claude-haiku-4-5-20251001`) also work. If a model rejects with
`model_not_found`, try the plain alias first — SDK resolves it upstream.
