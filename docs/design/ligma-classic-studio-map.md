# Ligma-classic Studio Map — Phase 3 Port Survey

> **Frozen, and its paths have moved.** This survey was written while the legacy
> desktop app and its packages still sat in this tree. They have since been
> removed — `apps/desktop`, `packages/i18n`, `packages/session`,
> `packages/templates` and `packages/ui` now exist only in the separate
> `ligma-classic` repo. Read every such path below as a path *there*. The port
> this doc informed has shipped; see `docs/architecture.md` for current state.

Read-only survey of the studio code imported from ligma-classic into this monorepo at
`packages/*` and `apps/desktop`. Written to inform the Phase 3 (Studio) port into the
Next.js web app. Source: `docs/ligma-build-brief.md` §6 Phase 3, cross-checked against
`docs/ligma-classic/LIGMA-ARCHITECTURE.md` (which covers the agent-loop half of this
ground at a higher level — this doc adds the Wall/runtime/session/portability half and
corrects one claim from the build brief, see §4).

Scope respected: read-only everywhere except this file. `apps/web`, `apps/daemon`,
`packages/api` untouched (owned by another agent).

---

## 1. `packages/runtime` — the iframe overlay

**Files**: `packages/runtime/src/{index,overlay,tweaks-bridge,iframe-errors}.ts`,
vendored deps in `packages/runtime/vendor/*` (React 18 UMD, ReactDOM UMD, Babel
standalone, `design-canvas.jsx`, `ios-frame.jsx`).

**Package deps**: only `@ligma/shared` (workspace). No Node/Electron/browser-only
globals in the package's own source — see §7.

### Injection (`index.ts`)

- `buildSrcdoc(userSource: string): string` — the main entry point. Strips stray CSP
  `<meta>` tags, then branches three ways:
  1. Already-wrapped srcdoc (contains the `AGENT_BODY_BEGIN` marker) → passthrough.
  2. Legacy full-HTML snapshot (starts with `<!doctype` / `<html`) → passthrough with
     `injectOverlayIntoHtmlDocument` splicing `OVERLAY_SCRIPT` before `</body>`.
  3. Bare JSX artifact → `wrapJsxAsSrcdoc`, which builds a complete HTML document:
     Google Fonts links → reset `<style>` → React/ReactDOM/Babel UMD scripts →
     `TWEAKS_BRIDGE_SETUP` → `ios-frame.jsx` / `design-canvas.jsx` (compiled via
     `type="text/babel"`) → the agent's JSX (wrapped in `AGENT_BODY_BEGIN/END` HTML
     comments) → a script caching the original agent-script text on
     `window.__codesign_tweaks__.originalScript` → `TWEAKS_BRIDGE_LISTENER` →
     `OVERLAY_SCRIPT`.
  - `extractAndUpgradeArtifact(source)` is the sibling used to round-trip-extract an
    agent payload back out of an already-built srcdoc (EDITMODE replace flows).
  - `ensureEditmodeMarkers` (from `@ligma/shared`) auto-recovers a bare
    `const TWEAK_DEFAULTS = {...}` into the canonical
    `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` marker form before embedding, so the
    in-iframe tweaks bridge and the host's `TweakPanel` parser always see the
    canonical shape.

### Click-to-pin comments with live-tracked rects (`overlay.ts`)

- `OVERLAY_SCRIPT` (a big string, `'use strict'` IIFE) is injected into every srcdoc.
  It installs capture-phase listeners re-attached every 200ms (`reattach()` on a
  `setInterval`) as a defence against generated code calling
  `removeEventListener` or stripping handlers ("defence in depth (C11)").
- Modes, set via `SET_MODE` postMessage: `'default' | 'comment' | 'artboard-select' |
  'artboard-move' | 'pan'`. In `'comment'` mode, `onClick` pins the clicked element:
  outlines it (`PINNED_OUTLINE`), computes an XPath-ish selector (`getXPath` — prefers
  `data-codesign-id`, then `#id`, then a positional path), auto-adds the selector to
  `watchedSelectors`, and posts `ELEMENT_SELECTED` with `selector`, `tag`, `outerHTML`
  (≤800 chars), `parentOuterHTML` (≤600 chars, optional v2 enrichment), and `rect`.
- **Live rect tracking**: `watchedSelectors` (set via `WATCH_SELECTORS` postMessage) are
  re-measured on scroll/resize (`scheduleRectsBroadcast`, rAF-debounced) and pushed as
  `ELEMENT_RECTS` (`{selector, rect}[]`, capped at `MAX_ELEMENT_RECTS_ENTRIES = 256`).
  This is what keeps a pin glued to its element as the iframe content scrolls/resizes —
  the host never re-measures itself, it trusts the overlay's stream.
