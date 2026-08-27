/**
 * GET /api/pty/:id/stream?projectId=... — the Studio terminal's live channel.
 *
 * Same shape as the design turn's `.../stream` route: a replay buffer plus live
 * frames over SSE, resumed with `Last-Event-ID` (or `?afterSeq=`) so a dropped
 * connection heals via EventSource's own reconnect instead of the client
 * re-requesting history by hand. The `exit` frame (emitted on kill) closes the
 * stream from this end too, matching the reference TerminalViewer's contract.
 */
import type { NextRequest } from '../../../../http';
import { findSession, subscribe } from '../../store';

/** Keeps intermediaries and idle-connection reapers from closing a quiet session. */
const HEARTBEAT_MS = 15_000;

function frame(event: string, data: string, id: number): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const projectId = request.nextUrl.searchParams.get('projectId') ?? '';

  const session = findSession(id, projectId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Terminal session not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const header = request.headers.get('last-event-id');
  const afterSeq = Math.max(0, Number(header ?? request.nextUrl.searchParams.get('afterSeq')) || 0);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = subscribe(session, afterSeq, (f) => {
        try {
          controller.enqueue(encoder.encode(frame(f.event, f.data, f.seq)));
          if (f.event === 'exit') controller.close();
        } catch {
          // The client went away mid-write; cancel() below cleans up.
        }
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          /* same */
        }
      }, HEARTBEAT_MS);
      (heartbeat as unknown as { unref?: () => void }).unref?.();
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
