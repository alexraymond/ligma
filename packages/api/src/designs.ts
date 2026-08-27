/**
 * Studio design sessions — the shapes the Wall, the version rail, the pin
 * overlay, the tweaks panel and the critique lane all speak.
 *
 * Designs are **central** artifacts, not repo knowledge: they live at
 * `data/projects/<projectId>/designs/<designId>/` as a multi-file design source
 * plus a `design.json` manifest (CONTRACTS-phase3 "Data model"). Snapshots are
 * content-addressed SHA-256 blobs — never
 * SQLite, never full-body rows.
 *
 * One rule runs through every type here: a critic malfunction is `error`, never
 * a score (build brief §4 principle 12). `CritiqueReport.score` is nullable for
 * exactly that reason — there is no "0 because it broke".
 */

// ─── Design identity and status ──────────────────────────────────────────────

/**
 * Where a design is in its life.
 *
 * `stale` is set when the brief a design was drawn from changes after the
 * design was approved — the Deck raises a card rather than invalidating the
 * design (pinned product default, build brief §2).
 */
export type DesignStatus = 'drafting' | 'critiquing' | 'approved' | 'stale';

/** One file of the design source, content-addressed. */
export interface DesignFileRef {
  /** POSIX path relative to the design directory. Never absolute, never `..`. */
  path: string;
  /** SHA-256 of the body, hex. The blob store key. */
  fingerprint: string;
  byteSize: number;
}

// ─── Version rail (content-addressed snapshots) ──────────────────────────────

/** What produced a version. `restore` never mutates history — it appends. */
export type DesignVersionOrigin = 'initial' | 'prompt' | 'comment-apply' | 'tweak' | 'restore';

/**
 * One turn's snapshot of the whole design directory.
 *
 * A version records *which blobs* made up the design at that moment; the blobs
 * themselves are deduped in the design's `blobs/` dir, so an unchanged file
 * across 40 versions is stored once.
 */
export interface DesignVersion {
  id: string;
  /** 1-based, append-only, dense. The version rail's ordering. */
  n: number;
  createdAt: string;
  origin: DesignVersionOrigin;
  /** Short human label for the rail ("pinned edits ×3", "restored v4"). */
  label: string;
  files: DesignFileRef[];
  /** Set when `origin === "restore"`: the version whose content was re-pointed. */
  restoredFrom: string | null;
}

/** A version as the rail lists it — no file table, so a long rail stays cheap. */
export interface DesignSnapshotSummary {
  versionId: string;
  n: number;
  createdAt: string;
  origin: DesignVersionOrigin;
  label: string;
  fileCount: number;
  totalBytes: number;
  restoredFrom: string | null;
}

/** Body of `POST .../designs/:did/snapshots` — restore appends a new version. */
export interface DesignRestoreRequest {
  versionId: string;
}

/** One design source file with its content, for the Wall's iframes. */
export interface DesignFileBody {
  path: string;
  body: string;
}

/**
 * Response of `GET .../designs/:did/files[?versionId=]`.
 *
 * The sibling of the version list: `DesignVersion.files[]` carries a path, a
 * fingerprint and a byte size — enough to *list* a design, not enough to render
 * one. Bodies come out of the content-addressed blob store, so asking for an
 * older `versionId` is the same operation as asking for the head one. That is
 * what makes the version rail's before/after real rather than a label: both
 * sides are served by one code path from immutable content.
 */
export interface DesignFilesResponse {
  designId: string;
  /** The version served. Null when the design has no versions yet. */
  versionId: string | null;
  files: DesignFileBody[];
}

// ─── Comment pins (click-to-pin → compiled instruction) ──────────────────────

/** `global` = apply design-wide; `element` = this element only. */
export type PinScope = 'element' | 'global';

/** `pending` pins compile into the next apply-turn; `applied` ones are history. */
export type PinStatus = 'pending' | 'applied';

/**
 * One pinned comment, carrying the enrichment the overlay captured at click
 * time (selector + outerHTML + parent context) so the compiled instruction can
 * name the element precisely instead of describing it.
 */
export interface DesignPin {
  id: string;
  /** Design-relative file the pin was placed on. */
  filePath: string;
  /** XPath-ish selector from the runtime overlay (`data-codesign-id`, #id, path). */
  selector: string;
  tag: string;
  /** Truncated by the producer — the compiler truncates again defensively. */
  outerHTML: string;
  parentOuterHTML: string | null;
  /** What the human wrote. */
  text: string;
  scope: PinScope;
  status: PinStatus;
  createdAt: string;
  /** The version whose turn applied this pin — F4's "pin links to its turn". */
  appliedInVersionId: string | null;
}

