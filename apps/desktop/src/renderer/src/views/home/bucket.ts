import type { Design } from '@ligma/shared';

export type BucketKey = `today` | `yesterday` | `month-${string}`;

export interface Bucket {
  key: BucketKey;
  /** Display label — "Today", "Yesterday", "Mar 2026". */
  label: string;
  /** Optional date suffix appended with an em dash, e.g. "24 Apr 2026" — only
   *  set on the Today bucket so RubricHeader can render the full timestamp. */
  dateSuffix?: string;
  items: Design[];
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthKey(d: Date): BucketKey {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `month-${y}-${m}`;
}

function monthLabel(d: Date): string {
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getFullYear()}`;
}

function fullDayLabel(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${day} ${month} ${d.getFullYear()}`;
}

/**
 * Bucket designs into Today → Yesterday → month-by-month sections.
 * Designs are sorted newest-first; buckets are emitted in the same order
 * so the Today section always appears at the top of the wall.
 *
 * Only non-deleted designs are included. Empty buckets are dropped.
 */
export function bucketByDate(designs: Design[], now: number = Date.now()): Bucket[] {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - 86_400_000;

  const today: Design[] = [];
  const yesterday: Design[] = [];
  const byMonth = new Map<BucketKey, { label: string; items: Design[] }>();

  const sorted = [...designs]
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  for (const design of sorted) {
    const ts = new Date(design.updatedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts >= todayStart) {
      today.push(design);
    } else if (ts >= yesterdayStart) {
      yesterday.push(design);
    } else {
      const d = new Date(ts);
      const key = monthKey(d);
      const entry = byMonth.get(key);
      if (entry) {
        entry.items.push(design);
      } else {
        byMonth.set(key, { label: monthLabel(d), items: [design] });
      }
    }
  }

  const out: Bucket[] = [];
  if (today.length > 0) {
    out.push({
      key: 'today',
      label: 'Today',
      dateSuffix: fullDayLabel(new Date(now)),
      items: today,
    });
  }
  if (yesterday.length > 0) {
    out.push({ key: 'yesterday', label: 'Yesterday', items: yesterday });
  }
  for (const [key, { label, items }] of byMonth) {
    out.push({ key, label, items });
  }
  return out;
}
