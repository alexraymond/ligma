/**
 * Decision deck composition — `buildDeckCards`, the one implementation.
 *
 * Card kinds, `KIND_ORDER` and the FNV-1a 1-in-10 spot-check sample all live
 * here, so `GET /api/deck` (route.ts, sibling file) composes the queue once,
 * server-side, instead of every client re-deriving it from a scatter of
 * fetches. Pure and I/O-free: this decides *what is in the queue and in what
 * order*, `route.ts` decides where the pieces come from.
 *
 * This is now the SINGLE implementation (seam S3, codebase audit W10): the web
 * copy that used to be the reference had already drifted from it, and its unit
 * suites asserted the dead copy. The option strings — which travel back as
 * exact-match display strings, so producer and consumer must agree character
 * for character — live in `@ligma/api`'s `DECK_OPTIONS`, which both sides read.
 */

import type {
  AdoptionRun,
  DecisionItem,
  DesignSummary,
  PendingPromotion,
  RunBlockedCardFields,
} from '@ligma/api';
import { DECK_OPTIONS, DRIFT_AGE_DAYS, DRIFT_TASK_THRESHOLD, deckOrder } from '@ligma/api';

export type DeckCardKind =
  | 'decision'
  | 'design-approval'
  | 'promote-pending'
  | 'stale-brief'
  | 'adoption-review'
  | 'verdict-spot-check'
  | 'run-blocked';

export interface DeckCardEvidence {
  imageUrl?: string;
  criterion?: string;
  ruling?: string;
  facts?: Array<{ label: string; value: string }>;
}

export interface DeckCard {
  id: string;
  kind: DeckCardKind;
  title: string;
  context: string;
  options: string[];
  evidence: DeckCardEvidence | null;
  href: string;
  opensSheet: boolean;
  decision: DecisionItem | null;
  /**
   * The decision's own `kind` ("verification-cap") when it has one, so a card
   * raised by machinery reaches the UI with its identity intact instead of
   * rendering as a generic decision (L3). Absent for every other card kind.
   */
  decisionKind?: string | null;
  projectId: string | null;
  createdAt: string;
}

/**
 * A `run-blocked` card: the common shape plus `@ligma/api`'s `RunBlockedCardFields`,
 * so the producer here and the renderer in web read one declaration of the
 * contract rather than two copies of it.
 */
export interface RunBlockedCard extends DeckCard, RunBlockedCardFields {
  kind: 'run-blocked';
}

/** Verdict spot-checks sample 1 in 10 (build brief §2 pinned default). */
export const SPOT_CHECK_RATE = 10;

/** FNV-1a, 32-bit. Small, stable, and not a security boundary. Verbatim port. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function isSpotChecked(runId: string, rate: number = SPOT_CHECK_RATE): boolean {
  return hashId(runId) % rate === 0;
}

export interface SpotCheckSource {
  runId: string;
  taskTitle: string;
  outcome: string;
  criterion: string | null;
  criterionId: string;
  ruling: string;
  imageUrl: string | null;
  projectId?: string | null;
  finishedAt: string;
}

/**
 * A build that stopped before it could produce anything, as the run recorded it.
 *
 * A failed boot gate or a crashed backend left an unread inbox report and an
 * empty Deck (process audit P13): the one surface that says "here is what needs
 * you" had nothing to say about the task that just died. `route.ts` reads these
 * off active-runs.json — the failure class is `causeKind`, written by the site
 * that raised it, so nothing here parses a message.
 */
export interface RunBlockedSource extends RunBlockedCardFields {
  runId: string;
  projectId: string | null;
  blockedAt: string;
}

export interface DesignApprovalSource {
  projectId: string;
  projectName: string;
  design: DesignSummary;
  previewUrl?: string | null;
}

export interface StaleBriefSource {
  projectId: string;
  projectName: string;
  prompt: string;
  staleFlaggedAt: string;
  /**
   * True when this card exists because the brief drifted by neglect
   * (`isBriefDrifted`) rather than — or in addition to — a post-lock edit.
   * Changes the card's options: the drift trigger gets its own answer/undo
   * pair, "Re-run discovery" and "Still true (snooze 90 days)", instead of
   * the plain edit-flag's single "Acknowledge". Optional so every existing
   * caller (the edit-flag-only case) keeps working unchanged.
   */
  drifted?: boolean;
}

