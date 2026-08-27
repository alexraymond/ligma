/**
 * Shared types for the acceptance harness (Phase 2).
 *
 * PINNED CONTRACT — see docs/history/CONTRACTS.md. These types are the interface
 * between the contract compiler, the harness runtime, the judge, and the
 * evidence UI. Change them only via the conductor.
 */

import type { DesignBaselineRef } from './designs';
import type { RunFailureCause } from './types';

// ─── Acceptance contracts (the frozen oracle) ───────────────────────────────

export type CriterionKind = 'criterion' | 'invariant';

export interface CriterionProvenance {
  /** Where this criterion came from (conversation excerpt, task field, doc). */
  source: string;
  /** The exact words that produced it. */
  quote: string;
}

export interface Criterion {
  id: string; // "crit_<n>" unique within contract
  kind: CriterionKind;
  /** Phrased as user-observable behaviour, never implementation. */
  text: string;
  /** Hidden from builder prompts; harness tests 100%, builder sees ~70%. */
  holdout: boolean;
  provenance: CriterionProvenance | null;
}

export interface HarnessSignature {
  payloadHash: string; // sha256 hex of canonicalized (key-sorted) JSON
  signature: string; // Ed25519, hex
  publicKey: string; // SPKI DER, base64
}

export interface AcceptanceContract {
  id: string; // "ctr_<timestamp>"
  /** 1-based, per (taskId|productId) scope; versions are append-only. */
  version: number;
  taskId: string | null;
  productId: string | null;
  title: string;
  /** Verification run of the prior version, for comparative judging. */
  baselineRunId: string | null;
  criteria: Criterion[];
  /**
   * The approved design this contract was compiled against, when there was one
   * (merger spec: approved-artifact-as-oracle). Absent for headless projects,
   * which compile from criteria + journey baselines alone — "design is a stage,
   * not a gate", so its absence is normal rather than a missing field.
   *
   * It is inside the signed payload deliberately: an oracle whose reference
   * artifact can be edited after signing is not frozen. Optional, so contracts
   * compiled before this existed still verify byte-for-byte — `JSON.stringify`
   * drops an undefined key, so their canonical payload is unchanged.
   */
  designBaseline?: DesignBaselineRef;
  createdAt: string;
  signature: HarnessSignature | null;
}

// ─── Persona panel ───────────────────────────────────────────────────────────

/**
 * The panel's vocabulary. The first five drive a browser; `naive-developer` and
 * `explorer` are the headless generalization (UX spec §3) — same principles,
 * different transport. A charter is not tied to a bridge: `saboteur` sends
 * malformed input over whichever bridge it was given.
 */
export type PersonaCharter =
  | 'naive-user'
  | 'saboteur'
  | 'returning-user'
  | 'visual-critic'
  | 'spec-auditor'
  /** Reads only the README/quickstart of the built product and follows it literally. */
  | 'naive-developer'
  /** Crawls an unfamiliar product and proposes the journeys it thinks users have. */
  | 'explorer';

export interface PersonaFinding {
  severity: 'blocker' | 'major' | 'minor' | 'note';
  summary: string;
  /** Relative paths into the run's evidence dir (screenshots, steps). */
  evidence: string[];
  criterionId: string | null;
}

export interface PersonaCriterionResult {
  criterionId: string;
  status: 'met' | 'not-met' | 'not-tested';
  evidence: string[];
}

export interface PersonaReport {
  charter: PersonaCharter;
  runId: string;
  /** Distinguishes repeated naive-user runs; null for single-run charters. */
  personaSeed: string | null;
  /** Charter-dependent; null where "a goal" doesn't apply (visual critic). */
  goalAchieved: boolean | null;
  stepCount: number;
  wrongTurns: number;
  elapsedMs: number;
  findings: PersonaFinding[];
  /** Only the spec-auditor may populate this — sole charter allowed to mark criteria met. */
  criterionResults: PersonaCriterionResult[] | null;
  transcriptPath: string;
  /** True when the agent's output failed structured parsing — an invalid run is NEVER a pass. */
  invalid: boolean;
  /**
   * Set only when `invalid` was caused by a structured API-level fault — a 429
   * or an auth rejection — read off the CLI's own JSON result fields
   * (`api_error_status`, `rate_limit_info`), never guessed from prose. Absent
   * for a parse failure, a crash, or a timeout with no such event in its output.
   */
  causeKind?: RunFailureCause;
  /** When the backend's own event named a retry/reset time. Absent otherwise. */
  resumesAt?: string;
}

// ─── Judge ───────────────────────────────────────────────────────────────────

export type CriterionVerdictStatus = 'met' | 'not-met' | 'unknown';