/** Body of `POST .../designs/:did/pins`. */
export interface CreatePinRequest {
  filePath: string;
  selector: string;
  tag: string;
  outerHTML: string;
  parentOuterHTML?: string | null;
  text: string;
  scope?: PinScope;
}

/** Body of `PATCH .../designs/:did/pins` — edit or drop a staged pin. */
export interface UpdatePinRequest {
  pinId: string;
  text?: string;
  scope?: PinScope;
  /** `true` removes the pin. */
  remove?: boolean;
}

/**
 * The apply-preview (UX spec F4): what "Apply (N)" would actually send.
 *
 * `instruction` is the exact string the comment-apply turn transmits — not a
 * summary of it. Showing anything else reintroduces the opacity F4 exists to
 * fix, so the preview endpoint and the turn endpoint call one compiler.
 */
export interface CompiledInstructionPreview {
  designId: string;
  /** Byte-for-byte what the turn sends to the model. */
  instruction: string;
  /** Pins folded into `instruction`, in the order they appear in it. */
  pinIds: string[];
  /** The free-text prompt appended after the edit block (may be ""). */
  userPrompt: string;
}

// ─── Tweaks (the EDITMODE bridge schema, agent-declared) ─────────────────────

export type TweakControlKind = 'color' | 'number' | 'enum' | 'boolean' | 'string';

/** A tweak's value. Matches the JSON the EDITMODE token block holds. */
export type TweakValue = string | number | boolean;

/**
 * The control the agent declared for one token (`declare_tweak_schema`).
 *
 * Advisory in ligma-classic and advisory here: a token missing from the schema
 * still renders from a value-shape heuristic. `live` is the load-bearing field —
 * it says the value can be swapped into the design source directly, so a tweak
 * turn applies it without a regeneration spawn (and therefore without a
 * governor slot).
 */
export interface TweakControl {
  kind: TweakControlKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  placeholder?: string;
  /** Value substitution suffices — no regeneration needed. */
  live: boolean;
}

/**
 * Token name → its declared control.
 *
 * NOT the same type as `@ligma/shared`'s `TweakSchema`
 * (`Record<string, TokenSchemaEntry>`), and the duplication is known and
 * currently deliberate (codebase audit P23/P24). Three things have to be
 * settled before they can be unified, and none of them is a type edit:
 *
 *   1. This package declares NO runtime dependencies on purpose ("types, route
 *      path constants and SSE event names only" — index.ts). Importing from
 *      `@ligma/shared` means adding it to `packages/api/package.json`.
 *   2. Shared's entry has no `live` field and `parseTweakSchema` drops it.
 *      `live` is load-bearing here: `daemon/src/studio/session.ts`'s
 *      `tweaksAreLive` reads it to decide whether a tweak can skip a
 *      regeneration spawn — and therefore a governor slot. Deriving from
 *      shared's shape would silently delete that.
 *   3. Shared's is a discriminated union where `enum` REQUIRES `options`; this
 *      is a flat interface where everything but `kind`/`live` is optional,
 *      because `web/src/components/studio/api.ts`'s `controlFor` SYNTHESIZES a
 *      control from a value heuristic for tokens the agent never declared.
 *      Narrowing to the union breaks that call site.
 *
 * The honest unification is `TweakControl = TokenSchemaEntry & { live: boolean }`
 * plus a `controlFor` that builds complete union members — a maintainer call,
 * not a rename.
 */
export type TweakSchema = Record<string, TweakControl>;

/** Token name → current value. */
export type TweakValues = Record<string, TweakValue>;

// ─── Critique lane (the panel: craft, design-system fidelity, accessibility) ──

/**
 * `error` is a first-class outcome, distinct from a bad score: a critic that
 * crashed, timed out, or returned unparseable output produced **no** judgement.
 * Reporting that as a low score is the exact defect principle 12 forbids.
 */
export type CritiqueStatus = 'idle' | 'running' | 'scored' | 'interrupted' | 'error';

/** One craft rule (or design-system rule) the critic scored. */
export interface CritiqueRuleScore {
  /** Rule slug — a `craft/*.md` basename, or `design-system:<slug>`. */
  rule: string;
  /** 0–100 for this rule. */
  score: number;
  note: string;
}

/**
 * A panelist's outcome. Deliberately NOT `CritiqueStatus`: a panel has one
 * outcome the whole pass never had — `skipped`, a lane that was never asked
 * the question (the governor denied its slot, or it had nothing to score).
 * A skipped lane is not an errored one and is emphatically not a zero.
 */
