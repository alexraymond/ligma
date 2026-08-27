/**
 * GET /api/projects/:id/designs/:did/stream — the Studio's live channel.
 *
 * File progress, critic events and status transitions all arrive here. The
 * Wall's progressive render feeds off the file-progress frames, so the stream
 * replays the recent buffer on connect: a client that subscribes just after
 * POSTing a turn must not lose the first writes to the connect gap, or the
 * design appears to hang until the second file lands.
 *
 * `Last-Event-ID` (or `?afterSeq=`) resumes from a known point, which is the
 * standard EventSource reconnect contract — the browser sends the header by
 * itself, so a dropped connection heals without the UI doing anything.
 */

import { DESIGN_SSE_EVENTS } from '@ligma/api';
import type { NextRequest } from '../../../../../../http';
import { type StudioFrame, subscribeStudio } from '../../../../../../studio/events';
import { isTurnInFlight } from '../../../../../../studio/session';

/** Keeps intermediaries and idle-connection reapers from closing a quiet turn. */
const HEARTBEAT_MS = 15_000;

function frame(event: string, data: unknown, id: number): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { did } = await params;
  const header = request.headers.get('last-event-id');
  const afterSeq = Math.max(0, Number(header ?? request.nextUrl.searchParams.get('afterSeq')) || 0);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (studioFrame: StudioFrame): void => {
        try {
          controller.enqueue(
            encoder.encode(frame(studioFrame.event, studioFrame.data, studioFrame.seq)),
          );
        } catch {
          // The client went away mid-write; cancel() will clean up.
        }
      };
      unsubscribe = subscribeStudio(did, send, afterSeq);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          /* same */
        }
      }, HEARTBEAT_MS);
      if (typeof heartbeat === 'object' && 'unref' in heartbeat) {
        (heartbeat as { unref?: () => void }).unref?.();
      }

      // A design with nothing running gets told so immediately, so the UI can
      // render a settled state instead of an eternal spinner.
      if (!isTurnInFlight(did)) {
        controller.enqueue(
          encoder.encode(frame(DESIGN_SSE_EVENTS.status, { designId: did, idle: true }, 0)),
        );
      }
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
      // Proxies that buffer defeat the entire point of a progressive render.
      'x-accel-buffering': 'no',
    },
  });
}
