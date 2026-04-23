import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, writeFile } from 'node:fs/promises';
import { computeFingerprint } from '@open-codesign/shared/fingerprint';
import type { CoreLogger } from './logger.js';
import { type PathsOverride, type SessionPaths, resolveSessionPaths } from './paths.js';
import { SCHEMA_VERSION, SessionEntry, type SessionEntryInput } from './schema.js';

// The writer is intentionally dumb: it enforces one invariant — concurrent
// `append()` calls on the same session serialize so JSONL lines never
// interleave. That's enough to keep the reader honest; we do not attempt to
// coordinate across processes (single-process Electron main is the only
// writer in-product).
//
// fsync discipline:
//   - TurnDone and CustomTitle → fsync before resolving (turn-boundary commit
//     per acceptance criterion 3). These are the two entries a user notices
//     if they vanish on crash.
//   - Everything else → append only. The OS page cache will flush on its own
//     schedule; a power loss between these appends and the next turn-boundary
//     commit drops at most the trailing batch, and the resume logic recovers
//     from that by dropping the corrupt tail line.

export interface WriterOptions {
  sessionId: string;
  logger: CoreLogger;
  paths?: PathsOverride;
}

export interface AppendOptions {
  /** Raw file body to content-address when the entry is a FileHistorySnapshot.
   *  The fingerprint on the entry is derived from this body — callers pass the
   *  bytes, not the fingerprint. The body is written to `files/<fingerprint>`
   *  atomically (write-then-rename via open(..., 'wx') for first-write and a
   *  no-op for identical repeats). */
  fileBody?: Buffer | string;
}

export interface AppendResult {
  id: string;
  timestamp: string;
  fingerprint?: string;
}

export class SessionWriter {
  private readonly sessionId: string;
  private readonly logger: CoreLogger;
  private readonly paths: SessionPaths;
  private chain: Promise<unknown> = Promise.resolve();
  private initialized = false;

  constructor(options: WriterOptions) {
    this.sessionId = options.sessionId;
    this.logger = options.logger;
    this.paths = resolveSessionPaths(options.paths);
  }

  async append(input: SessionEntryInput, options: AppendOptions = {}): Promise<AppendResult> {
    // Chain every append onto the prior one's promise. Node fs.appendFile is
    // already atomic per-call on POSIX (single write syscall for small bodies),
    // but chaining makes the guarantee explicit under any platform and also
    // serializes the fsync boundary below.
    const run = async (): Promise<AppendResult> => {
      await this.ensureInitialized();

      const entry = await this.materialize(input, options);
      const line = `${JSON.stringify(entry)}\n`;

      await appendFile(this.paths.transcriptPath(this.sessionId), line, { encoding: 'utf8' });

      if (isTurnBoundary(entry.type)) {
        await this.fsyncTranscript();
      }

      return {
        id: entry.id,
        timestamp: entry.timestamp,
        ...(entry.type === 'file_history_snapshot' ? { fingerprint: entry.fingerprint } : {}),
      };
    };

    const next = this.chain.then(run, run);
    // Keep the chain alive even on failure so subsequent appends still serialize.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async materialize(
    input: SessionEntryInput,
    options: AppendOptions,
  ): Promise<SessionEntry> {
    const id = input.id ?? randomUUID();
    const timestamp = input.timestamp ?? new Date().toISOString();

    if (input.type === 'file_history_snapshot') {
      // Content-address the body: the caller passes the raw bytes, we compute
      // the fingerprint and write the blob. Identical bodies across turns
      // collapse to one file on disk.
      if (options.fileBody === undefined) {
        throw new Error(
          'file_history_snapshot append requires options.fileBody (the raw file bytes)',
        );
      }
      const body = options.fileBody;
      const fingerprint = computeFingerprint({
        errorCode: 'file',
        stack: undefined,
        message: typeof body === 'string' ? body : body.toString('utf8'),
      });
      await this.writeBlobIfNew(fingerprint, body);

      const entry: SessionEntry = {
        schemaVersion: SCHEMA_VERSION,
        type: 'file_history_snapshot',
        id,
        sessionId: this.sessionId,
        timestamp,
        path: input.path,
        fingerprint,
        byteSize: typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length,
        ...(input.author !== undefined ? { author: input.author } : {}),
      };
      return SessionEntry.parse(entry);
    }

    const base = {
      schemaVersion: SCHEMA_VERSION,
      id,
      sessionId: this.sessionId,
      timestamp,
    };
    return SessionEntry.parse({ ...base, ...input });
  }

  private async writeBlobIfNew(fingerprint: string, body: Buffer | string): Promise<void> {
    const path = this.paths.blobPath(this.sessionId, fingerprint);
    try {
      // `wx` flag fails if the file already exists → idempotent dedupe.
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(body);
      } finally {
        await handle.close();
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return;
      throw err;
    }
  }

  private async fsyncTranscript(): Promise<void> {
    const path = this.paths.transcriptPath(this.sessionId);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, 'r+');
      await handle.sync();
    } catch (err) {
      this.logger.warn('session.writer.fsync_failed', {
        err: err instanceof Error ? err.message : String(err),
        sessionId: this.sessionId,
      });
    } finally {
      if (handle !== undefined) await handle.close();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.paths.sessionDir(this.sessionId), { recursive: true });
    await mkdir(this.paths.filesDir(this.sessionId), { recursive: true });
    // Touch the transcript so fsync targets an existing file.
    const transcript = this.paths.transcriptPath(this.sessionId);
    try {
      const handle = await open(transcript, 'ax');
      await handle.close();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
    }
    this.initialized = true;
  }
}

function isTurnBoundary(type: SessionEntry['type']): boolean {
  // Per story spec: TurnDone is the primary boundary; CustomTitle is also a
  // boundary because users treat "I renamed this session" as a commit point.
  return type === 'turn_done' || type === 'custom_title';
}

/** Convenience helper: many callers want a pre-seeded blob dir without
 *  kicking off an append. Exposed for the IPC layer which lazy-creates a
 *  writer on first `session:open`. */
export async function ensureSessionDir(
  sessionId: string,
  override: PathsOverride = {},
): Promise<void> {
  const paths = resolveSessionPaths(override);
  await mkdir(paths.sessionDir(sessionId), { recursive: true });
  await mkdir(paths.filesDir(sessionId), { recursive: true });
  const transcript = paths.transcriptPath(sessionId);
  try {
    await writeFile(transcript, '', { flag: 'ax' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw err;
  }
}
