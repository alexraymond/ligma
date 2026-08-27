/**
 * smoke.ts — scheduled journey runs, and the one Inbox entry that reports them.
 *
 * Two halves of the same loop:
 *
 * 1. **Schedules.** A journey may carry a cron expression (`schedule`, twin-
 *    primitives §2). Those are handed to the daemon's existing scheduler — no
 *    second timer, no second cron dialect — and each firing is an ordinary
 *    journey run, gated by the quota governor like every other spawn. A denial
 *    means the firing is skipped and the next one tries again: deferred is
 *    calm, and a smoke run nobody asked for is the last thing that should eat
 *    Alex's window.
 *
 * 2. **The morning digest.** One Inbox message per window summarizing the
 *    journey runs that finished since the last digest: per journey, what the
 *    verdict said, with its evidence link. Every field is read off the run
 *    manifest and the signed verdict — no prose is parsed to build it, and
 *    `error` stays its own outcome the whole way through, because a harness
 *    malfunction is not a product defect (UX spec §7).
 *
 * No runs in the window ⇒ no message. An empty digest is noise, and the daily
 * loop is "Deck until empty → Inbox skim → done".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { InboxMessage, Journey, Project, SmokeDigest, SmokeDigestRow } from '@ligma/api';
import { RUNS_DIR, runDirsNewestFirst } from '../harness/verdict';
import { DATA_DIR } from '../paths';
import { listJourneys } from '../store/ligma-dir';
import { withFileLockAsync } from './file-lock';
import { logger } from './logger';

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');

/**
 * When the digest fires. Morning, so the five-minute daily loop (UX spec F3)
 * finds it already there.
 *
 * ponytail: an env override rather than a config field — nothing has asked for
 * a per-install cadence yet. Promote it into `daemon-config.json` the day
 * someone wants to change it from the Settings screen.
 */
export const SMOKE_DIGEST_CRON = process.env.LIGMA_SMOKE_DIGEST_CRON ?? '0 8 * * *';

/** How far back a first-ever digest looks, with no previous digest to bound it. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export interface SmokeSchedule {
  projectId: string;
  journeyId: string;
  title: string;
  /** The journey's own cron expression. */
  cron: string;
}

/**
 * Every journey, across every live project, that carries a smoke schedule.
 *
 * Read fresh rather than cached: journeys live in the target repo and a human
 * editing `.ligma/journeys/x.json` is a normal thing to do. The scheduler picks
 * changes up on its next reload, which the daemon already does on config change.
 */
export function smokeSchedules(): SmokeSchedule[] {
  const { projects } = readJson<{ projects: Project[] }>(PROJECTS_FILE, { projects: [] });
  const out: SmokeSchedule[] = [];

  for (const project of projects) {
    if (project.deletedAt || !project.repoPath) continue;
    let journeys: Journey[];
    try {
      journeys = listJourneys(project.repoPath).journeys;
    } catch {
      continue; // A repo we cannot read schedules nothing.
    }
    for (const journey of journeys) {
      if (!journey.schedule) continue;
      out.push({
        projectId: project.id,
        journeyId: journey.id,
        title: journey.title,
        cron: journey.schedule,
      });
    }
  }
  return out;
}

// ─── Run outcomes ────────────────────────────────────────────────────────────

