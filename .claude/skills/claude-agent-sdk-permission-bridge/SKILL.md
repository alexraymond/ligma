---
name: claude-agent-sdk-permission-bridge
description: Use when wiring the Claude Agent SDK's canUseTool callback into an Electron app (or any host with an out-of-process UI). Covers cwd/additionalDirectories scoping, the host↔SDK callback shape mismatch, and the main↔renderer IPC round-trip pattern with timeout-default-deny.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Bridging Claude Agent SDK permissions to a host UI

When you embed `@anthropic-ai/claude-agent-sdk` in an Electron app (or any host where the UI lives in a different process from the SDK), three things bite that aren't obvious from the docs.

## 1. The sandbox is the host process cwd by default

`sdk.query({ options })` does NOT default `cwd` to anything user-meaningful — it inherits the host process cwd. In Electron dev that's `apps/desktop/`; in a packaged app it's the install root. Claude's `Read` / `Glob` / `Bash` tools are then sandboxed there, even if the user wants the agent working in `/Users/alice/their-repo`.

Fix: thread a per-session `cwd` from your UI down to the SDK call. The shape:

```ts
sdk.query({
  options: {
    cwd: '/Users/alice/their-repo',                 // root for Read/Glob/Bash
    additionalDirectories: ['/etc/config'],          // extra read-allowed dirs
    pathToClaudeCodeExecutable: claudePath,
  },
});
```

`additionalDirectories` is the SDK option name (CLI equivalent: `--add-dir`).

## 2. The SDK's canUseTool shape vs your host shape

The SDK calls back with this signature:

```ts
canUseTool: (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string; blockedPath?: string; ... }
) => Promise<
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }
>
```

Your UI doesn't speak that shape — it wants a `requestId` it can correlate when the user clicks Allow/Deny later. Build an adapter inside your provider wrapper that mints a UUID per call, sends it to the host, and translates the host's reply back to SDK shape:

```ts
import { randomUUID } from 'node:crypto';

function buildSdkCanUseTool(hostCallback?: PermissionCallback): SdkCanUseTool | undefined {
  if (!hostCallback) return undefined;
  return async (toolName, input, options) => {
    const decision = await hostCallback({
      requestId: randomUUID(),     // <- host-side correlation id
      toolName,
      input,
      ...(options.blockedPath !== undefined && { blockedPath: options.blockedPath }),
    });
    if (decision.behavior === 'allow') {
      return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
    }
    return { behavior: 'deny', message: decision.message ?? 'User denied this tool call.' };
  };
}
```

A `'deny'` decision becomes a tool error Claude sees and pivots on — it does NOT abort the turn unless you set `interrupt: true`. That's the right default: the user denying one Read shouldn't kill an entire agent run.

## 3. The IPC round-trip needs a timeout-default-deny + late-drop pattern

In Electron the host callback above runs in main, but the modal lives in renderer. So the callback can't synchronously await user input — it has to:

1. Send `permissions:v1:request` to the renderer with the requestId.
2. Wait for `permissions:v1:respond` with a matching requestId.
3. Auto-deny after a timeout so a torn-down renderer doesn't strand the agent.
4. Silently drop late/duplicate responses for already-resolved ids.

The bridge module (singleton, module-scoped Map):

```ts
const pending = new Map<string, { resolve: (d: PermissionDecision) => void; timer: ReturnType<typeof setTimeout> }>();

export function requestPermission(req, { window, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise<PermissionDecision>((resolve, reject) => {
    if (window.isDestroyed()) return reject(new Error('Window destroyed'));
    const timer = setTimeout(() => {
      pending.delete(req.requestId);
      resolve({ requestId: req.requestId, behavior: 'deny', message: 'auto-denied (timeout)' });
    }, timeoutMs);
    pending.set(req.requestId, { resolve, timer });
    window.webContents.send('permissions:v1:request', req);
  });
}

ipcMain.on('permissions:v1:respond', (_e, decision) => {
  const entry = pending.get(decision.requestId);
  if (!entry) return;            // <- late/duplicate, drop silently
  pending.delete(decision.requestId);
  clearTimeout(entry.timer);
  entry.resolve(decision);
});
```

5-minute timeout is reasonable — matches Claude Code CLI's own permission prompt timeout.

## TypeScript gotchas with `exactOptionalPropertyTypes: true`

When forwarding optional fields to a typed SDK boundary, `field: opts.value` (where `opts.value` is `string | undefined`) gets rejected by `exactOptionalPropertyTypes`. Use conditional spreads:

```ts
const sdkCanUseTool = buildSdkCanUseTool(opts.canUseTool);  // hoist out (TS can't narrow inside spread)
sdk.query({
  options: {
    ...(opts.cwd !== undefined && { cwd: opts.cwd }),
    ...(opts.additionalDirectories !== undefined && {
      additionalDirectories: opts.additionalDirectories,
    }),
    ...(sdkCanUseTool !== undefined && { canUseTool: sdkCanUseTool }),
    pathToClaudeCodeExecutable: claudePath,
  },
});
```

Hoisting the `sdkCanUseTool` call out of the spread is necessary because TypeScript can't follow that the conditional check on `opts.canUseTool` guarantees `buildSdkCanUseTool` returns non-undefined.

## Renderer-side useEffect cleanup gotcha

`ipcRenderer.removeListener(channel, listener)` returns the `IpcRenderer` instance. If your preload's `onRequest` returns `() => ipcRenderer.removeListener(...)`, React's `useEffect` rejects the cleanup function because its return type isn't `void | Destructor`. Wrap in a void-returning arrow:

```ts
return () => {
  ipcRenderer.removeListener('permissions:v1:request', listener);
};
```

## Verifying the wiring

After all this is in place, `canUseTool` only fires when the SDK considers a tool that isn't pre-approved by `allowedTools`, `permissionMode`, or hooks. If your `allowedTools: []` empty-list still pre-approves everything (depends on SDK version), set `permissionMode: 'ask'` or remove the allowedTools key entirely to force every tool through `canUseTool`.

End-to-end smoke test: pick a workspace cwd outside the host's launch dir, ask Claude to `Read` a file there. You should see the modal appear before the read happens. Without the modal firing, your bridge is wired but the SDK is auto-approving — adjust `permissionMode`.
