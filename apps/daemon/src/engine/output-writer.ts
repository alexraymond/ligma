import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import type { WriteStream } from 'node:fs';
import path from 'node:path';
import { logger } from './logger';
import { scrubCredentials } from './security';

/**
 * MC_RUN_OUTPUTS_DIR redirects the whole convention — the same escape hatch the
 * quota governor has. prune() DELETES files here, so a test that constructs a
 * real Dispatcher must be able to point it somewhere throwaway instead of
 * shredding real run evidence.
 */
import { DATA_DIR } from '../paths';
const OUTPUT_DIR = process.env.MC_RUN_OUTPUTS_DIR ?? path.join(DATA_DIR, 'run-outputs');

/** This run's file, with the id sanitized so it can never traverse out. */
function outputFile(runId: string): string {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  return path.join(OUTPUT_DIR, `${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);
}

/** One line of the append-only log, credentials scrubbed. */
function jsonl(stream: 'stdout' | 'stderr', chunk: string): string {
  return `${JSON.stringify({ ts: new Date().toISOString(), stream, text: scrubCredentials(chunk) })}\n`;
}

/**
 * Append-only JSONL writer for capturing run output.
 * Each line: { ts: string, stream: "stdout"|"stderr", text: string }
 */
export class OutputWriter {
  private stream: WriteStream | null = null;
  readonly filePath: string;

  constructor(runId: string) {
    this.filePath = outputFile(runId);
    this.stream = createWriteStream(this.filePath, { flags: 'a', encoding: 'utf-8' });
  }

  /** Append a scrubbed output chunk as a JSONL line. */
  append(stream: 'stdout' | 'stderr', chunk: string): void {
    if (!this.stream) return;
    this.stream.write(jsonl(stream, chunk));
  }

  /**
   * One-shot append, on disk before it returns.
   *
   * For producers that emit a handful of lines around a long await rather than
   * a stream — an adoption run's facts, recipe and error — where keeping a
   * write stream open across the whole run buys nothing and the asynchronous
   * flush of `close()` means the last line may not have landed yet.
   */
  static appendSync(runId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    if (!chunk) return;
    appendFileSync(outputFile(runId), jsonl(stream, chunk), 'utf-8');
  }

  /** Flush and close the file handle. */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  /** Delete output files older than maxAgeMs (default: 72 hours). */
  static prune(maxAgeMs: number): void {
    if (!existsSync(OUTPUT_DIR)) return;

    const now = Date.now();
    let pruned = 0;

    try {
      for (const file of readdirSync(OUTPUT_DIR)) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(OUTPUT_DIR, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            unlinkSync(filePath);
            pruned++;
          }
        } catch {
          // Skip files we can't stat/delete
        }
      }
    } catch {
      // Directory read failed
    }

    if (pruned > 0) {
      logger.info(
        'output-writer',
        `Pruned ${pruned} output file(s) older than ${Math.round(maxAgeMs / 3600000)}h`,
      );
    }
  }
}
