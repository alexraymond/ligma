/**
 * The durable record of the studio conversation — what the composer column
 * shows, and what it still shows after a reload.
 *
 * Storage follows `critic-transcript.ts`: one `.ndjson` file per design,
 * inside the design's own directory, never inside `src/` (`./paths`'s layout
 * note) so the generation agent cannot rewrite what it said. It differs in one
 * respect, deliberately: the critic writes its whole run in one go when the
 * pass ends, but a design turn takes minutes and the user is watching it, so
 * this **appends per event** as the stream yields. At one turn per minute and
 * a few hundred entries per turn that is a handful of kilobytes of appends —
 * cheaper than the machinery a batching writer would need, and it means a
 * daemon that dies mid-turn still leaves everything said up to that moment.
 *
 * The unit on disk is an *append record* (`DesignTranscriptEntry`), not a
 * message: prose arrives a chunk at a time and a tool's status changes after
 * it started. The same record is what goes over SSE, so the live pane and the
 * reloaded pane fold identical input through one reducer on the web side.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DESIGN_SSE_EVENTS,
  type DesignTranscriptEntry,
  type DesignTranscriptPart,
  type DesignTranscriptRole,
  type DesignTurnDoneEvent,
} from '@ligma/api';
import { emitStudio } from './events';
import { designDir } from './paths';

/**
 * Per-part size cap. Thinking is the reason this exists: a single reasoning
 * block can run to tens of kilobytes, and both the SSE frame and the pane have
 * to stay sane. `prompt.ts` truncates pinned HTML the same way — cut, mark, move on.
 */
export const TRANSCRIPT_PART_LIMIT = 4000;

/** A tool card is one line; anything longer is a paragraph pretending to be one. */
const SUMMARY_LIMIT = 120;

/**
 * Prose is coalesced into blocks of about this size before it is appended.
 *
 * Not an optimisation: `events.ts` keeps a 256-frame replay ring per design so
 * a client that connects just after POSTing a turn still sees the first file
 * writes. One frame per text delta would push every file-progress frame out of
 * that ring within seconds, and the Wall would stop drawing progressively.
 */
const FLUSH_CHARS = 400;

function truncate(value: string, limit: number): { text: string; truncated: boolean } {
  return value.length > limit
    ? { text: `${value.slice(0, limit)}…`, truncated: true }
    : { text: value, truncated: false };
}

/** Idempotent: applying it to an already-capped part changes nothing. */
export function capPart(part: DesignTranscriptPart): DesignTranscriptPart {
  if (part.kind === 'text' || part.kind === 'thinking') {
    const cut = truncate(part.text, TRANSCRIPT_PART_LIMIT);
    return { kind: part.kind, text: cut.text, truncated: part.truncated || cut.truncated };
  }
  if (part.kind === 'tool') {
    return { ...part, summary: truncate(part.summary.split('\n')[0] ?? '', SUMMARY_LIMIT).text };
  }
  return part;
}

export function transcriptFilePath(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'transcript.ndjson');
}

