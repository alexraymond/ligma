/**
 * Concurrency-safe tool orchestration.
 *
 * Mirrors the Claude Code pattern in
 * `services/tools/toolOrchestration.ts`:
 *
 *   1. Walk the tool-call list and partition into contiguous batches
 *      whose members share a concurrency-safe flag.
 *   2. Read-only batches run with `Promise.all()` capped at
 *      LIGMA_MAX_TOOL_USE_CONCURRENCY (default 10).
 *   3. Mutating batches serialize — one call at a time.
 *   4. A failing tool in a read-only batch does NOT poison the batch;
 *      every other call still resolves. The failure surfaces as a
 *      per-call `ToolRunResult { ok: false, error }`.
 *   5. The caller's AbortSignal propagates into every in-flight tool
 *      via `ctx.signal`. Post-abort batches are skipped and reported as
 *      `{ ok: false, error: 'aborted' }` so callers can emit clean
 *      ToolEnd events without losing the correlation id.
 *
 * Result ordering matches the input tool-call order, NOT execution
 * order. Callers that need real-time visibility should consume the
 * `onProgress` callback — `batchAndRun` still returns the full array
 * once the run (or its abort) settles.
 */

import type { Tool, ToolCall, ToolRegistry, ToolRunResult } from './index.js';

const DEFAULT_MAX_CONCURRENCY = 10;

function resolveMaxConcurrency(): number {
  const raw = process.env['LIGMA_MAX_TOOL_USE_CONCURRENCY'];
  if (raw === undefined || raw === '') return DEFAULT_MAX_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CONCURRENCY;
  return parsed;
}

interface Batch {
  concurrencySafe: boolean;
  calls: ToolCall[];
}

export function partitionToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
): Batch[] {
  const batches: Batch[] = [];
  for (const call of toolCalls) {
    const tool = registry.get(call.name);
    const safe = safeIsConcurrencySafe(tool, call.input);
    const last = batches[batches.length - 1];
    if (last && last.concurrencySafe && safe) {
      last.calls.push(call);
      continue;
    }
    batches.push({ concurrencySafe: safe, calls: [call] });
  }
  return batches;
}

function safeIsConcurrencySafe(tool: Tool | undefined, input: unknown): boolean {
  if (!tool) return false;
  try {
    return Boolean(tool.isConcurrencySafe(input));
  } catch {
    return false;
  }
}

export interface BatchAndRunOptions {
  signal?: AbortSignal;
  /** Override the concurrency cap. Defaults to the value of the
   *  `LIGMA_MAX_TOOL_USE_CONCURRENCY` environment variable, or 10. */
  maxConcurrency?: number;
  /** Called as each individual tool call starts and ends. Lets the
   *  agent loop yield `tool_start` / `tool_end` events in real time
   *  while still returning the ordered result array. */
  onStart?: (call: ToolCall) => void;
  onEnd?: (call: ToolCall, result: ToolRunResult, durationMs: number) => void;
}

export interface BatchAndRunResult {
  call: ToolCall;
  result: ToolRunResult;
  durationMs: number;
}

export async function batchAndRun(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  options: BatchAndRunOptions = {},
): Promise<BatchAndRunResult[]> {
  const signal = options.signal ?? new AbortController().signal;
  const cap = options.maxConcurrency ?? resolveMaxConcurrency();
  const batches = partitionToolCalls(toolCalls, registry);

  const results: BatchAndRunResult[] = new Array(toolCalls.length);
  let idx = 0;

  for (const batch of batches) {
    if (signal.aborted) {
      for (const call of batch.calls) {
        const record: BatchAndRunResult = {
          call,
          result: { ok: false, error: 'aborted' },
          durationMs: 0,
        };
        results[idx++] = record;
        options.onEnd?.(call, record.result, 0);
      }
      continue;
    }
    if (batch.concurrencySafe) {
      const slice = await runConcurrent(batch.calls, registry, cap, signal, options);
      for (const item of slice) {
        results[idx++] = item;
      }
    } else {
      for (const call of batch.calls) {
        if (signal.aborted) {
          const record: BatchAndRunResult = {
            call,
            result: { ok: false, error: 'aborted' },
            durationMs: 0,
          };
          results[idx++] = record;
          options.onEnd?.(call, record.result, 0);
          continue;
        }
        results[idx++] = await runOne(call, registry, signal, options);
      }
    }
  }

  return results;
}

async function runConcurrent(
  calls: ToolCall[],
  registry: ToolRegistry,
  cap: number,
  signal: AbortSignal,
  options: BatchAndRunOptions,
): Promise<BatchAndRunResult[]> {
  const results: BatchAndRunResult[] = new Array(calls.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= calls.length) return;
      const call = calls[i];
      if (!call) return;
      results[i] = await runOne(call, registry, signal, options);
    }
  };

  const workerCount = Math.min(cap, calls.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function runOne(
  call: ToolCall,
  registry: ToolRegistry,
  signal: AbortSignal,
  options: BatchAndRunOptions,
): Promise<BatchAndRunResult> {
  options.onStart?.(call);
  const started = nowMs();
  if (signal.aborted) {
    const aborted: ToolRunResult = { ok: false, error: 'aborted' };
    const durationMs = nowMs() - started;
    options.onEnd?.(call, aborted, durationMs);
    return { call, result: aborted, durationMs };
  }
  const tool = registry.get(call.name);
  if (!tool) {
    const missing: ToolRunResult = {
      ok: false,
      error: `unknown tool: ${call.name}`,
    };
    const durationMs = nowMs() - started;
    options.onEnd?.(call, missing, durationMs);
    return { call, result: missing, durationMs };
  }
  let result: ToolRunResult;
  try {
    result = await tool.run(call.input, { signal });
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const durationMs = nowMs() - started;
  options.onEnd?.(call, result, durationMs);
  return { call, result, durationMs };
}

function nowMs(): number {
  // performance.now is monotonic and available in Node >=16 and browsers;
  // falling back to Date.now keeps the function usable in isolated test
  // environments that stub `performance`.
  const g = globalThis as { performance?: { now(): number } };
  return g.performance?.now?.() ?? Date.now();
}

export const CONCURRENCY_CAP_DEFAULT = DEFAULT_MAX_CONCURRENCY;