export interface CriterionVerdict {
  criterionId: string;
  /** "unknown" (missing/ambiguous evidence) counts as NOT passed. */
  status: CriterionVerdictStatus;
  reasoning: string;
  evidence: string[];
}

export interface VerificationVerdict {
  runId: string;
  /** Null for a journey run: a journey is validated independently of any task. */
  taskId: string | null;
  /** Set when this run walked a journey rather than a task (twin-primitives §4). */
  journeyId?: string | null;
  /** The project scope of a journey run. Null for task runs. */
  projectId?: string | null;
  contractId: string;
  contractVersion: number;
  /**
   * "passed" only if every criterion is "met" and no blocker finding stands.
   * "error" means the HARNESS malfunctioned (judge crashed/timed out, contract
   * signature invalid, evidence unreadable) — it is NOT a product failure and
   * must never be reported to the human as one, nor bounce the task to the
   * builder. Absence of a verdict is not evidence of a defect.
   */
  outcome: 'passed' | 'failed' | 'error';
  criterionVerdicts: CriterionVerdict[];
  /**
   * Findings no test can express ("works but tedious") → decision cards for the
   * human. `duplicateOf` is the judge saying this is a question the task already
   * has open (it is shown them): the entry is kept in the signed verdict — it is
   * what the judge said — and skipped when the cards are written
   * (execution-flow-review H6).
   */
  humanDecisions: Array<{ question: string; context: string; duplicateOf?: string | null }>;
  judgeModel: string;
  /**
   * On an `error` verdict: which part of the harness broke, set where the judge
   * classified it (an unparseable reply, a spawn that threw) rather than read
   * back out of the reason string. Absent on passed/failed verdicts.
   */
  causeKind?: RunFailureCause;
  /**
   * `git rev-parse HEAD` in the PRODUCT repo at verdict time — what this verdict
   * is a statement about. Null when the product has no repo. Part of the signed
   * payload (it is set before `signVerdict`), so it cannot be back-dated onto a
   * verdict afterwards. Absent on verdicts written before Phase 2.
   */
  commitSha?: string | null;
  createdAt: string;
  signature: HarnessSignature | null;
}

// ─── Verification runs (evidence locker layout) ──────────────────────────────

/**
 * On-disk layout, rooted at mission-control/data/verification-runs/<runId>/:
 *   run.json                          — VerificationRunManifest
 *   verdict.json                      — VerificationVerdict
 *   personas/<charter>[-<n>]/
 *     report.json                     — PersonaReport
 *     transcript.jsonl                — raw agent transcript (scrubbed)
 *     steps.jsonl                     — bridge-recorded browser steps
 *     shots/<step>.png                — screenshots
 * All evidence[] paths in the types above are relative to the run root.
 */
export interface VerificationRunManifest {
  id: string; // "vrun_<timestamp>"
  /** Null for a journey run — same pipeline, no task to bounce back to. */
  taskId: string | null;
  /** Set when this run walked a journey (twin-primitives §4). */
  journeyId?: string | null;
  projectId?: string | null;
  contractId: string;
  contractVersion: number;
  envId: string | null;
  baseCommit: string;
  status: 'running' | 'complete' | 'error';
  /**
   * PID of the run-verification process. A "running" manifest whose pid is dead
   * is stale (killed mid-run) and must NOT be treated as an in-flight run —
   * otherwise the task is blocked from verification forever.
   */
  pid: number | null;
  personaReports: string[]; // relative paths to report.json files
  verdictPath: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /**
   * Why an `error` run stopped — the boot recipe, the governor, the judge —
   * recorded by whichever step raised it. Absent when nothing classified it.
   */
  causeKind?: RunFailureCause;
  /**
   * When the classifying site knows when this can be retried (a rate-limit
   * reset time read off the persona panel's own API-error events). Only ever
   * set alongside `causeKind: "rate-limit"` or `"auth"`.
   */
  resumesAt?: string;
}

// ─── Bridges (evidence steps) ────────────────────────────────────────────────

/**
 * One bridge-recorded step — a line of a persona's steps.jsonl.
 *
 * Transport-agnostic on purpose: the browser bridge fills `screenshot`, the HTTP
 * and PTY bridges fill `record` with the path of the request/response or command
 * artifact they wrote. Everything downstream reads the same shape.
 */
export interface BridgeStep {
  index: number;
  action: string;
  detail: string;
  /** The product URL the step acted on. Empty for a transport that has none. */
  url: string;
  startedAt: string;
  durationMs: number;
  /** Relative path into the run dir, or null when no shot was taken. */
  screenshot: string | null;
  /**
   * Relative path of the artifact this step produced — an HTTP request/response
   * record or a command transcript. Optional so browser steps, which have none,
   * serialize exactly as before.
   */
  record?: string | null;
  error: string | null;
}
