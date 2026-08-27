/**
 * The in-process event bus behind `GET .../designs/:did/stream`.
 *
 * A turn is accepted by one request and watched by another, so there is always
 * a gap between "POST /turn returned" and "the client's EventSource is
 * connected". Without a replay buffer the first file-progress frames — the ones
 * that make the Wall start drawing — fall into that gap, and the design appears
 * to hang until the second file lands. So each design keeps a small ring of
 * recent frames and a new subscriber is caught up before it goes live.
 *
 * The buffer is bounded and per-design; it is a race fix, not a transcript. The
 * durable record of a turn is `design.json` and the blob store.
 */

import { EventEmitter } from 'node:events';
import type { DesignSseEventName } from '@ligma/api';

export interface StudioFrame {
  event: DesignSseEventName;
  data: unknown;
  /** Monotonic per design — the SSE `id:` field, so a reconnect can resume. */
  seq: number;
}

/** Enough to cover the connect gap for a busy multi-file turn. */
const REPLAY_LIMIT = 256;

interface Channel {
  emitter: EventEmitter;
  replay: StudioFrame[];
  seq: number;
}

const channels = new Map<string, Channel>();

function channelFor(designId: string): Channel {
  let channel = channels.get(designId);
  if (!channel) {
    channel = { emitter: new EventEmitter(), replay: [], seq: 0 };
    // A design with several watchers (Wall + rail + critique lane) is normal.
    channel.emitter.setMaxListeners(0);
    channels.set(designId, channel);
  }
  return channel;
}

export function emitStudio(
  designId: string,
  event: DesignSseEventName,
  data: unknown,
): StudioFrame {
  const channel = channelFor(designId);
  channel.seq += 1;
  const frame: StudioFrame = { event, data, seq: channel.seq };
  channel.replay.push(frame);
  if (channel.replay.length > REPLAY_LIMIT) channel.replay.shift();
  channel.emitter.emit('frame', frame);
  return frame;
}

/**
 * Subscribe to a design's frames, replaying anything after `afterSeq` first.
 *
 * Pass `afterSeq: 0` (the default) to receive the whole retained buffer — the
 * right choice for a fresh Wall, which wants the turn so far. Returns the
 * unsubscribe function.
 */
export function subscribeStudio(
  designId: string,
  listener: (frame: StudioFrame) => void,
  afterSeq = 0,
): () => void {
  const channel = channelFor(designId);
  for (const frame of channel.replay) {
    if (frame.seq > afterSeq) listener(frame);
  }
  channel.emitter.on('frame', listener);
  return () => channel.emitter.off('frame', listener);
}

/** Drop a design's channel — called when a design is deleted, and by tests. */
export function resetStudioChannel(designId: string): void {
  channels.delete(designId);
}