export interface PendingPromotionSource {
  projectName: string;
  pending: PendingPromotion;
}

export interface DeckSources {
  decisions: DecisionItem[];
  designs: DesignApprovalSource[];
  pendingPromotions?: PendingPromotionSource[];
  staleBriefs: StaleBriefSource[];
  adoptionRuns: AdoptionRun[];
  spotChecks: SpotCheckSource[];
  runsBlocked?: RunBlockedSource[];
  /**
   * Spot-check run ids the human already answered.
   *
   * Server-side now (`store/spot-check-reviews.ts`, seam S2): this used to be
   * unreadable here because the memory lived in one browser's localStorage, so
   * the card was unanswerable from the CLI and came back in every other client
   * (process audit P9). `route.ts` fills it from the store.
   */
  reviewedSpotChecks?: ReadonlySet<string>;
  taskProjects?: ReadonlyMap<string, string | null>;
}

const KIND_ORDER: Record<DeckCardKind, number> = {
  decision: 0,
  'design-approval': 1,
  'promote-pending': 2,
  'stale-brief': 3,
  'adoption-review': 4,
  'verdict-spot-check': 5,
  // Last: informational, and the only kind with nothing to answer. It exists so
  // a dead build is visible where the human already looks, not to be dispositioned.
  'run-blocked': 6,
};

/** What each blocking cause is, in the words the card shows. */
const BLOCKED_CAUSE_WORDS: Record<string, string> = {
  env: "the product's environment could not be booted",
  backend: 'the backend CLI exited badly',
};