export type CritiqueLaneStatus = 'scored' | 'skipped' | 'interrupted' | 'error';

/** Why a `skipped` lane was skipped — structured, so no UI parses the message. */
export type CritiqueLaneSkipReason = 'quota' | 'not-applicable';

/** One panelist's verdict. */
export interface CritiqueLaneReport {
  /** Lane id — `craft-rules`, `design-system-fidelity`, `accessibility`. */
  lane: string;
  status: CritiqueLaneStatus;
  /** 0–100 for this lane. Null unless `status === "scored"`. */
  score: number | null;
  rules: CritiqueRuleScore[];
  /** Set only when `status === "skipped"`. */
  skipReason?: CritiqueLaneSkipReason;
  /** The denial or malfunction in words. Null on a scored lane. */
  error: string | null;
}

export interface CritiqueReport {
  status: CritiqueStatus;
  /**
   * 0–100 overall — the simple mean of the lanes that actually scored. Null
   * unless `status === "scored"` — never a proxy for error, and never diluted
   * by a lane that never ran.
   */
  score: number | null;
  /** The bar this design is being held to. */
  threshold: number;
  rules: CritiqueRuleScore[];
  /** Design-system slug the critic scored against, when one is in use. */
  designSystem: string | null;
  /** Populated only when `status === "error"`. Harness malfunction, not a verdict. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * Per-panelist verdicts. Absent on reports written before the panel existed
   * (a single-critic manifest still reads back fine — the flat `rules` above
   * is the same list, ungrouped).
   */
  lanes?: CritiqueLaneReport[];
}

// ─── The manifest (design.json) ──────────────────────────────────────────────

/**
 * `design.json` — the whole session state, on disk, as the source of truth.
 *
 * Read it and you can rebuild the Studio's entire view of a design: the rail,
 * the staged pins, the tweak panel, the critique lane, the approval.
 */
export interface DesignManifest {
  id: string;
  projectId: string;
  title: string;
  status: DesignStatus;
  createdAt: string;
  updatedAt: string;
  /** `design-systems/<slug>` in use, or null for none. */
  designSystem: string | null;
  /** The brief/prompt this design was drawn from — the staleness anchor. */
  sourcePrompt: string;
  versions: DesignVersion[];
  pins: DesignPin[];
  /** Declared by the agent via `declare_tweak_schema`; null until it does. */
  tweaks: TweakSchema | null;
  tweakValues: TweakValues;
  /** Latest critique pass. Null before the first one runs. */
  critique: CritiqueReport | null;
  approvedAt: string | null;
  /** Set once this design has been promoted into a signed contract. */
  promotedContractId: string | null;
}

/** List view — `GET /api/projects/:id/designs`. */
export interface DesignSummary {
  id: string;
  projectId: string;
  title: string;
  status: DesignStatus;
  createdAt: string;
  updatedAt: string;
  designSystem: string | null;
  versionCount: number;
  /** Files in the newest version, for the Wall's card grid. */
  files: DesignFileRef[];
  /** Overall critique score, or null when unscored / errored. */
  critiqueScore: number | null;
  pendingPinCount: number;
}

/** Body of `POST /api/projects/:id/designs`. */
export interface CreateDesignRequest {
  /** Falls back to a title derived from the prompt. */
  title?: string;
  /** The opening instruction. An empty prompt creates an empty drafting session. */
  prompt?: string;
  /** `design-systems/<slug>`. */
  designSystem?: string;
}

/**
 * Body of `PATCH /api/projects/:id/designs/:did`.
 *
 * Only the design system is settable mid-session: the manifest's other fields
 * are either history (versions, pins) or verdicts (status, critique), and a
 * session that could rewrite its own record would be the same "builder grades
 * itself" failure the tool scoping exists to prevent.
 */
export interface UpdateDesignRequest {
  /** `design-systems/<slug>`, or null for none. Takes effect on the next turn. */
  designSystem?: string | null;
}

// ─── Reference attachments ───────────────────────────────────────────────────

/**
 * A reference image attached to the composer — "make it look like this".
 *
 * Stored under the design directory, never inside `src/`: an attachment is an
 * *input* to the design, and putting it in the agent-writable tree would make
 * it show up as a screen on the Wall and land in every snapshot.
 */
export interface DesignAttachment {
  /** Content-addressed: `<sha256>.<ext>`. Two uploads of one image are one file. */
  id: string;
  /** The filename the user dropped, for the composer chip and the transcript. */
  name: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
}

/** Body of `POST /api/projects/:id/designs/:did/attachments`. */
export interface CreateDesignAttachmentRequest {
  name: string;
  /** `data:image/png;base64,…` — the same JSON upload shape References uses. */
  dataUrl: string;
}