- Also handles: canvas-size broadcast (`CANVAS_SIZE`, via `MutationObserver` +
  `scrollWidth/Height`, dedup'd by `lastCanvasW/H`), artboard select/move
  (`ARTBOARD_SELECTED`, `ARTBOARD_MOVED`, `APPLY_ARTBOARD_OFFSETS`,
  `RESET_ARTBOARD_OFFSETS`, direct-DOM `translate3d` offsets keyed by
  `data-label`), canvas pan forwarding (`CANVAS_PAN_WHEEL`, `CANVAS_PAN_DRAG` — iframes
  are separate browsing contexts so wheel/drag never reaches the parent's
  `overflow:auto` container without this forwarding), link/navigation neutralising
  (`window.open`/`prompt`/`alert`/`confirm`/`location.*` all no-op'd — Electron disables
  these in iframes and generated code calling them would otherwise break), and iframe
  error reporting (`window.onerror` / `unhandledrejection` → `IFRAME_ERROR`).
- **Trust boundary**: `onParentMessage` only accepts `ev.source === window.parent` and
  `data.__codesign === true` — rejects synthesized in-iframe messages.

### Three-state pin visual (note / pending / applied)

Defined in the *host* (`apps/desktop`), not in the runtime package — see §2. Runtime
only emits the raw selection/rect events; the pin color/state logic lives in
`PinOverlay.tsx`.

### EDITMODE tweaks bridge (`tweaks-bridge.ts`)

- `TWEAKS_BRIDGE_SETUP` — intercepts `ReactDOM.createRoot` so the first call is cached
  on `window.__codesign_tweaks__.root`; subsequent calls return the same root (so a
  later re-eval reconciles into the existing tree instead of remounting).
- `TWEAKS_BRIDGE_LISTENER` — listens for `{type: 'codesign:tweaks:update', tokens}`
  postMessages. On receipt: regex-replaces the `/*EDITMODE-BEGIN*/…/*EDITMODE-END*/`
  block in the cached `originalScript` with `JSON.stringify(tokens)`, recompiles via
  `window.Babel.transform(..., {presets:['react']})`, and re-executes via
  `new Function('React','ReactDOM', compiled)(...)`. Because `createRoot` is
  intercepted, the agent's own `createRoot(...).render(<App/>)` call inside the
  re-eval becomes an in-place re-render — React's reconciler diffs and patches the DOM,
  no full srcdoc reload (~300-500ms blank flash avoided).
- Agent-side declaration of *which* control each token gets:
  `packages/core/src/tools/declare-tweak-schema.ts` exports
  `makeDeclareTweakSchemaTool(fs: TextEditorFsCallbacks): AgentTool<...>` — a
  `declare_tweak_schema` tool the agent calls after writing `TWEAK_DEFAULTS`. It writes
  a parallel `/*TWEAK-SCHEMA-BEGIN*/{...}/*TWEAK-SCHEMA-END*/` block (validated via
  `parseTweakSchema`/`replaceTweakSchema` in `@ligma/shared`) declaring per-token
  `{kind: 'color'|'number'|'enum'|'boolean'|'string', min, max, step, unit, options,
  placeholder}`. This is *advisory* — the host's `TweakPanel`
  (`apps/desktop/src/renderer/src/components/TweakPanel.tsx`) falls back to a
  value-shape heuristic for any token missing from the schema, and renders precise
  sliders/color-pickers/enums for tokens that have one.

### postMessage protocol — both directions

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| host → iframe | `SET_MODE` | `{mode}` | switch interaction mode |
| host → iframe | `APPLY_ARTBOARD_OFFSETS` | `{offsets: Record<label,{x,y}>}` | persist artboard drag positions |
| host → iframe | `RESET_ARTBOARD_OFFSETS` | `{}` | clear all offsets |
| host → iframe | `CLEAR_PIN` | `{}` | un-pin current element |
| host → iframe | `WATCH_SELECTORS` | `{selectors: string[]}` | start live rect tracking |
| host → iframe | `codesign:tweaks:update` | `{tokens}` | live EDITMODE token update (no `__codesign` envelope — separate protocol) |
| iframe → host | `ELEMENT_SELECTED` | `{selector, tag, outerHTML, parentOuterHTML?, rect}` | click-to-pin result |
| iframe → host | `ELEMENT_RECTS` | `{entries: {selector, rect}[]}` | live rect stream for watched selectors |
| iframe → host | `CANVAS_SIZE` | `{width, height}` | natural content size for zoom/scale |
| iframe → host | `ARTBOARD_SELECTED` | `{label, viewport, outerHTML, rect}` | artboard-select mode click |
| iframe → host | `ARTBOARD_MOVED` | `{label, x, y}` | artboard drag committed |
| iframe → host | `CANVAS_PAN_WHEEL` | `{deltaX, deltaY, ctrlKey?, metaKey?}` | wheel forwarded for parent to pan/zoom |
| iframe → host | `CANVAS_PAN_DRAG` | `{dx, dy}` | drag forwarded for parent to pan |
| iframe → host | `IFRAME_ERROR` | `{kind, message, source?, lineno?, colno?, stack?, timestamp}` | uncaught error/rejection |

All `__codesign`-envelope messages have runtime type guards exported alongside their
interfaces (`isOverlayMessage`, `isElementRectsMessage`, `isCanvasSizeMessage`,
`isArtboardSelectedMessage`, `isArtboardMovedMessage`, `isCanvasPanWheelMessage`,
`isCanvasPanDragMessage`, `isIframeErrorMessage`).

---

## 2. The Wall canvas (`apps/desktop`)

**Key files**:
- `apps/desktop/src/renderer/src/components/canvas/CanvasWall.tsx` — the card grid,
  the click-vs-drag gesture state machine, drag-reorder.
- `apps/desktop/src/renderer/src/components/canvas/CanvasViewport.tsx` — pan/zoom
  wrapper.
- `apps/desktop/src/renderer/src/components/PreviewPane.tsx` — the iframe pool,
  focus-mode single-preview rendering, pin overlay wiring.
- `apps/desktop/src/renderer/src/components/comment/PinOverlay.tsx` — three-state pin
  visual.
- `apps/desktop/src/renderer/src/components/chat/CommentChipBar.tsx` — pending-edit
  chip row + batch apply.
- `apps/desktop/src/renderer/src/hooks/useAgentStream.ts` — progressive throttled
  rendering.

### Pannable/zoomable grid

`CanvasViewport` (exported component, no other exports) wraps its children in a
`overflow-auto` div (`data-canvas-viewport` attribute — this is the hook the runtime
overlay's forwarded `CANVAS_PAN_*` messages and `CanvasWall`'s own gesture code both
look up via `closest()`). Zoom: `MIN_ZOOM=25`, `MAX_ZOOM=400`, `clampZoom()`,
Cmd/Ctrl+wheel steps ±5, stored in the Zustand store's `previewZoom`. Pan:
Space+drag or middle-click drag, tracked via `panning` ref and
`setPointerCapture`/`scrollLeft`/`scrollTop`. `CanvasWall` is rendered inside this
same viewport (`<CanvasViewport><CanvasWall/></CanvasViewport>` in `PreviewPane.tsx`).

### Per-card "writing…" pulses

`WallCard`'s `writing: boolean` prop (from `CanvasWall`, derived by comparing the
store's `agentWritingFile` to `{designId, path}`) renders a pill badge
(`"writing…"` + `animate-pulse` dot) top-right of the card, `pointer-events: none`.

### Comment badges

`CanvasWall` builds `commentsByFile: Map<path, count>` once per render by joining
`comments` (flat list, keyed by `snapshotId`) through `snapshotsByDesign` (snapshot →
`filePath`) — O(snapshots + comments). `WallCard`'s `commentCount` prop renders a
pill with a `MessageSquare` icon when > 0.

### Drag-reorder — extracted click-vs-drag state machine

`CanvasWall.tsx` exports this as pure, DOM-free functions specifically so it's
testable without jsdom (see `CanvasWall.gesture.test.ts`):

```ts
export interface GestureState { startX, startY, scrollLeft0, scrollTop0, additive, isDrag }
export function startGesture(input: PointerDownInput): GestureState
export function processGestureMove(state, clientX, clientY): PointerMoveResult
export function processGestureUp(state): PointerUpEffect  // {kind:'click',additive} | {kind:'pan'}
```

Threshold: `DRAG_THRESHOLD_PX = 5` (pointer must move >5px before a card-click gesture
is reclassified as a canvas pan — the component maps real `PointerEvent`s onto these
calls and applies the returned scroll deltas to the ancestor `[data-canvas-viewport]`
element). Also exported: `extractScreenTitle(source)` — pulls a model-supplied
`data-screen-title` attribute or `<meta name="ligma:screen-title">` tag out of the raw
HTML string via regex, for the card header title, with filename fallback.

Separately, card **reorder** (dragging the grip handle to reposition a card in the
file list) is a second, simpler pointer-tracking flow: `onReorderStart` sets React
state (`draggingPath`, `dropTargetPath`, cursor position), a document-level
`pointermove`/`pointerup` listener hit-tests `document.elementFromPoint(...).closest
('[data-wall-card-path]')` to find the drop target, and on pointerup calls
`reorderWallCards(designId, draggingPath, dropTargetPath)` (a store action).

### Progressive throttled rendering (~250ms cadence)

`apps/desktop/src/renderer/src/hooks/useAgentStream.ts`, `FS_THROTTLE_MS = 250`.
Two independent throttle slots:
- `fsThrottle` (single slot) — coalesces the live single-file preview
  (`setPreviewHtmlFromAgent`) so a flurry of `str_replace` tool events (10+/turn is
  normal) doesn't strobe the iframe's full srcdoc reload.
- `wallThrottles` (a `Map<designId::path, slot>`) — per-file throttling for the Wall
  grid, since a multi-file generation writes to 5+ files in parallel and each card's
  iframe reloads on `srcDoc` change.
Both use the same pattern: schedule immediately if `Date.now() - lastFlushAt >=
250ms`, otherwise arm a `setTimeout` for the remaining window with guaranteed
trailing-edge flush (never drops the final state).

### The iframe pool (instant design switching)

`PreviewPane.tsx`, `PreviewSlot` component + `poolEntries` memo (lines ~285-380,
~723-746). One `<iframe sandbox="allow-scripts">` per pool entry (active design +
recently-visited designs from the store's `recentDesignIds`, LRU-bounded store-side),
kept mounted and toggled via CSS visibility rather than unmounted — "the whole point
of the pool" per its docstring, because a fresh iframe means re-parsing HTML,
re-executing scripts, and a re-layout. `srcDocStableKey` (via
`stablePreviewSourceKey(html)`) is a separate memo key from `html` itself, so
token-only EDITMODE tweaks (which go through the postMessage bridge, §1) don't force
`buildSrcdoc` to rebuild and remount the iframe document. Only the active slot
receives `SET_MODE` postMessages (`registerIframe`/`onIframeLoaded` callbacks scope
this) so background pool iframes don't get redirected into comment mode.

### Device-frame focus mode

"Focus mode" = viewing a single file/design full-size instead of the Wall grid
(toggled via `openCanvasFileTab` / tab switch in `PreviewPane.tsx`). Two rendering
paths inside `PreviewSlot`:
- **Natural canvas** (desktop viewport with a `CANVAS_SIZE` message received): sizes
  the iframe to its reported natural `scrollWidth/Height` and applies zoom via CSS
  `transform: scale()`, letting the parent `CanvasViewport`'s native
  `overflow:auto` provide trackpad pan over the overflow — no forced Space+drag.
- **Device-frame sizing** (mobile/tablet viewports): fixed device dimensions, no
  natural-size negotiation.
`WallCard`'s own thumbnail rendering (in the grid) always scales a fixed
`NATURAL_WIDTH×NATURAL_HEIGHT` (1440×960) canvas down to `CARD_WIDTH×CARD_HEIGHT`
(360×240) via `transform: scale()`, with `pointer-events: none` and a
`THUMBNAIL_STYLE` `<style>` block injected to kill animations/scrollbars/video for
cheap, static thumbnails.

---

## 3. `packages/session` — JSONL + content-addressed snapshots

**Files**: `packages/session/src/{schema,writer,reader,resume,paths,logger,index}.ts`.
Deps: `zod` only (plus Node built-ins `node:fs/promises`, `node:crypto`, `node:os`,
`node:path`). No Electron dependency.

### Storage layout (`paths.ts`)

```
~/.config/ligma/sessions/<sessionId>/
  transcript.jsonl        # append-only, one JSON object per line
  files/<fingerprint>     # content-addressed blobs
```

`resolveSessionPaths(override?: {rootDir?})` returns `{rootDir, sessionsDir,
sessionDir(id), transcriptPath(id), filesDir(id), blobPath(id, fingerprint)}`.
Session ids and fingerprints are validated against `/^[A-Za-z0-9_-]+$/` before being
used in a path (defends against traversal via IPC-supplied values).

### Content-addressing — confirmed, and exactly how

**Confirmed**: `SessionWriter.materialize()` in `writer.ts`, for a
`file_history_snapshot` entry, computes `fingerprint = contentFingerprint(body)` where
`contentFingerprint = createHash('sha256').update(body).digest('hex')` (64 hex chars).
The blob is written to `files/<fingerprint>` via `writeBlobIfNew`, which opens with
the `'wx'` flag (fails if the file exists) so identical bodies across turns collapse
to one blob — dedupe is free and idempotent. A code comment in `writer.ts` explicitly
rejects using `@ligma/shared`'s `computeFingerprint` (FNV-1a, 8 hex chars) for this
purpose: it's designed for error-stack bucketing and hits 50% birthday-collision
probability around 65K versions, unsafe for content-addressed storage.

### APIs

- `SessionWriter` (`writer.ts`): `new SessionWriter({sessionId, logger, paths?,
  onFsync?})`; `append(input: SessionEntryInput, {fileBody?}): Promise<{id,
  timestamp, fingerprint?}>`. Concurrent appends serialize through an internal promise
  chain. **fsync discipline**: only `turn_done` and `custom_title` entries trigger an
  `fsync` before resolving (turn-boundary commit); everything else is append-only and
  relies on the OS page cache, so a crash between turn boundaries loses at most the
  trailing in-flight batch. Also exports `ensureSessionDir(sessionId, override?)`.
- `SessionReader` (`reader.ts`): `new SessionReader({sessionId, logger?, paths?})`;
  `fetchLatest(limit): Promise<HistoryPage>`, `fetchOlder(beforeId, limit):
  Promise<HistoryPage>` (cursor pagination, mirrors Claude Code's `before_id`
  pattern), `readAll(): Promise<SessionEntry[]>` (drops/logs a truncated final line
  rather than failing the whole read).
- `resumeSession({sessionId, logger?, paths?}): Promise<ResumedSession>` (`resume.ts`)
  — replays the full transcript, applies last-wins for `CustomTitle` and
  `FileHistorySnapshot` (keyed by `path`), returns `{sessionId, title, fileSnapshots:
  Map<path, FileHistorySnapshot>, transcript, toolUses, turns, entryCount}`.
- Schema (`schema.ts`, zod): discriminated union `SessionEntry = TranscriptMessage |
  FileHistorySnapshot | CustomTitle | ToolUseSummary | TurnDone`, all carrying
  `schemaVersion: 1`. `FileHistorySnapshot = {path, fingerprint, byteSize, author?}`
  is the content-addressed entry type; `SessionEntryInput` omits writer-derived fields
  (`id`, `sessionId`, `timestamp`, and for snapshots, `fingerprint`/`byteSize`).

### IPC wiring

`apps/desktop/src/main/session-ipc.ts` — thin IPC layer over the above (one
`SessionWriter` per `sessionId`, memoized in a `Map`). Used for the **agent
transcript/file-history log**, driven from the main process.

### Important distinction for the version rail (see §4/§7)

`packages/session`'s content-addressed blob store is **not** what currently backs the
Wall's per-design snapshot history in `apps/desktop`. That's a separate system: see §4.

---

## 4. The "new agent loop" — `packages/core/src/agent/*`

**Files**: `packages/core/src/agent/{index,loop,events,state}.ts`,
`packages/core/src/agent/tools/{index,orchestration,fs-read,fs-write}.ts`, wired via
`packages/core/src/generate-via-new-loop.ts`.

### What exists

- `runTurn(options: RunTurnOptions): AsyncGenerator<AgentEvent, TurnDone>`
  (`loop.ts`) — a provider-agnostic async-generator turn driver. Consumes a
  `ProviderTurn` (`AsyncIterable<ProviderStreamItem>` +
  optional `provideToolResults(results)`), yields `text_chunk` / `thinking_chunk` /
  `permission_request` / `tool_start` / `tool_end`, ends with `turn_done`. Honours
  `AbortSignal`, caps tool batches (`maxToolBatches`, default 32).
- `AgentEvent` union (`events.ts`): `TextChunk | ThinkingChunk | ToolStart | ToolEnd |
  PermissionRequest | TurnDone`, all versioned via `AGENT_EVENT_SCHEMA_VERSION = 1`,
  fully serializable (errors are strings, never `Error` instances — built to cross an
  IPC boundary).
- `ToolRegistry`, `Tool` interface (`tools/index.ts`) — deliberately minimal:
  `{name, isConcurrencySafe(input), run(input, ctx): Promise<ToolRunResult>}`.
- `batchAndRun(calls, registry, opts)` (`tools/orchestration.ts`) — partitions calls
  into concurrency-safe vs. serialized batches, worker-pool caps read-only batches
  (`CONCURRENCY_CAP_DEFAULT`), non-poisoning per-call failure isolation.
- `makeFsReadTool(readFile: ReadFile)`, `makeFsWriteTool(...)` (`tools/fs-read.ts`,
  `tools/fs-write.ts`) — **host-agnostic**: they delegate to an injected callback
  (`ReadFile = (input, ctx) => Promise<FsViewAckV1>`) rather than touching the
  filesystem directly. `packages/core` has zero Electron/Node-fs dependency in this
  subtree; the injected callback is where a host (Electron main today) plugs in.

### What's wired — corrects the build brief

`docs/ligma-build-brief.md` §2 states ligma-classic's "session package and new agent
loop are tested but were never wired into its app." **In the current monorepo state,
the new loop IS partially wired**:

- `packages/core/src/generate-via-new-loop.ts` exports `generateViaNewLoop(input,
  deps): Promise<GenerateOutput>` — routes a `GenerateInput` through `runTurn`,
  backed by `streamViaClaudeCli` (the Claude Max subscription wire in
  `packages/providers`), translating `AgentEvent`s into the renderer's existing
  `AgentStreamEvent` channel.
- `apps/desktop/src/main/index.ts:371-410` dispatches to it when
  `input.wire === 'claude-cli' && input.useNewLoop === true`.
- `apps/desktop/src/renderer/src/store.ts` has a `useNewLoop: boolean` field
  (persisted to `localStorage` under `ligma:useNewLoop`), toggled by a "Run with new
  loop (beta)" switch in `Settings.tsx` (`settings.advanced.useNewLoop`).

**What's actually missing** — the part the build brief's claim is really pointing at:
`generateViaNewLoop`'s own docstring calls this "v1 scope — text streaming only":
`runTurn` is handed an **empty `ToolRegistry`** and `streamViaClaudeCli` is called
with `allowedTools: []`. The Claude Agent SDK's own built-in tools (Read/Write/Edit/
Bash) aren't addressable through the `Tool` interface here, so **no file writes, no
artifact extraction, no tool-driven Wall population happens on this path** — it only
proves the event-translation plumbing with plain assistant text. The legacy path
(`generateViaAgent` in `packages/core/src/agent.ts`, built on `@mariozechner/
pi-agent-core`) is what actually drives the Wall/canvas today. Bridging the new loop's
tools to the SDK's tool-use blocks (planned as an MCP bridge, per the file's own "v2"
comments) is the missing wiring for Phase 3 to build on this path instead of the
legacy one.

