import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { getAdoptionRun } from '../../../../engine/adopt-repo';
import { type NextRequest, NextResponse } from '../../../../http';
import { DATA_DIR } from '../../../../paths';

const OUTPUT_DIR = path.join(DATA_DIR, 'run-outputs');
const ACTIVE_RUNS_FILE = path.join(DATA_DIR, 'active-runs.json');
const MAX_RESPONSE_BYTES = 512_000; // 500KB per request

interface OutputLine {
  ts: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

function isRunDone(runId: string): boolean {
  // An adoption run streams the same JSONL but lives in its own store, so its
  // liveness is read from there — otherwise the viewer stops polling the
  // moment it opens, because no `arun_` row is ever in active-runs.json.
  if (runId.startsWith('arun_')) {
    try {
      return getAdoptionRun(runId)?.status !== 'running';
    } catch {
      return true;
    }
  }
  try {
    if (!existsSync(ACTIVE_RUNS_FILE)) return true;
    const raw = readFileSync(ACTIVE_RUNS_FILE, 'utf-8');
    const data = JSON.parse(raw) as {
      runs: Array<{ id: string; status: string }>;
    };
    const run = data.runs.find((r) => r.id === runId);
    if (!run) return true;
    return run.status !== 'running';
  } catch {
    return true;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  // Sanitize runId
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(OUTPUT_DIR, `${safeId}.jsonl`);

  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: 'Output not found', lines: [], nextOffset: 0, done: true },
      { status: 404 },
    );
  }

  const offsetParam = request.nextUrl.searchParams.get('offset');
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10) || 0);

  const stat = statSync(filePath);
  const fileSize = stat.size;

  if (offset >= fileSize) {
    // No new data — return empty with current offset
    return NextResponse.json({
      lines: [],
      nextOffset: offset,
      done: isRunDone(runId),
    });
  }

  // Read from offset, capped at MAX_RESPONSE_BYTES
  const bytesToRead = Math.min(fileSize - offset, MAX_RESPONSE_BYTES);
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buffer, 0, bytesToRead, offset);
  } finally {
    closeSync(fd);
  }

  const raw = buffer.toString('utf-8');

  // Split into lines, handle partial last line
  const rawLines = raw.split('\n');
  let consumedBytes = 0;
  const lines: OutputLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // Account for the newline delimiter (except last chunk which may not have one)
    const lineBytes = Buffer.byteLength(line, 'utf-8') + (i < rawLines.length - 1 ? 1 : 0);

    if (!line.trim()) {
      consumedBytes += lineBytes;
      continue;
    }

    try {
      const parsed = JSON.parse(line) as OutputLine;
      lines.push(parsed);
      consumedBytes += lineBytes;
    } catch {
      // Incomplete line at the end — don't consume it
      // The next poll will re-read from this offset
      if (i === rawLines.length - 1) {
        break;
      }
      consumedBytes += lineBytes;
    }
  }

  return NextResponse.json({
    lines,
    nextOffset: offset + consumedBytes,
    done: isRunDone(runId),
  });
}
