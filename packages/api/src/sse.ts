/**
 * Server-sent-event shapes.
 *
 * The polling routes (`GET /api/runs/:id/output`) keep their exact request and
 * response shape; the `/stream` sibling pushes the *same* payload as SSE data
 * frames so a client can choose between a poll and a subscription without
 * learning a second wire format.
 */

/** One line of a run's captured output — a record of run-outputs/<id>.jsonl. */
export interface OutputLine {
  ts: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/** Body of `GET /api/runs/:id/output` and of every `output` SSE frame. */
export interface RunOutputChunk {
  lines: OutputLine[];
  nextOffset: number;
  done: boolean;
}

/** SSE event names emitted by the daemon's stream endpoints. */
export const SSE_EVENTS = {
  /** A `RunOutputChunk` with at least one new line. */
  output: 'output',
  /**
   * The run finished; the stream closes after this frame. Same `RunOutputChunk`
   * shape as `output`, but `lines` is always empty — every line was already
   * delivered as an `output` frame, so repeating them here duplicated the tail.
   */
  end: 'end',
  /**
   * The poll behind the stream answered non-2xx — an unknown run id, an
   * unreadable output file. Carries `SseErrorFrame`, and the stream closes
   * after it. Without this frame a 404 `{lines:[],done:true}` arrived as a
   * clean `end` and no client could tell "no such run" from "finished
   * silently" (process audit P14 / codebase D6).
   */
  error: 'error',
} as const;

export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

/** Body of an `error` SSE frame. `status` is the HTTP status the poll returned. */
export interface SseErrorFrame {
  error: string;
  status: number;
}
