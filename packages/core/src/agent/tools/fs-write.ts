/**
 * fs-write tool — delegates to the main process via the IPC-ACK
 * contract W1 is introducing at `packages/shared/src/ipc-ack.ts`.
 *
 * Concurrency-safe: false. A write can race the same (or a different)
 * file so orchestration serializes these calls.
 *
 * The injected `WriteFile` callback is the seam where the IPC-ACK
 * round-trip happens in production. In tests a fake map is fine.
 */

// TODO(w1-integration): swap to `import type { FsUpdatedAckV1 } from
//   '@open-codesign/shared';` once W1's shared module lands.
import type { FsUpdatedAckV1 } from '../_stub-ipc-types.js';
import type { Tool, ToolRunContext, ToolRunResult } from './index.js';

export interface FsWriteInput {
  path: string;
  content: string;
}

export type WriteFile = (input: FsWriteInput, ctx: ToolRunContext) => Promise<FsUpdatedAckV1>;

export function makeFsWriteTool(writeFile: WriteFile): Tool {
  return {
    name: 'fs_write',
    isConcurrencySafe(): boolean {
      return false;
    },
    async run(input: unknown, ctx: ToolRunContext): Promise<ToolRunResult> {
      const parsed = parseInput(input);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const ack = await writeFile(parsed.value, ctx);
      if (!ack.ok) {
        return { ok: false, error: ack.error ?? 'fs-write failed' };
      }
      return {
        ok: true,
        result: {
          path: parsed.value.path,
          bytes: parsed.value.content.length,
          seq: ack.seq,
        },
      };
    },
  };
}

function parseInput(
  raw: unknown,
): { ok: true; value: FsWriteInput } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'fs_write: input must be an object' };
  }
  const path = (raw as { path?: unknown }).path;
  const content = (raw as { content?: unknown }).content;
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, error: 'fs_write: path is required' };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'fs_write: content must be a string' };
  }
  return { ok: true, value: { path, content } };
}
