import { readdir, stat } from 'node:fs/promises';
import {
  type AppendOptions,
  type AppendResult,
  type HistoryPage,
  type PathsOverride,
  type ResumedSession,
  type SessionEntryInput,
  SessionReader,
  SessionWriter,
  ensureSessionDir,
  resolveSessionPaths,
  resumeSession,
} from '@ligma/session';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';

const logger = getLogger('session-ipc');

// Keep one writer per sessionId for the lifetime of the main process. The
// writer serializes appends via an internal promise chain, so re-using the
// same instance is how we guarantee no line-interleaving within a session.
const writers = new Map<string, SessionWriter>();

function pathsOverride(): PathsOverride | undefined {
  // Reserved for future: today we always use the default `~/.config/ligma`
  // root. Kept as a seam so a future settings panel can redirect the session
  // root without touching the handlers.
  return undefined;
}

function getOrCreateWriter(sessionId: string): SessionWriter {
  const existing = writers.get(sessionId);
  if (existing !== undefined) return existing;
  const override = pathsOverride();
  const next = new SessionWriter({
    sessionId,
    logger,
    ...(override !== undefined ? { paths: override } : {}),
  });
  writers.set(sessionId, next);
  return next;
}

function parseSessionId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CodesignError('sessionId must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  return raw.trim();
}

interface AppendPayload {
  sessionId: string;
  entry: SessionEntryInput;
  fileBody?: string;
}

function parseAppend(raw: unknown): AppendPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('session:append expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const sessionId = parseSessionId(r['sessionId']);
  const entry = r['entry'];
  if (typeof entry !== 'object' || entry === null) {
    throw new CodesignError('session:append entry must be an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const fileBody = r['fileBody'];
  const out: AppendPayload = {
    sessionId,
    entry: entry as SessionEntryInput,
  };
  if (typeof fileBody === 'string') out.fileBody = fileBody;
  return out;
}

interface FetchOlderPayload {
  sessionId: string;
  beforeId: string;
  limit: number;
}

function parseFetchOlder(raw: unknown): FetchOlderPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'session:fetchOlder expects an object payload',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const sessionId = parseSessionId(r['sessionId']);
  const beforeId = r['beforeId'];
  const limit = r['limit'];
  if (typeof beforeId !== 'string' || beforeId.length === 0) {
    throw new CodesignError(
      'session:fetchOlder beforeId must be a non-empty string',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (!Number.isInteger(limit) || (limit as number) <= 0) {
    throw new CodesignError(
      'session:fetchOlder limit must be a positive integer',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return { sessionId, beforeId, limit: limit as number };
}

interface OpenPayload {
  sessionId: string;
  /** Initial page size for the transcript view. Defaults to 100. */
  limit?: number;
}

function parseOpen(raw: unknown): OpenPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('session:open expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const sessionId = parseSessionId(r['sessionId']);
  const limit = r['limit'];
  const out: OpenPayload = { sessionId };
  if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) out.limit = limit;
  return out;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string | null;
  sizeBytes: number;
}

async function listSessions(): Promise<SessionSummary[]> {
  const paths = resolveSessionPaths(pathsOverride());
  let entries: string[];
  try {
    entries = await readdir(paths.sessionsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  const summaries: SessionSummary[] = [];
  for (const name of entries) {
    const transcriptPath = paths.transcriptPath(name);
    try {
      const st = await stat(transcriptPath);
      summaries.push({
        sessionId: name,
        updatedAt: st.mtime.toISOString(),
        sizeBytes: st.size,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Directory without a transcript — surface as an empty session so
        // callers can still see it exists (and so `session:open` works).
        summaries.push({ sessionId: name, updatedAt: null, sizeBytes: 0 });
        continue;
      }
      logger.warn('session.list.stat_failed', {
        sessionId: name,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Newest first by mtime; null mtimes sort to the end.
  summaries.sort((a, b) => {
    if (a.updatedAt === null && b.updatedAt === null) return 0;
    if (a.updatedAt === null) return 1;
    if (b.updatedAt === null) return -1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return summaries;
}

interface OpenResponse {
  session: ResumedSession;
  page: HistoryPage;
}

async function openSession(input: OpenPayload): Promise<OpenResponse> {
  const override = pathsOverride();
  await ensureSessionDir(input.sessionId, override ?? {});
  const resumed = await resumeSession({
    sessionId: input.sessionId,
    logger,
    ...(override !== undefined ? { paths: override } : {}),
  });
  const reader = new SessionReader({
    sessionId: input.sessionId,
    logger,
    ...(override !== undefined ? { paths: override } : {}),
  });
  const page = await reader.fetchLatest(input.limit ?? 100);
  return { session: resumed, page };
}

async function appendEntry(input: AppendPayload): Promise<AppendResult> {
  const writer = getOrCreateWriter(input.sessionId);
  const opts: AppendOptions = {};
  if (input.fileBody !== undefined) opts.fileBody = input.fileBody;
  return writer.append(input.entry, opts);
}

async function fetchOlder(input: FetchOlderPayload): Promise<HistoryPage> {
  const override = pathsOverride();
  const reader = new SessionReader({
    sessionId: input.sessionId,
    logger,
    ...(override !== undefined ? { paths: override } : {}),
  });
  return reader.fetchOlder(input.beforeId, input.limit);
}

export function registerSessionIpc(): void {
  ipcMain.handle('session:list', async (): Promise<SessionSummary[]> => listSessions());

  ipcMain.handle('session:open', async (_e, raw: unknown): Promise<OpenResponse> => {
    return openSession(parseOpen(raw));
  });

  ipcMain.handle('session:append', async (_e, raw: unknown): Promise<AppendResult> => {
    return appendEntry(parseAppend(raw));
  });

  ipcMain.handle('session:fetchOlder', async (_e, raw: unknown): Promise<HistoryPage> => {
    return fetchOlder(parseFetchOlder(raw));
  });
}
