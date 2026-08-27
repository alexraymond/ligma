import type { GovernorStatus } from '@/hooks/use-daemon';
/**
 * `governorDenyReason` — the machine overlay's honest "why won't spawns
 * happen" sentence. Pins the priority order the fields themselves imply: a
 * total kill switch outranks a disabled governor (which isn't gating
 * anything, so nothing past it is relevant), which outranks the window being
 * exhausted, which outranks a single cooling backend.
 */
import { describe, expect, it } from 'vitest';
import { governorDenyReason } from './machine-overlay';

function governor(overrides: Partial<GovernorStatus> = {}): GovernorStatus {
  return {
    enabled: true,
    windowHours: 5,
    used: 10,
    max: 40,
    reserveFloor: 8,
    remainingForAutonomy: 22,
    backends: { claude: { state: 'ready', coolingUntil: null } },
    killSwitch: false,
    ...overrides,
  };
}

describe('governorDenyReason', () => {
  it("reports no governor state when the daemon hasn't reported yet", () => {
    expect(governorDenyReason(undefined).code).toBe('no-governor');
  });

  it('leads with the kill switch even when other fields would also block', () => {
    const reason = governorDenyReason(
      governor({ killSwitch: true, enabled: false, remainingForAutonomy: 0 }),
    );
    expect(reason.code).toBe('kill-switch');
    expect(reason.message).toMatch(/kill switch/i);
  });

  it('reports a disabled governor before checking the window', () => {
    const reason = governorDenyReason(governor({ enabled: false, remainingForAutonomy: 0 }));
    expect(reason.code).toBe('disabled');
    expect(reason.message).toMatch(/disabled/i);
  });

  it('reports an exhausted window before a cooling backend', () => {
    const reason = governorDenyReason(
      governor({
        remainingForAutonomy: 0,
        backends: { claude: { state: 'cooling', coolingUntil: '2026-08-14T12:00:00Z' } },
      }),
    );
    expect(reason.code).toBe('window-exhausted');
    expect(reason.message).toMatch(/exhausted/i);
  });

  it("names the cooling backend and its resume time when that's the only impediment", () => {
    const reason = governorDenyReason(
      governor({ backends: { codex: { state: 'cooling', coolingUntil: '2026-08-14T12:00:00Z' } } }),
      new Date('2026-08-14T10:00:00Z').getTime(),
    );
    expect(reason.code).toBe('backend-cooling');
    expect(reason.message).toMatch(/codex/i);
    expect(reason.message).toMatch(/cooling/i);
  });

  it('says nothing is blocking when the window is open and every backend is ready', () => {
    const reason = governorDenyReason(governor());
    expect(reason.code).toBe('clear');
  });
});
