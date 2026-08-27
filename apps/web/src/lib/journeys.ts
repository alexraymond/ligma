/**
 * "Prove it", as one call.
 *
 * Two surfaces offer it now — the Verify tab's journeys panel and the Overview's
 * quick actions (UX spec §6) — and a second copy of the POST is a second place
 * for the two to drift into meaning different things. Fetch-injectable, so what
 * the button does is testable without a DOM.
 */

import { apiFetch } from '@/lib/api-client';
import type { Fetcher } from '@/lib/undo';

/** Starts a panel walk of one journey. Returns the run id the daemon assigned. */
export async function startJourneyRun(
  projectId: string,
  journeyId: string,
  fetcher: Fetcher = apiFetch,
): Promise<string | null> {
  const res = await fetcher(`/api/projects/${projectId}/journeys/${journeyId}/run`, {
    method: 'POST',
  });
  const json = (await res.json()) as { runId?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Could not start the journey run');
  return json.runId ?? null;
}

/** Presets for a journey's smoke cadence. `null` is the "off" option. */
export const SMOKE_SCHEDULES: ReadonlyArray<{ label: string; cron: string | null }> = [
  { label: 'Off', cron: null },
  { label: 'Every day at 7:00 AM', cron: '0 7 * * *' },
  { label: 'Every day at noon', cron: '0 12 * * *' },
  { label: 'Every day at 9:00 PM', cron: '0 21 * * *' },
  { label: 'Weekdays at 7:00 AM', cron: '0 7 * * 1-5' },
  { label: 'Mondays at 9:00 AM', cron: '0 9 * * 1' },
];

/** The preset's own words when we recognise the cron, the cron itself when not. */
export function scheduleLabel(cron: string | null): string {
  return SMOKE_SCHEDULES.find((s) => s.cron === cron)?.label ?? cron ?? 'Off';
}

/** Sets (or clears, with null) a journey's smoke schedule. */
export async function setJourneySchedule(
  projectId: string,
  journeyId: string,
  cron: string | null,
  fetcher: Fetcher = apiFetch,
): Promise<void> {
  const res = await fetcher(`/api/projects/${projectId}/journeys/${journeyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule: cron }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not change the schedule');
  }
}
