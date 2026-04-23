import type { CoreLogger } from './logger.js';
import { NOOP_LOGGER } from './logger.js';
import type { PathsOverride } from './paths.js';
import { SessionReader } from './reader.js';
import type {
  CustomTitle,
  FileHistorySnapshot,
  SessionEntry,
  ToolUseSummary,
  TranscriptMessage,
  TurnDone,
} from './schema.js';

export interface ResumeOptions {
  sessionId: string;
  logger?: CoreLogger;
  paths?: PathsOverride;
}

export interface ResumedSession {
  sessionId: string;
  /** Most recent title assigned via CustomTitle, if any (last-wins). */
  title: string | undefined;
  /** Latest snapshot per file path (last-wins by timestamp order). */
  fileSnapshots: Map<string, FileHistorySnapshot>;
  /** Transcript messages in forward order — ready to feed back into a
   *  provider for continuation. */
  transcript: TranscriptMessage[];
  /** Tool-use records in forward order. Not merged with transcript — the
   *  sibling-entry split lets UIs render them in a side panel. */
  toolUses: ToolUseSummary[];
  /** Turn-done markers in order; useful for "resume from last completed
   *  turn" semantics. */
  turns: TurnDone[];
  /** Total entries replayed (after dropping any truncated tail). */
  entryCount: number;
}

/** Replay every entry in the session's transcript in forward order and apply
 *  last-wins rules for CustomTitle + FileHistorySnapshot. If the last line is
 *  a truncated JSON object, the reader drops it and logs a warning via the
 *  injected logger — resume still completes successfully on prior entries. */
export async function resumeSession(options: ResumeOptions): Promise<ResumedSession> {
  const logger = options.logger ?? NOOP_LOGGER;
  const reader = new SessionReader({
    sessionId: options.sessionId,
    logger,
    ...(options.paths !== undefined ? { paths: options.paths } : {}),
  });
  const entries = await reader.readAll();

  let title: string | undefined;
  const fileSnapshots = new Map<string, FileHistorySnapshot>();
  const transcript: TranscriptMessage[] = [];
  const toolUses: ToolUseSummary[] = [];
  const turns: TurnDone[] = [];

  for (const entry of entries) {
    switch (entry.type) {
      case 'custom_title':
        title = entry.title;
        break;
      case 'file_history_snapshot':
        // Last-wins per path: later snapshots supersede earlier ones. The
        // blob store retains every version so the UI can still diff back,
        // but the resumed view reflects the current state.
        fileSnapshots.set(entry.path, entry);
        break;
      case 'transcript':
        transcript.push(entry);
        break;
      case 'tool_use_summary':
        toolUses.push(entry);
        break;
      case 'turn_done':
        turns.push(entry);
        break;
      default:
        assertNever(entry, logger, options.sessionId);
    }
  }

  return {
    sessionId: options.sessionId,
    title,
    fileSnapshots,
    transcript,
    toolUses,
    turns,
    entryCount: entries.length,
  };
}

function assertNever(entry: SessionEntry, logger: CoreLogger, sessionId: string): void {
  // Unknown discriminant — could happen if a future schema version lands a
  // new entry type and an older build reads the same log. Warn and ignore;
  // do not throw, because resume must be robust to forward-compat reads.
  const e = entry as { type?: string };
  logger.warn('session.resume.unknown_entry_type', {
    sessionId,
    type: e.type ?? 'unknown',
  });
}

// Re-export helpers for callers who want a lower-level view of the log.
export type { CustomTitle, FileHistorySnapshot, TurnDone } from './schema.js';
