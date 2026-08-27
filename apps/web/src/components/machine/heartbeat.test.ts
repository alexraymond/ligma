/**
 * `heartbeatState` — pure derivation, no DOM (this repo's vitest is node-only).
 * Pins the precedence the merged heartbeat depends on: an unreachable daemon
 * outranks everything (nothing it reports can be trusted), and a live kill
 * switch outranks the engine's own running/starting/stopped status.
 */
import { describe, expect, it } from 'vitest';
import { type HeartbeatDaemonStatus, heartbeatState } from './heartbeat';

function status(overrides: Partial<HeartbeatDaemonStatus> = {}): HeartbeatDaemonStatus {
  return { status: 'running', activeSessions: [], ...overrides };
}

describe('heartbeatState', () => {
  it("is unreachable when the poll can't be trusted, regardless of last-known status", () => {
    expect(heartbeatState(status({ status: 'running' }), false)).toBe('unreachable');
    expect(
      heartbeatState(status({ status: 'stopped', governor: { killSwitch: true } }), false),
    ).toBe('unreachable');
  });

  it('is kill-switch-on when the kill switch is set, even while the engine reports running', () => {
    expect(
      heartbeatState(status({ status: 'running', governor: { killSwitch: true } }), true),
    ).toBe('kill-switch-on');
  });

  it("passes through the engine's own status once reachable and the kill switch is off", () => {
    expect(heartbeatState(status({ status: 'running' }), true)).toBe('running');
    expect(heartbeatState(status({ status: 'stopped' }), true)).toBe('stopped');
    expect(heartbeatState(status({ status: 'starting' }), true)).toBe('starting');
  });

  it('treats a missing governor block the same as a governor with the switch off', () => {
    expect(heartbeatState(status({ status: 'running', governor: undefined }), true)).toBe(
      'running',
    );
  });
});