Also checked and ruled out: `packages/deez` ("Design Execution Environment Zones")
and `packages/nuts` ("Network Utility Tool Set") are both empty placeholder packages
(`export {};` + a README disclaiming any implementation) — not related to the agent
loop, just reserved namespaces for future work.

---

## 5. `packages/exporters` + `packages/artifacts` + `packages/providers`

### `packages/exporters`

Lazy-loaded per format so heavy deps (`puppeteer-core`, `pptxgenjs`, `zip-lib`) don't
enter the bundle until first use. Public API (`src/index.ts`):
- `EXPORTER_FORMATS = ['html','pdf','pptx','zip','markdown']`, type `ExporterFormat`.
- `exportArtifact(format, htmlContent, destinationPath): Promise<ExportResult>` —
  single dispatcher, dynamic-imports the matching module (`html.ts`, `pdf.ts`
  [via `chrome-discovery.ts` for a local Chrome], `pptx.ts`, `zip.ts`, `markdown.ts`).
- `exportHtml(htmlContent, destinationPath, opts?)`, `exportMultiFileBundle(entries:
  MultiFileBundleEntry[], destinationPath)` (zips every file in a multi-screen
  project — distinct layout from the single-artifact zip path), `htmlToMarkdown`.
- `ExportResult = {bytes, path}`.

