/**
 * `GET /api/runs/:id/output/stream` — the SSE sibling of the polling route.
 *
 * Added, never substituted: `/api/runs/:id/output` keeps its exact request and
 * response shape, and this endpoint pushes the *same* `RunOutputChunk` payload
 * as `output` frames by calling that same handler on a timer. One reader of the
 * .jsonl file, so the two can never disagree.
 */
import { type RunOutputChunk, SSE_EVENTS, type SseErrorFrame } from '@ligma/api';
import { DaemonRequest, type NextRequest } from '../http';
import { GET as pollOutput } from './runs/_id/output/route';

const POLL_MS = 1000;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
): Promise<Response> {
  const { id } = await params;
  const runId = id ?? '';
  let offset = Math.max(0, Number(request.nextUrl.searchParams.get('offset')) || 0);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let inFlight = false;
      const tick = async (): Promise<void> => {
        if (inFlight) return;
        inFlight = true;
        try {
          const url = `http://127.0.0.1/api/runs/${encodeURIComponent(runId)}/output?offset=${offset}`;
          const response = await pollOutput(new DaemonRequest(url), {
            params: Promise.resolve({ id: runId }),
          });
          // A non-2xx poll is a failure, not an end. The 404 for an unknown run
          // id carries `done: true`, so without this branch it left as a clean
          // `end` frame and `ligma runs tail run_typo` exited 0 with no output
          // (P14/D6). Same body the poll returned, plus its status.
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: unknown };
            const payload: SseErrorFrame = {
              error:
                typeof body.error === 'string'
                  ? body.error
                  : `run output request failed (${response.status})`,
              status: response.status,
            };
            controller.enqueue(encoder.encode(frame(SSE_EVENTS.error, payload)));
            if (timer) clearInterval(timer);
            controller.close();
            return;
          }
          const chunk = (await response.json()) as RunOutputChunk;
          offset = chunk.nextOffset;
          if (chunk.lines.length > 0) {
            controller.enqueue(encoder.encode(frame(SSE_EVENTS.output, chunk)));
          }
          if (chunk.done) {
            // Same shape, no repeat: `end` is a close signal, and the lines it
            // used to carry had already gone out as an `output` frame. A client
            // that renders every frame it receives printed the tail twice.
            controller.enqueue(encoder.encode(frame(SSE_EVENTS.end, { ...chunk, lines: [] })));
            if (timer) clearInterval(timer);
            controller.close();
          }
        } catch (err) {
          if (timer) clearInterval(timer);
          controller.error(err);
        } finally {
          inFlight = false;
        }
      };
      timer = setInterval(() => void tick(), POLL_MS);
      void tick();
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

/** Mounted by routes/index.ts under API_ROUTES.runOutputStream. */
export const runOutputStream = { GET };