export function buildDeckCards(sources: DeckSources, now: number = Date.now()): DeckCard[] {
  const cards: DeckCard[] = [];

  for (const d of deckOrder(sources.decisions, now)) {
    cards.push({
      id: d.id,
      kind: 'decision',
      title: d.question,
      context: d.context,
      options: d.options,
      evidence: null,
      // Global Board retired into the portfolio grid's Tasks view (UX spec §16).
      href: d.taskId ? `/projects?view=tasks&task=${d.taskId}` : '/deck',
      opensSheet: false,
      decision: d,
      decisionKind: d.kind ?? null,
      projectId: (d.taskId ? sources.taskProjects?.get(d.taskId) : null) ?? null,
      createdAt: d.createdAt,
    });
  }

  for (const { projectId, projectName, design, previewUrl } of sources.designs) {
    cards.push({
      id: `design:${design.id}`,
      kind: 'design-approval',
      title: `Approve "${design.title}"?`,
      context: `${projectName} — an approved design compiles into the contract, so this is the oracle the build is judged against.`,
      options: [...DECK_OPTIONS.designApproval],
      evidence: {
        ...(previewUrl ? { imageUrl: previewUrl } : {}),
        facts: [
          { label: 'Versions', value: String(design.versionCount) },
          {
            label: 'Critique score',
            value: design.critiqueScore === null ? 'unscored' : String(design.critiqueScore),
          },
          { label: 'Open pins', value: String(design.pendingPinCount) },
        ],
      },
      href: `/projects/${projectId}/studio?design=${design.id}`,
      opensSheet: false,
      decision: null,
      projectId,
      createdAt: design.updatedAt,
    });
  }

  for (const { projectName, pending } of sources.pendingPromotions ?? []) {
    cards.push({
      id: `promote:${pending.projectId}:${pending.key}`,
      kind: 'promote-pending',
      title: `Confirm the contract for ${projectName}?`,
      context:
        pending.source === 'design'
          ? 'A design was promoted into a task breakdown and is waiting on the one confirm that freezes its oracle.'
          : 'The brief was promoted into a task breakdown and is waiting on the one confirm that freezes its oracle.',
      options: [...DECK_OPTIONS.promotePending],
      evidence: {
        facts: [
          { label: 'Tasks', value: String(pending.taskCount) },
          { label: 'Criteria', value: `${pending.criteriaCount} — ${pending.holdoutNote}` },
          { label: 'Estimated spawns', value: String(pending.estimatedSpawns) },
        ],
      },
      href:
        pending.designId === null
          ? `/projects/${pending.projectId}/brief`
          : `/projects/${pending.projectId}/studio?design=${pending.designId}`,
      opensSheet: true,
      decision: null,
      projectId: pending.projectId,
      createdAt: pending.createdAt,
    });
  }

  for (const brief of sources.staleBriefs) {
    cards.push({
      id: `brief:${brief.projectId}`,
      kind: 'stale-brief',
      title: brief.drifted
        ? "This brief hasn't been touched in a while — still true?"
        : 'The brief changed after its contract was compiled',
      context: brief.drifted
        ? `${brief.projectName} — unchanged for ${DRIFT_AGE_DAYS}+ days while ${DRIFT_TASK_THRESHOLD}+ tasks completed since.`
        : `${brief.projectName} — the designs and tasks built from it are flagged stale, not invalidated.`,
      options: brief.drifted
        ? [...DECK_OPTIONS.staleBriefDrifted]
        : [...DECK_OPTIONS.staleBriefEdited],
      evidence: { criterion: brief.prompt },
      href: `/projects/${brief.projectId}/brief`,
      opensSheet: false,
      decision: null,
      projectId: brief.projectId,
      createdAt: brief.staleFlaggedAt,
    });
  }

  for (const run of sources.adoptionRuns.filter((r) => r.status === 'awaiting-review')) {
    cards.push({
      id: `adoption:${run.id}`,
      kind: 'adoption-review',
      title: 'An adopted repo is waiting for its review sheet',
      context: run.bootRationale || run.repoPath,
      options: [],
      evidence: {
        facts: [
          { label: 'Repo', value: run.repoPath },
          { label: 'Proposed journeys', value: String(run.proposedJourneys.length) },
          { label: 'Confusion log', value: `${run.confusionLog.length} entries` },
        ],
      },
      href: `/adoption/${run.id}`,
      opensSheet: true,
      decision: null,
      projectId: run.projectId ?? null,
      createdAt: run.startedAt,
    });
  }

  const reviewed = sources.reviewedSpotChecks ?? new Set<string>();
  for (const check of sources.spotChecks) {
    if (!isSpotChecked(check.runId) || reviewed.has(check.runId)) continue;
    cards.push({
      id: `spotcheck:${check.runId}`,
      kind: 'verdict-spot-check',
      title: `Spot-check: did the judge get "${check.taskTitle}" right?`,
      context: `The judge returned ${check.outcome}. One verdict in ${SPOT_CHECK_RATE} is sampled to keep it honest.`,
      options: [...DECK_OPTIONS.verdictSpotCheck],
      evidence: {
        criterion:
          check.criterion ??
          `${check.criterionId} — the contract holding its wording is not readable from here.`,
        ruling: check.ruling,
        ...(check.imageUrl ? { imageUrl: check.imageUrl } : {}),
      },
      href: `/verification/${check.runId}`,
      opensSheet: false,
      decision: null,
      projectId: check.projectId ?? null,
      createdAt: check.finishedAt,
    });
  }

  for (const blocked of sources.runsBlocked ?? []) {
    const card: RunBlockedCard = {
      id: `runblocked:${blocked.runId}`,
      kind: 'run-blocked',
      title: `"${blocked.taskTitle}" never got off the ground`,
      context: `${BLOCKED_CAUSE_WORDS[blocked.causeKind] ?? 'the run failed'} — nothing was built, and the task is still waiting.`,
      // Informational: this card is not a question, so there is nothing to
      // answer. It leaves on its own when a newer run exists or the task settles.
      options: [],
      evidence: { criterion: blocked.reason },
      href: `/runs?run=${encodeURIComponent(blocked.runId)}`,
      opensSheet: false,
      decision: null,
      projectId: blocked.projectId,
      createdAt: blocked.blockedAt,
      taskId: blocked.taskId,
      taskTitle: blocked.taskTitle,
      causeKind: blocked.causeKind,
      reason: blocked.reason,
    };
    cards.push(card);
  }

  return cards.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    if (a.kind === 'decision') return 0;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}
