/**
 * One time-formatting surface for the whole app (walkthrough m8: five
 * independent date formats scattered across pages, and no relative time
 * anywhere a list of events needed one — e.g. Inbox: "Everything dated
 * 2/27/2026, no relative time").
 *
 * `now` is a parameter, not `Date.now()` read internally, so callers (and
 * tests) can pin it — same convention as `lib/staleness.ts`.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Past this many days, a relative count ("14d ago") stops being useful and the absolute date takes over. */
const RELATIVE_CUTOFF_DAYS = 7;

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago", falling back to
 * `formatAbsoluteDate` once it's more than a week old or the timestamp is
 * unparsable — never a raw `Invalid Date`.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diff = now - then;
  if (diff < 0) return formatAbsoluteDate(iso, now);

  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / DAY_MS);
  if (days < RELATIVE_CUTOFF_DAYS) return `${days}d ago`;

  return formatAbsoluteDate(iso, now);
}

/**
 * "Aug 12" while the date is still this year, "Aug 12, 2025" once it crosses
 * a year boundary — the year the Activity day headers were dropping (M6/m8).
 */
export function formatAbsoluteDate(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(
    'en-US',
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** Absolute date + time, for surfaces that need both (e.g. verification runs, signed evidence). */
export function formatDateTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${formatAbsoluteDate(iso, now)}, ${time}`;
}
