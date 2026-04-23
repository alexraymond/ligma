/**
 * fs-read tool — delegates to the main process via the IPC-ACK contract
 * W1 is introducing at `packages/shared/src/ipc-ack.ts`. Until that
 * lands the stub at `../_stub-ipc-types.ts` keeps the shapes typed.
 *
 * The core package has no Electron dependency, so the main-process
 * bridge is injected as `ReadFile`. That keeps the tool testable in
 * isolation (pass a fake) and keeps the core package off the renderer
 * / main boundary.
 *
 * Concurrency-safe: true. Read-only by contract.
 */

// TODO(w1-integration): when W1 lands, replace this stub import with
//   `import type { FsViewAckV1 } from '@open-codesign/shared';`
// and delete packages/core/src/agent/_stub-ipc-types.ts.
import type { FsViewAckV1 } from '../_stub-ipc-types.js';
import type { Tool, ToolRunContext, ToolRunResult } from './index.js';

export interface FsReadInput {
  path: string;
  /** 1-indexed inclusive `[start, end]`. `end = -1` => EOF. */
  viewRange?: [number, number];
}

export type ReadFile = (
  input: FsReadInput,
  ctx: ToolRunContext,
) => Promise<FsViewAckV1>;

export function makeFsReadTool(readFile: ReadFile): Tool {
  return {
    name: 'fs_read',
    isConcurrencySafe(): boolean {
      return true;
    },
    async run(input: unknown, ctx: ToolRunContext): Promise<ToolRunResult> {
      const parsed = parseInput(input);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const ack = await readFile(parsed.value, ctx);
      if (!ack.ok) {
        return {
          ok: false,
          error: ack.error ?? 'fs-read failed',
        };
      }
      return {
        ok: true,
        result: {
          path: parsed.value.path,
          content: ack.content ?? '',
          numLines: ack.numLines ?? 0,
        },
      };
    },
  };
}

function parseInput(
  raw: unknown,
): { ok: true; value: FsReadInput } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'fs_read: input must be an object' };
  }
  const path = (raw as { path?: unknown }).path;
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, error: 'fs_read: path is required' };
  }
  const range = (raw as { viewRange?: unknown }).viewRange;
  if (range === undefined) {
    return { ok: true, value: { path } };
  }
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    typeof range[0] !== 'number' ||
    typeof range[1] !== 'number'
  ) {
    return { ok: false, error: 'fs_read: viewRange must be [number, number]' };
  }
  return {
    ok: true,
    value: { path, viewRange: [range[0], range[1]] },
  };
}
