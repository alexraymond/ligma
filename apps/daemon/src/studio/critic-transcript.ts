/**
 * The durable record of a critique run — what the critique lane's Replay
 * control plays back.
 *
 * `events.ts`'s ring buffer is reconnect coverage for the *live* SSE stream
 * (W-22 waiver) — bounded, in-memory, and gone once the process restarts.
 * This is the transcript: one `.ndjson` file per run (one `DesignCriticEvent`
 * per line), written when the pass finishes, inside the design's own
 * directory — never inside `src/`, same as `design.json` and `blobs/`
 * (`./paths`'s layout note).
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignCriticEvent } from '@ligma/api';
import { assertSafeId, designDir } from './paths';

function transcriptsDir(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'critiques');
}

function transcriptPath(projectId: string, designId: string, turnId: string): string {
  return path.join(transcriptsDir(projectId, designId), `${assertSafeId('turnId', turnId)}.ndjson`);
}

/** Write a run's whole event stream, one JSON object per line. */
export async function writeCritiqueTranscript(
  projectId: string,
  designId: string,
  turnId: string,
  events: DesignCriticEvent[],
): Promise<void> {
  const file = transcriptPath(projectId, designId, turnId);
  await mkdir(path.dirname(file), { recursive: true });
  const body = events.map((event) => JSON.stringify(event)).join('\n');
  await writeFile(file, body.length > 0 ? `${body}\n` : '', 'utf-8');
}

/**
 * The most recently written transcript for a design — what "Replay" plays.
 * Ordered by file mtime rather than `turnId`: turn ids (`generateId("dt")`)
 * are not guaranteed sortable, and a design only ever has one critique run
 * writing a transcript at a time. Returns null for a design that has never
 * completed a critique pass.
 */
export async function readLatestCritiqueTranscript(
  projectId: string,
  designId: string,
): Promise<{ turnId: string; events: DesignCriticEvent[] } | null> {
  const dir = transcriptsDir(projectId, designId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.ndjson'));
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  const withMtime = await Promise.all(
    names.map(async (name) => ({ name, mtimeMs: (await stat(path.join(dir, name))).mtimeMs })),
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = withMtime[0]!;
  const turnId = latest.name.slice(0, -'.ndjson'.length);
  const events = parseNdjson(await readFile(path.join(dir, latest.name), 'utf-8'));
  return { turnId, events };
}

function parseNdjson(raw: string): DesignCriticEvent[] {
  const out: DesignCriticEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as DesignCriticEvent);
    } catch {
      // A bad line is recoverable — the writer is one write per run, so this
      // only guards against a hand-edited or truncated file.
    }
  }
  return out;
}