/** Append one entry. The part is capped here as well as at the producer. */
export async function appendTranscriptEntry(
  projectId: string,
  designId: string,
  entry: DesignTranscriptEntry,
): Promise<void> {
  const file = transcriptFilePath(projectId, designId);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ ...entry, part: capPart(entry.part) })}\n`, 'utf-8');
}

/** Every entry a design has recorded, oldest first. Empty for a fresh design. */
export async function readTurnTranscript(
  projectId: string,
  designId: string,
): Promise<DesignTranscriptEntry[]> {
  let raw: string;
  try {
    raw = await readFile(transcriptFilePath(projectId, designId), 'utf-8');
  } catch {
    return [];
  }
  const out: DesignTranscriptEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as DesignTranscriptEntry);
    } catch {
      // A truncated tail (the daemon died mid-append) costs one entry, not the
      // whole conversation — the same tolerance `critic-transcript.ts` takes.
    }
  }
  return out;
}

// ─── The recorder ────────────────────────────────────────────────────────────

/** The one-line summary a tool call gets on its card. */
function toolSummary(toolName: string, input: unknown): string {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (typeof record.path === 'string' && record.path !== '') return record.path;
  if (
    toolName === 'declare_tweak_schema' &&
    record.schema !== null &&
    typeof record.schema === 'object'
  ) {
    return `${Object.keys(record.schema as object).length} token(s)`;
  }
  if (toolName === 'list_files') return 'the design source';
  return '';
}

export interface TurnRecorder {
  /** The prompt that opened the turn — the transcript's user message. */
  user(text: string): Promise<void>;
  /** Reference images that came with the prompt, echoed on the same message. */
  attachments(names: string[]): Promise<void>;
  text(delta: string): void;
  thinking(delta: string): void;
  toolStart(toolUseId: string, toolName: string, input: unknown): void;
  toolEnd(toolUseId: string, toolName: string, input: unknown, ok: boolean, detail?: string): void;
  /** Flush, record the files produced and how the turn ended, then settle. */
  finish(
    stopReason: DesignTurnDoneEvent['stopReason'],
    error: string | null,
    filesProduced: string[],
  ): Promise<void>;
}

/**
 * Persist-and-forward for one turn.
 *
 * Every entry goes to disk *and* to the SSE channel, from one call site, so
 * the two can never disagree about what was said. Writes are serialised
 * through a promise chain because `appendFile` from several overlapping calls
 * has no ordering guarantee, and a transcript out of order is a transcript
 * that lies about what happened first.
 */
export function createTurnRecorder(
  projectId: string,
  designId: string,
  turnId: string,
): TurnRecorder {
  let chain: Promise<void> = Promise.resolve();
  let buffer = '';
  let bufferKind: 'text' | 'thinking' | null = null;

  const append = (role: DesignTranscriptRole, part: DesignTranscriptPart): void => {
    const entry: DesignTranscriptEntry = {
      designId,
      turnId,
      role,
      at: new Date().toISOString(),
      part: capPart(part),
    };
    emitStudio(designId, DESIGN_SSE_EVENTS.transcript, entry);
    chain = chain
      .then(() => appendTranscriptEntry(projectId, designId, entry))
      .catch(() => {
        // A transcript that cannot be written must not take the turn down with
        // it — the design itself is recorded by the manifest and the blob store.
      });
  };

  const flush = (): void => {
    const kind = bufferKind;
    const text = buffer;
    bufferKind = null;
    buffer = '';
    if (kind === null || text === '') return;
    // Prose is *split* at the cap, never truncated: a provider that yields a
    // whole block at once (the Claude SDK's `mapSdkStream` does) can hand over
    // more than one part's worth, and losing the tail of what the designer
    // said would be the same silence this transcript exists to end. Thinking
    // takes the cap instead — one reasoning block can run to tens of
    // kilobytes, and the pane shows it collapsed anyway.
    if (kind === 'thinking') {
      append('designer', { kind, text, truncated: false });
      return;
    }
    for (let i = 0; i < text.length; i += TRANSCRIPT_PART_LIMIT) {
      append('designer', {
        kind,
        text: text.slice(i, i + TRANSCRIPT_PART_LIMIT),
        truncated: false,
      });
    }
  };

  const chunk = (kind: 'text' | 'thinking', delta: string): void => {
    if (delta === '') return;
    if (bufferKind !== null && bufferKind !== kind) flush();
    bufferKind = kind;
    buffer += delta;
    if (buffer.length >= FLUSH_CHARS) flush();
  };

  return {
    async user(text) {
      append('user', { kind: 'text', text, truncated: false });
      await chain;
    },
    async attachments(names) {
      if (names.length === 0) return;
      append('user', { kind: 'attachments', names });
      await chain;
    },
    text: (delta) => chunk('text', delta),
    thinking: (delta) => chunk('thinking', delta),
    toolStart(toolUseId, toolName, input) {
      flush();
      append('designer', {
        kind: 'tool',
        toolUseId,
        toolName,
        summary: toolSummary(toolName, input),
        status: 'running',
      });
    },
    toolEnd(toolUseId, toolName, input, ok, detail) {
      flush();
      append('designer', {
        kind: 'tool',
        toolUseId,
        toolName,
        summary: ok ? toolSummary(toolName, input) : (detail ?? toolSummary(toolName, input)),
        status: ok ? 'ok' : 'error',
      });
    },
    async finish(stopReason, error, filesProduced) {
      flush();
      if (filesProduced.length > 0) append('designer', { kind: 'files', paths: filesProduced });
      append('designer', { kind: 'done', stopReason, error });
      await chain;
    },
  };
}
