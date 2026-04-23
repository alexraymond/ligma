import { readFile } from 'node:fs/promises';
import type { CoreLogger } from './logger.js';
import { NOOP_LOGGER } from './logger.js';
import { type PathsOverride, resolveSessionPaths } from './paths.js';
import { SessionEntry } from './schema.js';

export interface ReaderOptions {
  sessionId: string;
  logger?: CoreLogger;
  paths?: PathsOverride;
}

export interface HistoryPage {
  /** Entries in reverse chronological order (newest first). */
  entries: SessionEntry[];
  /** The id of the oldest entry in this page; pass as `beforeId` to
   *  `fetchOlder` to get the next page back in time. Null when the page is
   *  empty or we've walked off the start of the log. */
  firstId: string | null;
  /** True when older entries still exist before this page. */
  hasMore: boolean;
}

export class SessionReader {
  private readonly sessionId: string;
  private readonly logger: CoreLogger;
  private readonly paths: ReturnType<typeof resolveSessionPaths>;

  constructor(options: ReaderOptions) {
    this.sessionId = options.sessionId;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.paths = resolveSessionPaths(options.paths);
  }

  /** The most recent `limit` entries. Returned newest-first. */
  async fetchLatest(limit: number): Promise<HistoryPage> {
    assertLimit(limit);
    const all = await this.readAll();
    const sliced = all.slice(Math.max(0, all.length - limit));
    const reversed = [...sliced].reverse();
    return toPage(reversed, all.length > sliced.length);
  }

  /** Entries strictly older than `beforeId`, newest-first, capped at `limit`.
   *  Mirrors Claude Code's before_id cursor: the entry with id=`beforeId`
   *  itself is NOT included (the caller already has it from the prior page).
   *  Returns an empty page with `hasMore=false` if `beforeId` is at or before
   *  the start of the log. */
  async fetchOlder(beforeId: string, limit: number): Promise<HistoryPage> {
    assertLimit(limit);
    const all = await this.readAll();
    const cursorIdx = all.findIndex((e) => e.id === beforeId);
    if (cursorIdx <= 0) {
      // Either not found (unknown cursor) or already at the start. Either way
      // no older entries to return — empty page, no more.
      return { entries: [], firstId: null, hasMore: false };
    }
    const start = Math.max(0, cursorIdx - limit);
    const slice = all.slice(start, cursorIdx);
    const reversed = [...slice].reverse();
    return toPage(reversed, start > 0);
  }

  /** Full chronological read. Exposed for resume(). Drops the last line if
   *  truncated and logs a warning — the writer's fsync-on-turn-boundary
   *  guarantees we only lose entries since the last turn-done. */
  async readAll(): Promise<SessionEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.paths.transcriptPath(this.sessionId), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw err;
    }
    if (raw.length === 0) return [];

    // Split into logical lines; a trailing `\n` yields an empty final element
    // we discard. Any non-empty last element that fails to parse is treated
    // as a truncated write and dropped with a warning.
    const lines = raw.split('\n');
    const entries: SessionEntry[] = [];
    const lastIdx = lines.length - 1;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined || line.length === 0) continue;
      const parsed = tryParseEntry(line);
      if (parsed === null) {
        if (i === lastIdx) {
          this.logger.warn('session.reader.truncated_last_line', {
            sessionId: this.sessionId,
            bytes: line.length,
          });
          continue;
        }
        // Mid-stream corruption. Log + skip so the caller still gets usable
        // history rather than an all-or-nothing failure.
        this.logger.warn('session.reader.corrupt_entry', {
          sessionId: this.sessionId,
          lineNumber: i + 1,
        });
        continue;
      }
      entries.push(parsed);
    }
    return entries;
  }
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`limit must be a positive integer, got ${String(limit)}`);
  }
}

function toPage(entries: SessionEntry[], hasMore: boolean): HistoryPage {
  const oldest = entries[entries.length - 1];
  return {
    entries,
    firstId: oldest?.id ?? null,
    hasMore,
  };
}

function tryParseEntry(line: string): SessionEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    const result = SessionEntry.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
