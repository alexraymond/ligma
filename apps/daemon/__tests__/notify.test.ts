/**
 * The decision logic behind desktop notifications (OD-096): which platform,
 * which setting, and that a message can't break out of the AppleScript
 * string it's interpolated into. `notifyArgs` is the pure half of notify.ts —
 * no need to mock `child_process` to exercise it.
 */
import { describe, expect, it } from 'vitest';
import { notifyArgs } from '../src/notify';

describe('notifyArgs', () => {
  it('no-ops off macOS even when enabled', () => {
    expect(notifyArgs('Verified', 'task_1', { platform: 'linux', enabled: true })).toBeNull();
    expect(notifyArgs('Verified', 'task_1', { platform: 'win32', enabled: true })).toBeNull();
  });

  it('no-ops when disabled even on macOS', () => {
    expect(notifyArgs('Verified', 'task_1', { platform: 'darwin', enabled: false })).toBeNull();
  });

  it('builds an osascript display-notification command when enabled on macOS', () => {
    const args = notifyArgs('Verified', 'task_1 passed', { platform: 'darwin', enabled: true });
    expect(args).not.toBeNull();
    expect(args?.[0]).toBe('-e');
    expect(args?.[1]).toContain('display notification');
    expect(args?.[1]).toContain('task_1 passed');
    expect(args?.[1]).toContain('with title "Verified"');
  });

  it("escapes quotes so a title/message can't break out of the AppleScript string", () => {
    const args = notifyArgs('Say "hi"', 'a "quoted" verdict', {
      platform: 'darwin',
      enabled: true,
    })!;
    expect(args[1]).toContain('\\"quoted\\"');
    expect(args[1]).toContain('\\"hi\\"');
  });
});