### `packages/artifacts`

Single file, `src/parser.ts`: `createArtifactParser()` — a streaming parser for
Claude's `<artifact ...>...</artifact>` tags. Feed text deltas in, get
`ArtifactEvent = ArtifactStartEvent{identifier, artifactType, title} |
ArtifactChunkEvent{identifier, delta} | ArtifactEndEvent{identifier, fullContent} |
TextEvent{delta}` out. Tier-1 scope: single artifact at a time, no nested tags. Zero
external deps.

### `packages/providers`

Wraps `@mariozechner/pi-ai` (generic multi-provider HTTP wire) and
`@anthropic-ai/claude-agent-sdk` (Claude Max subscription wire). Public API
(`src/index.ts`):
- `complete(model: ModelRef, messages: ChatMessage[], opts: GenerateOptions):
  Promise<GenerateResult>` — the single non-streaming entry point. Branches on
  `opts.wire === 'claude-cli'` to `completeViaClaudeCli` (see §7); otherwise resolves
  a `PiModel` via `pi-ai`'s registry (or synthesizes one for OpenRouter/custom
  wires) and calls `pi.completeSimple`.
- `streamViaClaudeCli`, `prewarmClaudeExecutable`, `completeViaClaudeCli`
  (`claude-cli/sdk-runtime.ts`); `adaptSdkStreamToProviderTurn` (`claude-cli/
  sdk-to-agent-events.ts`) — adapts the SDK's stream into the `ProviderTurn` shape
  `packages/core`'s `runTurn` consumes.
