/**
 * Journeys — named user flows validated independently of any task
 * (twin-primitives §2), and the characterization baselines that record what
 * "working" currently looks like (§3).
 *
 * Journeys live IN the adopted repo (`.ligma/journeys/*.json`) — they are the
 * visible slice, deliberately readable by the builder. Baselines live centrally
 * under `data/projects/<id>/baselines/` and are tool-denied to builders; a
 * builder that can read the baseline can teach to the test.
 */

/** Who wrote this journey: a human, or the adoption crawl. */
export type JourneyOrigin = 'human' | 'discovery';

export interface Journey {
  /** "jrn_<slug>" — also the journey's filename under .ligma/journeys/. */
  id: string;
  title: string;
  /** Goal-oriented, never a click script: what the user is trying to achieve. */
  goal: string;
  /** Waypoints, in order. Prose, not selectors. */
  steps: string[];
  tags: string[];
  origin: JourneyOrigin;
  /** Cron expression for the smoke schedule, or null for on-demand only. */
  schedule: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a headless bridge recorded at one step, as fields rather than prose.
 *
 * The human `note` says the same thing in a sentence; this is the machine-
 * readable half, so "the schema changed" or "the exit code flipped" is a
 * comparison and not a string diff. Optional: baselines written before it
 * exists, and browser steps whose evidence is a PNG, simply carry a transport.
 */
export interface BaselineObservation {
  transport: 'browser' | 'http' | 'pty';
  /** HTTP response status. */
  status?: number;
  /** Process exit code. */
  exitCode?: number;
  /** The response body's shape, e.g. "{id:string,title:string}". */
  schema?: string;
}

/** What a journey run observed at one step of the journey. */
export interface BaselineStep {
  /** The journey step this outcome belongs to, by index. */
  index: number;
  step: string;
  outcome: 'reached' | 'blocked' | 'not-attempted';
  note: string;
  /** Run-relative evidence path, or null when nothing was captured. */
  screenshot: string | null;
  /** The cited evidence, read as fields. Absent when nothing was cited. */
  observed?: BaselineObservation;
}

/**
 * UX metrics per twin-primitives §3. Deliberately behavioural: time on task and
 * wrong turns are measured, never asked about (build brief §4 principle 7).
 */
export interface BaselineMetrics {
  timeOnTaskMs: number;
  /** Navigations/clicks that turned out not to help — the panel's `wrongTurns`. */
  misclicks: number;
  stepCount: number;
  goalAchieved: boolean | null;
}

/**
 * The characterization record for one journey: "this is what working currently
 * looks like". For a brownfield repo with no written oracle this IS the oracle,
 * and later runs are judged comparatively against it.
 */
export interface JourneyBaseline {
  projectId: string;
  journeyId: string;
  /** The verification run that recorded it. */
  runId: string;
  recordedAt: string;
  steps: BaselineStep[];
  /** Run-relative screenshot paths, in capture order. */
  screenshots: string[];
  metrics: BaselineMetrics;
  /** What the panel reported, verbatim, so a later diff has something to diff. */
  findings: Array<{ severity: string; summary: string }>;
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/**
 * A journey plus what the last verification run said about it — the staleness
 * half of the health board (UX spec §6 Verify, §7 `stale`).
 *
 * All three fields are null until a journey has been run. `lastOutcome` keeps
 * `error` as its own value rather than folding it into `failed`: a harness
 * malfunction proved nothing about the product, and the pill that renders this
 * has to be able to tell them apart (principle 12).
 */
export interface JourneyWithStatus extends Journey {
  /** When the last run for this journey started, or null if it never ran. */
  lastRunAt: string | null;
  /** When that run's verdict was signed — null while it is still running. */
  lastVerdictAt: string | null;
  lastOutcome: 'passed' | 'failed' | 'error' | null;
  /** The run behind the two timestamps above — the evidence link. */
  lastRunId: string | null;
}

export interface JourneyListResponse {
  projectId: string;
  repoPath: string | null;
  journeys: JourneyWithStatus[];
  /** Files under `.ligma/journeys/` that do not validate — surfaced, never dropped. */
  invalidJourneys: Array<{ file: string; error: string }>;
}

/**
 * One journey run in a morning smoke digest (UX spec §6 Inbox).
 *
 * Every field is read off the run manifest and the signed verdict — nothing
 * here is parsed out of prose, so the row a client renders is the row the
 * harness recorded.
 */
export interface SmokeDigestRow {
  projectId: string;
  journeyId: string;
  /** Also the verdict's identity: a verdict is `verification-runs/<runId>/verdict.json`. */
  runId: string;
  /** Run-relative path of the signed verdict, or null when the run wrote none. */
  verdictPath: string | null;
  /** `error` is the harness malfunctioning, never a product defect (§7). */
  outcome: 'passed' | 'failed' | 'error';
  startedAt: string;
  finishedAt: string | null;
}

/**
 * The digest itself, carried as data on the Inbox message so the row's status
 * and its evidence link survive the trip — the body is the same thing said in
 * prose, for readers that only render text.
 */
export interface SmokeDigest {
  /** Exclusive lower bound: runs finished after the previous digest. */
  since: string;
  until: string;
  passed: number;
  failed: number;
  errors: number;
  rows: SmokeDigestRow[];
}

export interface JourneyRunResponse {
  runId: string;
  journeyId: string;
  projectId: string;
  pid: number;
}

export interface BaselineListResponse {
  projectId: string;
  baselines: JourneyBaseline[];
}
