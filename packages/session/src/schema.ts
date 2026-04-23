import { z } from 'zod';

// Every on-disk entry carries a schemaVersion so migrations can evolve the
// format without breaking older installs. Per CLAUDE.md §"Schema-version
// everything that lives on disk" — bump by adding new entry types rather than
// mutating existing ones.
export const SCHEMA_VERSION = 1 as const;

const IdField = z.string().uuid();
const SessionIdField = z.string().min(1);
// ISO-8601 timestamp (not parsed into Date on the wire — stays portable).
const TimestampField = z.string().min(1);

// ── TranscriptMessage ───────────────────────────────────────────────────────
// A single assistant/user/tool message. The `payload` is kept loose because
// upstream providers yield heterogeneous content shapes; the session package
// is a transport, not a typechecker for provider output.
export const TranscriptMessage = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('transcript'),
  id: IdField,
  sessionId: SessionIdField,
  timestamp: TimestampField,
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  /** Free-form provider message body; JSON-serializable. */
  payload: z.unknown(),
  /** Optional — the turn this message belongs to, for later branching UI. */
  turnId: z.string().optional(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

// ── FileHistorySnapshot ─────────────────────────────────────────────────────
// Records a single on-disk file version, content-addressed via fingerprint.
// The transcript entry stores the fingerprint; the body lives under
// `files/<fingerprint>` in the session dir. Dedupes identical versions across
// turns for free.
export const FileHistorySnapshot = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('file_history_snapshot'),
  id: IdField,
  sessionId: SessionIdField,
  timestamp: TimestampField,
  /** Project-relative path the file lives at. */
  path: z.string().min(1),
  /** Short stable hash of the body content; also the blob filename. */
  fingerprint: z.string().min(1),
  /** Size of the snapshot body in bytes, for quick diff preview sizing. */
  byteSize: z.number().int().nonnegative(),
  /** Optional author attribution (e.g. which tool call produced this). */
  author: z.string().optional(),
});
export type FileHistorySnapshot = z.infer<typeof FileHistorySnapshot>;

// ── CustomTitle ─────────────────────────────────────────────────────────────
// User- or LLM-assigned title for the session. Last-wins on replay so users
// can rename without rewriting the log.
export const CustomTitle = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('custom_title'),
  id: IdField,
  sessionId: SessionIdField,
  timestamp: TimestampField,
  title: z.string().min(1),
});
export type CustomTitle = z.infer<typeof CustomTitle>;

// ── ToolUseSummary ──────────────────────────────────────────────────────────
// A compact record of a tool invocation — input args, output classification,
// duration. Stored as a sibling entry (not nested inside TranscriptMessage)
// so UI and analytics can page through tool calls independently of the
// assistant text stream.
export const ToolUseSummary = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('tool_use_summary'),
  id: IdField,
  sessionId: SessionIdField,
  timestamp: TimestampField,
  toolName: z.string().min(1),
  /** Opaque id that ties start → end across streaming events. */
  toolCallId: z.string().min(1),
  inputPreview: z.string(),
  /** 'ok' | 'error' | 'aborted' — kept as string to avoid a breaking enum change later. */
  outcome: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type ToolUseSummary = z.infer<typeof ToolUseSummary>;

// ── TurnDone ────────────────────────────────────────────────────────────────
// Emitted when a turn (one prompt → agent response cycle) completes. Used as
// the fsync boundary by the writer: batching is allowed between TurnDones but
// we flush kernel buffers on every turn boundary so a mid-turn crash loses at
// most the in-flight turn.
export const TurnDone = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('turn_done'),
  id: IdField,
  sessionId: SessionIdField,
  timestamp: TimestampField,
  turnId: z.string().min(1),
  /** 'ok' | 'error' | 'aborted' — string for forward-compat. */
  outcome: z.string(),
});
export type TurnDone = z.infer<typeof TurnDone>;

// ── Discriminated union ─────────────────────────────────────────────────────
export const SessionEntry = z.discriminatedUnion('type', [
  TranscriptMessage,
  FileHistorySnapshot,
  CustomTitle,
  ToolUseSummary,
  TurnDone,
]);
export type SessionEntry = z.infer<typeof SessionEntry>;

/** Input shape accepted by the writer: same as SessionEntry but `id`,
 *  `sessionId`, `schemaVersion` and `timestamp` are filled in by the writer
 *  when omitted. The writer has a bound sessionId so callers don't re-pass
 *  it on every append; `schemaVersion` is an implementation detail of the
 *  on-disk format. */
type InputOverrides = {
  id?: string;
  sessionId?: string;
  timestamp?: string;
};
type WithoutManaged<T> = Omit<T, 'id' | 'sessionId' | 'timestamp' | 'schemaVersion'>;

// For FileHistorySnapshot, `fingerprint` and `byteSize` are writer-derived
// (from the supplied fileBody bytes) so callers don't pass them.
type FileHistorySnapshotInput = Omit<
  WithoutManaged<FileHistorySnapshot>,
  'fingerprint' | 'byteSize'
> & {
  fingerprint?: string;
  byteSize?: number;
} & InputOverrides;

export type SessionEntryInput =
  | (WithoutManaged<TranscriptMessage> & InputOverrides)
  | FileHistorySnapshotInput
  | (WithoutManaged<CustomTitle> & InputOverrides)
  | (WithoutManaged<ToolUseSummary> & InputOverrides)
  | (WithoutManaged<TurnDone> & InputOverrides);