interface RunManifestRow {
  id?: string;
  journeyId?: string | null;
  projectId?: string | null;
  status?: string;
  verdictPath?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

/**
 * Journey runs, newest first, stopping once they are older than `since`.
 *
 * The outcome comes from the verdict when there is one and from the manifest
 * when there is not: a run that died before writing a verdict is an `error`,
 * never a `failed`. A run still in flight is not reported at all — it has no
 * outcome yet, and inventing one is exactly the claim this product refuses to
 * make.
 */
export function journeyRunRows(
  opts: { since?: string; projectId?: string } = {},
): SmokeDigestRow[] {
  const sinceMs = opts.since ? Date.parse(opts.since) : Number.NEGATIVE_INFINITY;
  const rows: SmokeDigestRow[] = [];

  for (const name of runDirsNewestFirst()) {
    const dir = path.join(RUNS_DIR, name);
    const manifest = readJson<RunManifestRow | null>(path.join(dir, 'run.json'), null);
    if (!manifest?.journeyId || !manifest.projectId) continue;
    if (manifest.status === 'running') continue;
    if (opts.projectId && manifest.projectId !== opts.projectId) continue;

    const stamp = Date.parse(manifest.finishedAt ?? manifest.startedAt ?? '');
    // Directories are walked newest-first, but an unparsable stamp must not end
    // the walk for everything behind it.
    if (Number.isFinite(stamp) && stamp <= sinceMs) continue;

    const verdict = manifest.verdictPath
      ? readJson<{ outcome?: string; createdAt?: string } | null>(
          path.join(dir, manifest.verdictPath),
          null,
        )
      : null;
    const outcome: SmokeDigestRow['outcome'] =
      verdict?.outcome === 'passed' || verdict?.outcome === 'failed' ? verdict.outcome : 'error';

    rows.push({
      projectId: manifest.projectId,
      journeyId: manifest.journeyId,
      runId: manifest.id ?? name,
      verdictPath: manifest.verdictPath ?? null,
      outcome,
      startedAt: manifest.startedAt ?? '',
      finishedAt: manifest.finishedAt ?? verdict?.createdAt ?? null,
    });
  }
  return rows;
}

/** What the health board needs per journey: the newest run and what it said. */
export interface JourneyStatus {
  lastRunAt: string | null;
  lastVerdictAt: string | null;
  lastOutcome: SmokeDigestRow['outcome'] | null;
  lastRunId: string | null;
}

/**
 * The last verification run per journey for one project. Rows arrive newest
 * first, so the first sighting of a journey is its latest run.
 */
export function journeyStatuses(projectId: string): Map<string, JourneyStatus> {
  const out = new Map<string, JourneyStatus>();
  for (const row of journeyRunRows({ projectId })) {
    if (out.has(row.journeyId)) continue;
    out.set(row.journeyId, {
      lastRunAt: row.startedAt || null,
      lastVerdictAt: row.verdictPath ? row.finishedAt : null,
      lastOutcome: row.outcome,
      lastRunId: row.runId,
    });
  }
  return out;
}

// ─── The digest ──────────────────────────────────────────────────────────────

/** The headline: "3 passed · 1 failed · 1 error". */
export function digestHeadline(digest: SmokeDigest): string {
  const parts = [`${digest.passed} passed`, `${digest.failed} failed`];
  // Errors are named even at zero — their absence is information too, and a
  // reader should never have to wonder whether the count was omitted or is nil.
  parts.push(digest.errors === 1 ? '1 error' : `${digest.errors} errors`);
  return parts.join(' · ');
}

/** Tally rows into a digest. Pure — the composition tests drive this directly. */
export function composeDigest(
  rows: SmokeDigestRow[],
  since: string,
  until: string,
): SmokeDigest | null {
  if (rows.length === 0) return null; // Silence is fine; an empty digest is noise.
  return {
    since,
    until,
    passed: rows.filter((r) => r.outcome === 'passed').length,
    failed: rows.filter((r) => r.outcome === 'failed').length,
    errors: rows.filter((r) => r.outcome === 'error').length,
    rows: [...rows].sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? '')),
  };
}

/**
 * The prose half, for readers that render `body` and nothing else. It says the
 * same thing as `smokeDigest` and is generated from it — the message is never
 * the only place a fact lives.
 */
export function digestBody(digest: SmokeDigest): string {
  const lines = [digestHeadline(digest), `Journey runs since ${digest.since}.`, ''];
  for (const row of digest.rows) {
    const label = row.outcome === 'error' ? 'ERROR (harness)' : row.outcome.toUpperCase();
    lines.push(`- [${label}] ${row.projectId}/${row.journeyId} — ${row.runId}`);
    lines.push(`  Evidence: data/verification-runs/${row.runId}/`);
  }
  if (digest.errors > 0) {
    lines.push(
      '',
      'An `error` row is the HARNESS malfunctioning — no defect was found and none is claimed.',
    );
  }
  return lines.join('\n');
}

/** The `until` of the most recent digest, or null if none was ever written. */
export function lastDigestAt(): string | null {
  const { messages } = readJson<{ messages: InboxMessage[] }>(INBOX_FILE, { messages: [] });
  let latest: string | null = null;
  for (const message of messages) {
    const until = message.smokeDigest?.until;
    if (until && (latest === null || until > latest)) latest = until;
  }
  return latest;
}

/**
 * Compose and file the digest. Returns what was filed, or null when there was
 * nothing to say.
 *
 * The window's start is the previous digest's `until`, read back off the inbox
 * itself — no second state file to drift from the messages it describes.
 * ponytail: an inbox pruned of its last digest widens exactly one window; give
 * the window its own file the day that matters.
 */
export async function writeSmokeDigest(now = new Date()): Promise<SmokeDigest | null> {
  const until = now.toISOString();
  const since = lastDigestAt() ?? new Date(now.getTime() - FIRST_WINDOW_MS).toISOString();
  const digest = composeDigest(journeyRunRows({ since }), since, until);

  if (!digest) {
    logger.debug('smoke', `No journey runs since ${since} — no digest filed`);
    return null;
  }

  const headline = digestHeadline(digest);
  await withFileLockAsync('inbox', async () => {
    const data = readJson<{ messages: InboxMessage[] }>(INBOX_FILE, { messages: [] });
    data.messages.push({
      id: `msg_smoke_${now.getTime()}`,
      from: 'system',
      to: 'me',
      type: 'report',
      taskId: null,
      subject: `Smoke digest — ${headline}`,
      body: digestBody(digest),
      status: 'unread',
      createdAt: until,
      readAt: null,
      smokeDigest: digest,
    });
    writeFileSync(INBOX_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  });

  logger.info(
    'smoke',
    `Smoke digest filed: ${headline} (${digest.rows.length} run(s) since ${since})`,
  );
  return digest;
}
