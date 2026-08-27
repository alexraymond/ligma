import { DEFAULT_CONNECTING_TIMEOUT_MS, connectingTimedOut } from '@/components/waiting-status';
/**
 * `connectionWaitingState` — the Wall's mapping from `useDesign`'s connection
 * tracking to the shared waiting vocabulary (mechanics F9: "the Wall's SSE
 * stream could die with no visible sign"). DOM-free; the gesture machinery and
 * card rendering already have their own coverage (`gesture.test.ts`), this
 * file only exercises the connection-state addition.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DesignConnectionState } from './use-design';
import { connectionWaitingState } from './wall';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

describe('connectionWaitingState', () => {
  it('maps a never-opened stream to connecting, carrying the reconnect callback', () => {
    const onReconnect = vi.fn();
    const connection: DesignConnectionState = {
      kind: 'connecting',
      since: new Date(NOW - 1000).toISOString(),
    };
    const state = connectionWaitingState(connection, onReconnect);
    expect(state).toEqual({ kind: 'connecting', since: connection.since, onRetry: onReconnect });
  });

  it('escalates a long-connecting stream the same way every other connecting badge does (F9 shares the vocabulary, not a Wall-only copy)', () => {
    const connection: DesignConnectionState = {
      kind: 'connecting',
      since: new Date(NOW - (DEFAULT_CONNECTING_TIMEOUT_MS + 1)).toISOString(),
    };
    const state = connectionWaitingState(connection);
    expect(connectingTimedOut(state as Extract<typeof state, { kind: 'connecting' }>, NOW)).toBe(
      true,
    );
  });

  it('maps a stream that died after being live to stalled, with no retry field (auto-reconnect owns that case)', () => {
    const connection: DesignConnectionState = {
      kind: 'stalled',
      since: new Date(NOW - 5 * 60_000).toISOString(),
    };
    const state = connectionWaitingState(connection, vi.fn());
    expect(state).toEqual({ kind: 'stalled', since: connection.since });
  });
});