- `pingProvider`, `completeWithRetry`/`classifyError`/`sleepWithAbort` (retry.ts),
  `claudeCodeIdentityHeaders`/`shouldForceClaudeCodeIdentity`/etc.
  (claude-code-compat.ts — WAF-friendly headers for sub2api-style gateways),
  `detectProviderFromKey` (onboarding key-sniffing), `injectSkillsIntoMessages`/
  `formatSkillsForPrompt`/`filterActive` (skill-injector.ts).
- Also exports a Codex OAuth subsystem under `./codex` (separate provider, not
  covered further here — out of scope for the Studio port).

---

## 6. `buildEnrichedPrompt` — comment → structured instruction compilation

**Location**: `apps/desktop/src/renderer/src/store.ts:1451-1496` (a plain exported
function inside the giant Zustand store file, not its own module).

```ts
export interface PendingEditEnrichment {
  selector: string;
  tag: string;
  outerHTML: string;
  text: string;
  scope?: CommentScope | undefined;             // 'global' | element-scoped
  parentOuterHTML?: string | null | undefined;
}

export function buildEnrichedPrompt(
  userPrompt: string,
  pendingEdits: PendingEditEnrichment[],
): string
```

**Input**: the user's free-text prompt (may be empty, e.g. "Apply" with no extra
prose) plus the array of pending edit-kind comments (`kind='edit', status='pending'`)
currently staged — these are the comments accumulated via click-to-pin (§1) and shown
in `CommentChipBar.tsx`.

