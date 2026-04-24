/**
 * Short relative-time helper, e.g. `5m`, `3h`, `2d`, `Mar 28`.
 * Lifted from the retired DesignGrid so HomeCard's Caveat time ticker
 * stays consistent with the workspace breadcrumb.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${Math.max(diffSec, 0)}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 14) return `${diffD}d`;
  // > 2 weeks: emit the calendar date for a more scannable label.
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate().toString().padStart(2, '0');
  return `${month} ${day}`;
}