/** Response of GET/POST `/api/projects/:id/designs/:did/attachments`. */
export interface DesignAttachmentsResponse {
  designId: string;
  attachments: DesignAttachment[];
  /**
   * POST only: the entry this upload became. Named rather than left for the
   * caller to guess from the list, because storing bytes that are already there
   * returns the existing entry and the list does not grow.
   */
  attachment?: DesignAttachment;
}

// ─── Turns (one endpoint, kind-discriminated) ────────────────────────────────

/** A fresh instruction. `filePaths` scopes it to selected Wall cards. */
export interface DesignPromptTurn {
  kind: 'prompt';
  prompt: string;
  filePaths?: string[];
  /** Ids of already-uploaded attachments to show the model with this prompt. */
  attachmentIds?: string[];
}

/**
 * Apply the staged pins. `prompt` may be empty — that is the CommentChipBar's
 * "Apply" button, which sends the compiled edit block and nothing else.
 */
export interface DesignCommentApplyTurn {
  kind: 'comment-apply';
  prompt?: string;
  /** Defaults to every pending pin. */
  pinIds?: string[];
}

/**
 * Change tweak values. Tokens whose control is `live` are substituted directly
 * (no spawn, no governor slot); anything else falls through to a regeneration
 * turn, which does take a slot.
 */
export interface DesignTweakTurn {
  kind: 'tweak';
  values: TweakValues;
}

export type DesignTurnRequest = DesignPromptTurn | DesignCommentApplyTurn | DesignTweakTurn;

/**
 * A turn is accepted, then streamed. The response returns immediately with the
 * turn id; file progress, critic events and the status transition arrive on
 * `GET .../designs/:did/stream`.
 */
export interface DesignTurnAccepted {
  designId: string;
  turnId: string;
  kind: DesignTurnRequest['kind'];
  /** True when the turn was satisfied without a model spawn (live tweaks). */
  appliedWithoutSpawn: boolean;
  /** Version created by a spawn-free turn; null when a spawn is in flight. */
  versionId: string | null;
}

// ─── SSE (the Wall's progressive render feeds off these) ─────────────────────

/** SSE event names on `GET /api/projects/:id/designs/:did/stream`. */
export const DESIGN_SSE_EVENTS = {
  /** A `DesignStatusEvent` — status transition or turn start. */
  status: 'design.status',
  /** A `DesignFileProgressEvent` — one file grew. Drives progressive render. */
  fileProgress: 'design.file-progress',
  /** A `DesignCriticEvent` — score ticker, current rule, threshold. */
  critic: 'design.critic',
  /** A `DesignSnapshotEvent` — a version landed on the rail. */
  snapshot: 'design.snapshot',
  /** A `DesignTurnDoneEvent` — the turn finished (well or badly). */
  turnDone: 'design.turn-done',
  /** A `DesignErrorEvent` — harness malfunction. Never a product verdict. */
  error: 'design.error',
  /** A `DesignTranscriptEntry` — one appended part of the turn conversation. */
  transcript: 'design.transcript',
  /** Stream closing. */
  end: 'end',
} as const;

export type DesignSseEventName = (typeof DESIGN_SSE_EVENTS)[keyof typeof DESIGN_SSE_EVENTS];

export interface DesignStatusEvent {
  designId: string;
  status: DesignStatus;
  turnId: string | null;
}

/**
 * One file-write from the generation loop.
 *
 * The Wall throttles these itself (ligma-classic's 250ms per-file cadence); the
 * daemon emits one per tool call and does not coalesce, so a consumer that
 * wants every keystroke-equivalent gets it.
 */
export interface DesignFileProgressEvent {
  designId: string;
  turnId: string;
  path: string;
  byteSize: number;
  /** Turn-local ordering, matching the agent loop's tool sequence. */
  seq: number;
  /** The write finished (as opposed to a partial append). */
  done: boolean;
}

export interface DesignCriticEvent {
  designId: string;
  turnId: string;
  /**
   * `rule` frames carry `rule`; `score` frames carry `score`; a `lane` frame
   * closes one panelist and carries its `laneReport`; `end` closes the pass.
   */
  phase: 'start' | 'rule' | 'score' | 'lane' | 'end';
  status: CritiqueStatus;
  rule: CritiqueRuleScore | null;
  score: number | null;
  threshold: number;
  /** Set when `status === "error"` — a malfunction, not a low score. */
  error: string | null;
  /** Lane this frame belongs to. Absent/null on the pass-level start and end. */
  lane?: string | null;
  /** Set on `phase: "lane"` — that panelist's finished verdict. */
  laneReport?: CritiqueLaneReport | null;
}

