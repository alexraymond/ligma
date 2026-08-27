/**
 * macOS desktop notifications on build completion / verdicts (OD-096).
 *
 * ponytail: shells `osascript -e 'display notification'` — no push library, no
 * notification-center daemon of our own. No-ops off macOS or when disabled in
 * Settings; a build must never fail because a notification couldn't fire.
 *
 * Fired from the two sites that finish work: `harness/verdict.ts` (a verdict
 * landed) and `engine/needs-you-ping.ts` (something is waiting on the human).
 */
import { execFile } from 'node:child_process';
import { cachedConfig } from './engine/config-cache';

function escapeForAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The `osascript` args for this notification, or null if it should not fire
 * (wrong platform, or disabled). Split out from `notifyDesktop` so the
 * decision logic is testable without shelling out.
 */
export function notifyArgs(
  title: string,
  message: string,
  opts: { platform?: NodeJS.Platform; enabled?: boolean } = {},
): string[] | null {
  const platform = opts.platform ?? process.platform;
  const enabled = opts.enabled ?? cachedConfig().notifications.desktopEnabled;
  if (platform !== 'darwin' || !enabled) return null;
  const script = `display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}"`;
  return ['-e', script];
}

/** Fires a macOS notification per current settings. Fire-and-forget; never throws. */
export function notifyDesktop(title: string, message: string): void {
  const args = notifyArgs(title, message);
  if (!args) return;
  execFile('osascript', args, () => {
    // ponytail: a failed notification is not a build failure — nothing to do here.
  });
}