**Output**: a single markdown string. If `pendingEdits` is empty, returns
`userPrompt` verbatim (no-op passthrough). Otherwise builds:
```
## REQUIRED EDITS — you MUST apply every edit below to index.html

Each edit targets a specific element identified by its selector and outerHTML.
Use text_editor str_replace to find and modify the element. Do NOT skip any edit.

### Edit 1: <comment text>
- **Target**: `<tag>` at `<selector>`
- **Current HTML**: `<outerHTML, truncated to 600 chars>`
- **Parent context**: `<parentOuterHTML, truncated to 600 chars>`   (if present)
- **Scope**: global (apply design-wide) | element (this element only)
- **Instruction**: <comment text>

### Edit 2: ...
---

<userPrompt>                                    (if non-empty)
```

Callers: `apps/desktop/src/renderer/src/store.ts:1779` (the main `sendPrompt` /
generate flow — `pendingEdits` comes from the store's `comments` filtered to
`kind==='edit' && status==='pending'`), and `CommentChipBar.tsx`'s "Apply" button
(fires `sendPrompt({prompt: ''})`, which routes through the same `buildEnrichedPrompt`
call with an empty `userPrompt`, so *only* the staged edits are sent). Pure function,
no I/O — trivially portable, but currently landlocked inside the 3448-line Electron
renderer store.

---

## 7. How the desktop app talks to Claude — Electron-bound vs. portable

### The two wires

1. **`claude-cli` wire** (Claude Max subscription): `packages/providers/src/
   claude-cli/sdk-runtime.ts`, on top of `@anthropic-ai/claude-agent-sdk`.
   - `prewarmClaudeExecutable()` shells out to `which claude` (via `node:child_process
     execFileSync`, no shell — argv is static) **once per process**, memoized. The SDK
     ships per-platform native binaries as optional deps that pnpm + electron-vite
     bundling strips, so instead of fighting packaging, this points the SDK at the
     user's already-installed `claude` CLI, which holds the Claude Max login (Keychain
     on macOS, file on Linux) — "Ligma never sees the auth token" (per
     `LIGMA-ARCHITECTURE.md`).
   - This wire is Node-required (child_process, local binary discovery, local
     Keychain/file auth) but not Electron-API-bound per se — it's "local subscription
     CLI" bound. It **cannot run in a stateless multi-tenant web backend**: it assumes
     one logged-in `claude` CLI per machine/user, which doesn't exist in a hosted
     Next.js deployment.
2. **API-key wire** (`pi-ai`, `packages/providers/src/index.ts:complete()` default
   path): plain HTTP calls to Anthropic/OpenAI/etc. via `@mariozechner/pi-ai`. This
   wire is **portable** — no Node-only APIs, works from any server-side JS runtime
   (Node backend, Next.js API route, edge function with fetch). This is the wire
   Phase 3 Studio should standardize on for a web deployment.

### Electron-bound pieces in the render path (do not carry over as-is)

- **`window.codesign` IPC bridge** — `apps/desktop/src/preload/index.ts` (694 lines,
  ~260 `ipcRenderer.invoke(...)` call sites exposed via `contextBridge`). This is the
  *entire* data layer the renderer talks to: generation, cancel, comments, snapshots,
  chat messages, design files, exports, locale, onboarding, provider settings, Codex
  OAuth, diagnostics. Every Wall/Studio component (`CanvasWall`, `PreviewPane`,
  `TweakPanel`, `CommentChipBar`, and above all `store.ts`) calls into this surface.
  **This is the single largest port item**: none of it exists in a browser; it all
  needs to become REST/tRPC/WebSocket calls against `apps/daemon`.
