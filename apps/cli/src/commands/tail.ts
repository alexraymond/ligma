/**
 * `ligma runs tail <runId>` — prefers the SSE stream
 * (`GET /api/runs/:id/output/stream`), falls back to polling the plain
 * `GET /api/runs/:id/output` (same `RunOutputChunk` payload, `nextOffset`
 * cursor) if the stream can't be opened or breaks mid-read.
 */
import {
  type OutputLine,
  type RunOutputChunk,
  SSE_EVENTS,
  type SseErrorFrame,
  apiPath,
} from '@ligma/api';
import { CliError, daemonJson, daemonRaw } from '../client.js';

const POLL_MS = 1000;

export async function tailRun(baseUrl: string, runId: string, signal: AbortSignal): Promise<void> {
  try {
    await tailViaSse(baseUrl, runId, signal);
  } catch (err) {
    if (signal.aborted || err instanceof CliError) throw err;
    await tailViaPolling(baseUrl, runId, signal);
  }
}

async function tailViaSse(baseUrl: string, runId: string, signal: AbortSignal): Promise<void> {
  const res = await daemonRaw(baseUrl, `${apiPath('runOutputStream', { id: runId })}?offset=0`, {
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE stream unavailable (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;

      // S1: on a non-2xx poll, the daemon ends the stream with an `error`
      // frame (SseErrorFrame) instead of a normal chunk — surface it as a
      // CliError so the caller prints to stderr and exits 1 (no silent
      // "clean end", no falling back to polling against the same failure).
      if (parsed.event === SSE_EVENTS.error) {
        const body = JSON.parse(parsed.data) as Partial<SseErrorFrame>;
        throw new CliError(body.error ?? `Request failed (${body.status ?? 'unknown'})`);
      }

      const chunk = JSON.parse(parsed.data) as RunOutputChunk;
      // The daemon's `end` frame is a close signal carrying no lines
      // (apps/daemon/src/routes/stream.ts) — stop here, don't print it.
      if (parsed.event === SSE_EVENTS.end) return;
      printLines(chunk.lines);
    }
  }
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message';
  const dataParts: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
  }
  return dataParts.length > 0 ? { event, data: dataParts.join('\n') } : null;
}

async function tailViaPolling(baseUrl: string, runId: string, signal: AbortSignal): Promise<void> {
  let offset = 0;
  while (!signal.aborted) {
    const chunk = await daemonJson<RunOutputChunk>(
      baseUrl,
      `${apiPath('runOutput', { id: runId })}?offset=${offset}`,
      { signal },
    );
    offset = chunk.nextOffset;
    printLines(chunk.lines);
    if (chunk.done) return;
    await sleep(POLL_MS, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function printLines(lines: OutputLine[]): void {
  for (const line of lines) {
    const stream = line.stream === 'stderr' ? process.stderr : process.stdout;
    stream.write(line.text.endsWith('\n') ? line.text : `${line.text}\n`);
  }
}
