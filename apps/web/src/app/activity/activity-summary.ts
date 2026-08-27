/**
 * Pure rendering-data helpers for the Activity page (M6/M7 — raw internals
 * shown as user copy). Split out of page.tsx because Next.js's typed-route
 * checker rejects a page module exporting anything beyond its known route
 * exports (default, metadata, ...).
 */
import type { ActivityEvent } from '@ligma/api';

/**
 * The event's own `taskId` is already a structured field on `ActivityEvent`
 * — swapping its literal occurrence in `summary` for the task's current
 * title is a join by id, not text-mining meaning out of free text. Some
 * historical events were written with the raw id standing in for a title
 * that was never looked up (M6/M7: `Completed task: task_y1459tiApf09`);
 * this repairs those without touching how new events are written.
 */
export function joinTaskTitle(
  evt: Pick<ActivityEvent, 'summary' | 'taskId'>,
  titleById: Map<string, string>,
): string {
  if (!evt.taskId) return evt.summary;
  const title = titleById.get(evt.taskId);
  if (!title || !evt.summary.includes(evt.taskId)) return evt.summary;
  return evt.summary.split(evt.taskId).join(title);
}

/**
 * The Claude Agent SDK's own transcript shapes: a single `{"result": "..."}`
 * object, or an array of turn events usually ending in one (mirrors the
 * write-side extraction in apps/daemon/src/engine/run-task.ts's
 * `extractSummary`). Reads fields the SDK itself defines — never a regex
 * over the transcript's prose.
 */
export function extractSdkResultText(parsed: unknown): string | null {
  // Shape A: a single `{"result": "..."}` object — no `type` field at all.
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
    const result = (parsed as { result?: unknown }).result;
    if (typeof result === 'string' && result.length > 0) return result;
  }

  // Shape B: an array of turn events, usually ending in one with type "result".
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type?: unknown; result?: unknown } | null;
    if (
      entry &&
      entry.type === 'result' &&
      typeof entry.result === 'string' &&
      entry.result.length > 0
    ) {
      return entry.result;
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as {
      type?: unknown;
      message?: { content?: unknown };
      content?: unknown;
    } | null;
    if (!entry || entry.type !== 'assistant') continue;
    const blocks = (entry.message?.content ?? entry.content) as
      | Array<{ type?: unknown; text?: unknown }>
      | undefined;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    if (text) return text;
  }
  return null;
}

export type DetailsView = { long: boolean; preview: string; full: string; markdown: boolean };

const LONG_DETAILS_THRESHOLD = 240;

/**
 * `details` is free-form: usually the agent's own prose report, occasionally
 * (older events) an entire un-trimmed SDK transcript. `JSON.parse` is the
 * only "parsing" done here — real structure, not a regex reading meaning out
 * of text. A transcript that doesn't parse (several legacy events were
 * truncated mid-object) falls back to its raw text — still capped and
 * wrapped rather than rendered as one unbroken line (M7).
 */
export function summarizeDetails(details: string): DetailsView | null {
  const trimmed = details.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const resultText = extractSdkResultText(parsed);
      if (resultText) {
        return {
          long: resultText.length > LONG_DETAILS_THRESHOLD,
          preview: resultText,
          full: resultText,
          markdown: true,
        };
      }
      const full = JSON.stringify(parsed, null, 2);
      return {
        long: true,
        preview: 'Agent transcript — no human-readable result in it. Raw event payload below.',
        full,
        markdown: false,
      };
    } catch {
      // Truncated mid-object: not real structure, so this falls through to
      // plain text below rather than being parsed as one.
    }
  }

  return {
    long: trimmed.length > LONG_DETAILS_THRESHOLD,
    preview: trimmed,
    full: trimmed,
    markdown: true,
  };
}