- **`apps/desktop/src/main/snapshots-db.ts`** — `better-sqlite3` (native Node addon,
  requires per-platform prebuilt `.node` binaries, resolved via `resolveNativeBinding
  Path` for Electron vs. plain-Node ABI). Backs `designs`, `design_snapshots` (the
  Wall's actual version history — see the important correction below),
  `design_messages`/chat, `comments`, `design_files` (virtual FS — see below),
  `design_systems`, diagnostics. Electron-process-bound (`main` only, synchronous
  API "safe because it's the only caller").
- **`apps/desktop/src/main/keychain.ts`** — wraps Electron's `safeStorage` (OS
  keychain-backed encryption) for API key storage. No web equivalent; a hosted
  Studio needs a server-side secrets vault instead.
- **`apps/desktop/src/main/electron-runtime.ts`** — `require('electron')`, exposes
  `app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell`. Anything
  importing this is main-process-only by construction.
- **`electron-updater`**, native menu (`app-menu.ts`), window chrome
  (`window-chrome.ts`) — desktop-shell concerns with no web analogue, and out of
  scope for Studio functionality anyway.

### Browser-safe, ports directly

- **`packages/runtime`** — confirmed dependency-free of Node/Electron (only dep is
  `@ligma/shared`, which is pure TS/zod, no `node:*` imports in the files this doc
  touched). `?raw` Vite imports of the vendor JS files are a Vite-specific import
  assertion; Next.js/webpack has an equivalent (`asset/source` or `raw-loader`) or the
  vendor strings can be inlined as plain template literals — trivial shim either way.
  The overlay script itself runs *inside a sandboxed iframe* with `sandbox="allow-
  scripts"` and no `allow-same-origin`, so it has zero access to Electron regardless
  of host — it was already written to run in an untrusted, origin-isolated context.
- **`packages/core/src/agent/*`** (the new loop) — confirmed host-agnostic. `fs-read.ts`
  / `fs-write.ts` delegate through injected callbacks (`ReadFile`/`WriteFile`
  function types), never touch `node:fs` directly. `loop.ts`/`events.ts`/
  `orchestration.ts` are pure control-flow over `AsyncIterable`s. This is the part of
  the "new agent loop" most ready to run inside a Next.js server/edge function.
- **`packages/session`** — Node-only (`node:fs/promises`, `node:crypto`, `node:os`,
  `node:path`) but **not Electron-only** — it never imports `electron`. Runs fine in
  any Node.js server process (a Next.js API route with the Node runtime, or
  `apps/daemon`). Would need `resolveSessionPaths`'s `~/.config/ligma` default swapped
  for a server-appropriate data directory (already has a `PathsOverride` seam for
  exactly this).
- **`packages/exporters`, `packages/artifacts`, `packages/providers`'s pi-ai wire** —
  server-portable (Node APIs, no Electron). `exporters`' `pdf.ts` needs a local/
  discoverable Chrome (`chrome-discovery.ts`) — fine in a Node backend, not in a
  browser tab.