export interface DesignSnapshotEvent {
  designId: string;
  turnId: string | null;
  snapshot: DesignSnapshotSummary;
}

export interface DesignTurnDoneEvent {
  designId: string;
  turnId: string;
  /** Mirrors the agent loop's `TurnDone.stopReason`. */
  stopReason: 'stop' | 'aborted' | 'max_turns' | 'error';
  filesWritten: number;
  versionId: string | null;
  error: string | null;
}

export interface DesignErrorEvent {
  designId: string;
  turnId: string | null;
  message: string;
}

// ─── Turn transcript (the studio conversation) ───────────────────────────────

/**
 * The transcript is stored and streamed as **append records**, not as whole
 * messages: a turn's prose arrives a chunk at a time and a tool's status
 * changes after it started, so one immutable line per event is the only shape
 * that a live SSE frame and a `.ndjson` line can share. Folding a list of
 * entries back into messages is a pure function the web side owns
 * (`components/studio/transcript.ts`), which is what makes reload and live
 * agree by construction rather than by two parallel reducers.
 */
export type DesignTranscriptRole = 'user' | 'designer';

/** A tool card's state. `running` is what a `tool_start` with no end looks like. */
export type DesignToolStatus = 'running' | 'ok' | 'error';

/** Prose the designer wrote, or the thinking behind it (collapsed by default). */
export interface DesignTranscriptTextPart {
  kind: 'text' | 'thinking';
  text: string;
  /** The producer cut this part at its size cap. */
  truncated: boolean;
}

/** One tool call, as a compact card: name, one-line summary, status. */
export interface DesignTranscriptToolPart {
  kind: 'tool';
  /** The loop's `toolUseId` — how a later `ok`/`error` finds the card it updates. */
  toolUseId: string;
  toolName: string;
  /** One line, already truncated: the path written, the tokens declared, … */
  summary: string;
  status: DesignToolStatus;
}

/**
 * Reference images the user attached to the turn, echoed on their message.
 *
 * Names, not bytes: the transcript is an append log replayed on every reload,
 * and inlining a 5MB data URL per turn would make it unreadable by the machine
 * as well as the human. The composer holds the thumbnails while you compose.
 */
export interface DesignTranscriptAttachmentsPart {
  kind: 'attachments';
  names: string[];
}

/** The files this turn produced, in write order — each links to its screen. */
export interface DesignTranscriptFilesPart {
  kind: 'files';
  paths: string[];
}

/** How the turn ended. Carries the same `stopReason` the turn-done event does. */
export interface DesignTranscriptDonePart {
  kind: 'done';
  stopReason: DesignTurnDoneEvent['stopReason'];
  error: string | null;
}

export type DesignTranscriptPart =
  | DesignTranscriptTextPart
  | DesignTranscriptToolPart
  | DesignTranscriptAttachmentsPart
  | DesignTranscriptFilesPart
  | DesignTranscriptDonePart;

/** One `.ndjson` line, and one `design.transcript` SSE frame. */
export interface DesignTranscriptEntry {
  designId: string;
  turnId: string;
  role: DesignTranscriptRole;
  /** ISO timestamp of the append. */
  at: string;
  part: DesignTranscriptPart;
}

/** Entries folded into what the transcript pane renders. */
export interface DesignTranscriptMessage {
  turnId: string;
  role: DesignTranscriptRole;
  /** The first entry's timestamp — when this message began. */
  at: string;
  parts: DesignTranscriptPart[];
  /** Null while the turn is still running. */
  stopReason: DesignTurnDoneEvent['stopReason'] | null;
  error: string | null;
}

/** Response of `GET .../designs/:did/transcript`. */
export interface DesignTranscriptResponse {
  designId: string;
  entries: DesignTranscriptEntry[];
}

// ─── Design-as-oracle ────────────────────────────────────────────────────────

/**
 * The frozen reference an approved design contributes to a contract.
 *
 * This is the "approved artifact as oracle" of the merger thesis in its richest
 * form: the exact bytes of an approved design, addressed by fingerprint, so the
 * judge compares the built product against something that provably cannot have
 * drifted since approval.
 */
export interface DesignBaselineRef {
  designId: string;
  /** The approved version — not "latest", which would keep moving. */
  versionId: string;
  approvedAt: string;
  designSystem: string | null;
  files: DesignFileRef[];
}

/** Response of `POST .../designs/:did/approve`. */
export interface DesignApproveResult {
  designId: string;
  status: DesignStatus;
  approvedAt: string;
  baseline: DesignBaselineRef;
}