- **Wall/Studio React components themselves** (`CanvasWall.tsx`, `CanvasViewport.tsx`,
  `PinOverlay.tsx`, `TweakPanel.tsx`, `CommentChipBar.tsx`, the pure gesture-state
  functions) — plain React + Tailwind-style CSS vars, **zero Electron imports**. Fully
  portable as components; what's not portable is what they're wired to
  (`useCodesignStore`'s actions, which call `window.codesign.*`).
- **`buildEnrichedPrompt`** — pure function, portable as-is once extracted from
  `store.ts`.

### Needs a shim / rework (not pure Electron, not pure web)

- **The virtual file system**. `packages/core/src/tools/text-editor.ts`'s
  `TextEditorFsCallbacks` interface (`view/create/strReplace/insert/listDir`) is
  already abstracted behind dependency injection — good news — but its *current*
  implementation (`design-files-ipc.ts` → `snapshots-db.ts` functions like
  `viewDesignFile`, `createDesignFile`, `strReplaceInDesignFile`) is SQLite-backed,
  not real disk I/O. Porting means swapping the SQLite implementation for whatever
  `apps/daemon` uses (the build brief mandates **no SQLite, JSON files are the source
  of truth** — see §8 below), while keeping the same callback interface. The
  interface survives; the implementation must be rewritten regardless of web vs.
  desktop.
- **`declare_tweak_schema` / `text_editor` agent tools** — built on
  `@mariozechner/pi-agent-core`'s `AgentTool` type and `@sinclair/typebox` schemas;
  portable as long as `pi-agent-core` itself runs server-side (it does — no Electron
  dependency observed in `packages/core/src/agent.ts`'s imports).

---

## 8. Portability assessment: what moves to web as-is, what needs a shim, what is Electron-locked

**Moves to web as-is**
- `packages/runtime` in full (overlay script, tweaks bridge, srcdoc builder) — it's
  already a sandboxed-iframe payload with no host assumptions.
- `packages/core/src/agent/*` (the new async-generator loop, events, tool
  orchestration) — host-agnostic by design, injected-callback tools.
- `packages/artifacts` (streaming `<artifact>` parser) — zero deps.
- `packages/providers`'s pi-ai / API-key wire (`complete()` minus the `claude-cli`
  branch) — plain HTTP.
- `packages/session` — Node-only, not Electron-only; runs in any Node server process.
  **This is the package that answers the build brief's "content-addressed snapshots
  already exist in the engine" claim — confirmed true, SHA-256-fingerprinted blobs,
  dedup'd via `wx`-flag write.** See the important caveat below.
- The Wall/Studio presentational React components (`CanvasWall`, `CanvasViewport`,
  `PinOverlay`, `TweakPanel`, `CommentChipBar`) and the extracted gesture state
  machine — pure React/TS, no Electron imports, but currently wired to a store whose
  *actions* are Electron-bound (see below).
- `buildEnrichedPrompt` — pure function, trivial to extract and reuse.

**Needs a shim**
- The virtual file system (`TextEditorFsCallbacks`) — interface is host-agnostic and
  survives; its concrete implementation (SQLite via `snapshots-db.ts`) must be
  rewritten against whatever `apps/daemon` uses for storage (JSON files, per the
  build brief's "no SQLite" constraint — direct tension with the inherited desktop
  code, flagged explicitly for Phase 3 planning).
- `window.codesign.*` (the ~260-call IPC surface) — every call site needs a
  REST/SSE/WebSocket equivalent against `apps/daemon`. This is mechanical but large:
  it's the actual data-fetching layer for every Studio feature, not just the Wall.
- `@anthropic-ai/claude-agent-sdk` / `claude-cli` wire — technically Node-portable
  (no Electron API), but architecturally assumes one local logged-in CLI per user;
  a hosted Studio needs to either drop this wire (API-key only) or build a
  fundamentally different per-tenant auth/session model for it. Treat as "needs a
  product decision", not just a shim.

**Electron-locked**
- `apps/desktop/src/main/snapshots-db.ts` (better-sqlite3 native addon + ABI
  resolution) — the Wall's actual `design_snapshots` version-history table. **This is
  a distinct system from `packages/session`'s content-addressed blobs**: `design_
  snapshots` rows store the *full* `artifact_source` per row (`TEXT`), addressed by a
  random UUID `id` with a `parent_id` DAG link — not content-addressed, no dedup, no
  hashing. It is what currently powers the version rail's actual data in the desktop
  app, and it is Electron/native-module-bound end to end. If Phase 3 wants the
  content-addressed engine the build brief describes, it should build the new
  version rail on the `packages/session` pattern (SHA-256 fingerprint + blob dedup,
  already JSONL/file-based and daemon-friendly), not on a port of `snapshots-db.ts`.
- `apps/desktop/src/main/keychain.ts` (Electron `safeStorage`) — needs a server-side
  secrets vault, not a shim.
- `apps/desktop/src/main/electron-runtime.ts` and everything that imports it directly
  (`app-menu.ts`, `window-chrome.ts`, `electron-updater` wiring, `BrowserWindow`
  usage in `main/index.ts`) — desktop-shell only, no Studio-functional content to
  port.
- `prewarmClaudeExecutable()`'s `which claude` + local Keychain-backed CLI session —
  same as above, a genuine "different auth model for web" decision, not a code port.

---

## Three findings most load-bearing for the port plan

1. **The build brief's "session package and new agent loop were never wired" is only
   half true in this monorepo.** The new loop *is* wired end-to-end for plain text
   streaming (`generateViaNewLoop`, gated by a `useNewLoop` beta toggle in Settings),
   but its `ToolRegistry` is empty and `allowedTools: []` — so it never writes files,
   never populates the Wall, and isn't what currently drives generation. The
   architecture (host-agnostic tools, `AsyncGenerator<AgentEvent, TurnDone>`) is
   exactly what a web backend wants, and the only missing piece is bridging its
   `Tool` interface to real tool execution (an MCP bridge, per the code's own
   comments) — this is the natural spine for Phase 3's generation engine, not a
   from-scratch build.

2. **There are two unrelated "snapshot" systems, and the build brief's "content-
   addressed snapshots already exist in the engine" refers to the wrong one if read
   literally as "the Wall's version history."** `packages/session` genuinely has
   SHA-256 content-addressed, deduped blob storage (`files/<fingerprint>`) — but it's
   the *agent transcript/file-history* log, wired only through `session-ipc.ts`. The
   Wall's actual per-design version rail (`design_snapshots` in `snapshots-db.ts`) is
   a SQLite table with full-body rows and a `parent_id` DAG — not content-addressed,
   and Electron/native-module-bound. Phase 3's version rail should be built on the
   `packages/session` blob pattern (which also satisfies the build brief's separate
   "no SQLite, JSON files" constraint), not on a port of `snapshots-db.ts`.

3. **The runtime/iframe layer (`packages/runtime`) is the cleanest, highest-confidence
   port in this whole survey** — it has exactly one workspace dependency, no Node or
   Electron APIs, and was already built to run inside a fully sandboxed, origin-
   isolated iframe with no trust in its host. Everything that makes the Wall feel
   alive (live-tracked comment pins, three-state pin visuals, the no-flash EDITMODE
   tweak bridge, artboard drag) rides on this package's postMessage protocol, which
   is host-neutral by construction. The actual Electron-lock-in for the Studio isn't
   in the canvas or the overlay — it's almost entirely concentrated in the
   ~260-call `window.codesign` IPC surface that `store.ts` calls into, and in
   `snapshots-db.ts`'s native SQLite binding. Porting the *interaction* layer is low
   risk; porting the *data* layer is the real Phase 3 effort.
