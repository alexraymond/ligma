/**
 * GET /api/deck — the composed Deck queue, one source for cards + counts.
 *
 * Closes the first D4 seam gap (see scripts/acceptance/drill-d4.ts's header,
 * before this row): the Deck used to have no server-side surface of its own,
 * only `/api/decisions` — every other card kind (design approvals, stale
 * briefs, pending promotions, adoption reviews, verdict spot-checks) was
 * fanned out client-side by `apps/web/src/hooks/use-deck-sources.ts` and
 * folded together by `apps/web/src/lib/deck-cards.ts`'s `buildDeckCards`. That
 * meant the rail badge and the Deck page's own header could only agree by
 * both running the same client code — not because there was one number.
 *
 * This route re-fetches each of those sources from the daemon's own stores
 * (or, where the source's own read path already carries security-sensitive
 * logic — path safety on verification runs and contracts — by calling that
 * route's exported handler directly, in-process, rather than re-implementing
 * it) and folds them with `./deck-cards.ts`'s `buildDeckCards`.
 *
 * Spot-check memory is server-side as of seam S2: `POST /api/deck/spot-check`
 * writes it and this route reads it, so the card is answerable from any client
 * and stays answered. Cards whose task or verification run no longer exists are
 * dropped here too — after a workspace wipe the Deck was still offering a
 * spot-check for a task that had been deleted (process audit P9/P2).
 */

import type {
  AcceptanceContract,
  ActiveRun,
  DesignFilesResponse,
  DesignSummary,
  PersonaReport,
  Task,
  VerificationRunManifest,
  VerificationVerdict,
} from '@ligma/api';
import { isBriefDrifted } from '@ligma/api';
import { listAdoptionRuns } from '../../engine/adopt-repo';
import { readBrief } from '../../engine/discovery';
import { DaemonRequest, NextResponse } from '../../http';
import { getActiveRuns, getDecisions, getProjects, getTasks } from '../../store/data';
import { reviewedRunIds } from '../../store/spot-check-reviews';
import { readPendingPromotions } from '../../studio/pending-promotion';
import { listDesigns, toSummary } from '../../studio/store';
import { GET as getContractsForScope } from '../contracts/_scope/route';
import { GET as getDesignFiles } from '../projects/_id/designs/_did/files/route';
import { GET as getVerificationRunDetail } from '../verification-runs/_id/route';
import { GET as getVerificationRunsList } from '../verification-runs/route';
import {
  type DesignApprovalSource,
  type PendingPromotionSource,
  type RunBlockedSource,
  type SpotCheckSource,
  type StaleBriefSource,
  buildDeckCards,
  isSpotChecked,
} from './deck-cards';

/** A same-process "request" for calling a sibling route handler directly. */
function internalRequest(url: string): DaemonRequest {
  return new DaemonRequest(`http://internal${url}`);
}

async function jsonOf<T>(res: Response): Promise<T | null> {
  return res.ok ? ((await res.json()) as T) : null;
}

/** Ported from use-deck-sources.ts's `previewFor`, in-process instead of a fetch. */
async function previewFor(projectId: string, design: DesignSummary): Promise<string | null> {
  const ref = design.files.find((f) => f.path.toLowerCase().endsWith('.svg'));
  if (!ref) return null;
  const res = await getDesignFiles(
    internalRequest(`/api/projects/${projectId}/designs/${design.id}/files`),
    {
      params: Promise.resolve({ id: projectId, did: design.id }),
    },
  );
  const detail = await jsonOf<DesignFilesResponse>(res);
  const body = detail?.files?.find((f) => f.path === ref.path)?.body;
  return body ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}` : null;
}

/** Ported from use-deck-sources.ts's `contractFor`. */
async function contractFor(run: VerificationRunManifest): Promise<AcceptanceContract | null> {
  const scope =
    run.taskId ?? (run.projectId && run.journeyId ? `${run.projectId}__${run.journeyId}` : null);
  if (!scope) return null;
  const res = await getContractsForScope(
    internalRequest(`/api/contracts/${encodeURIComponent(scope)}?version=${run.contractVersion}`),
    { params: Promise.resolve({ scope }) },
  );
  const body = await jsonOf<{ contracts?: AcceptanceContract[] }>(res);
  return body?.contracts?.[0] ?? null;
}

/** Ported from use-deck-sources.ts's `spotCheckFor`. */
async function spotCheckFor(run: VerificationRunManifest): Promise<SpotCheckSource | null> {
  const res = await getVerificationRunDetail(internalRequest(`/api/verification-runs/${run.id}`), {
    params: Promise.resolve({ id: run.id }),
  });
  const detail = await jsonOf<{
    verdict?: VerificationVerdict | null;
    personaReports?: PersonaReport[];
  }>(res);
  const verdict = detail?.verdict;
  if (!verdict) return null;

  const contested =
    verdict.criterionVerdicts.find((c) => c.status !== 'met') ?? verdict.criterionVerdicts[0];
  if (!contested) return null;
  const shot = contested.evidence.find((e) => /\.(png|jpe?g)$/i.test(e));
  const contract = await contractFor(run);

  return {
    runId: run.id,
    taskTitle: contract?.title ?? run.taskId ?? run.journeyId ?? run.id,
    outcome: verdict.outcome,
    criterion: contract?.criteria.find((c) => c.id === contested.criterionId)?.text ?? null,
    criterionId: contested.criterionId,
    ruling: `${contested.status}: ${contested.reasoning}`,
    imageUrl: shot
      ? `/api/verification-runs/${encodeURIComponent(run.id)}/file?path=${encodeURIComponent(shot)}`
      : null,
    projectId: run.projectId ?? null,
    finishedAt: run.finishedAt ?? run.startedAt,
  };
}

/**
 * Builds that died before producing anything (process audit P13).
 *
 * A boot-gate failure or a crashed backend used to leave one unread inbox
 * report and an empty Deck, so the surface that answers "what needs me?" said
 * nothing about the task that had just stopped dead. Only the two causes a
 * human can actually act on reach the Deck — `env` (fix the boot recipe) and
 * `backend` (fix or switch the CLI); a rate-limit or a governor deferral is
 * calm and self-resolving, and belongs nowhere near this card.
 *
 * Informational, so it needs no answer route: it drops out of the queue when a
 * NEWER run exists for the same task (something tried again) or the task is no
 * longer waiting to be built. One card per task — the newest failure — because
 * three dead retries are one problem, not three.
 */
export function blockedRuns(runs: ActiveRun[], tasks: Task[]): RunBlockedSource[] {
  const byTask = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const settled = new Set(['done', 'awaiting-verification']);
  const newest = new Map<string, ActiveRun>();

  for (const run of runs) {
    if (!run.taskId) continue;
    const previous = newest.get(run.taskId);
    if (!previous || Date.parse(run.startedAt) > Date.parse(previous.startedAt))
      newest.set(run.taskId, run);
  }

  const out: RunBlockedSource[] = [];
  for (const [taskId, run] of newest) {
    if (run.status !== 'failed') continue;
    if (run.causeKind !== 'env' && run.causeKind !== 'backend') continue;
    if (run.interruptedAt) continue;
    const task = byTask.get(taskId);
    // A task that is gone, or already past the build, has nothing left to unblock.
    if (!task || task.deletedAt || settled.has(task.kanban)) continue;
    out.push({
      runId: run.id,
      taskId,
      taskTitle: task.title,
      causeKind: run.causeKind,
      reason: run.error ?? 'The run recorded no reason.',
      projectId: run.projectId ?? task.projectId ?? null,
      blockedAt: run.completedAt ?? run.startedAt,
    });
  }
  return out;
}

export async function GET() {
  const [decisionsFile, tasksFile, projectsFile] = await Promise.all([
    getDecisions(),
    getTasks(),
    getProjects(),
  ]);
  const taskProjects = new Map(tasksFile.tasks.map((t) => [t.id, t.projectId ?? null] as const));
  const liveProjects = projectsFile.projects.filter((p) => !p.deletedAt);

  const perProject = await Promise.all(
    liveProjects.map(async (project) => {
      const manifests = await listDesigns(project.id);
      return {
        project,
        designs: manifests.map(toSummary),
        brief: readBrief(project.id),
        pending: readPendingPromotions(project.id),
      };
    }),
  );

  const designs: DesignApprovalSource[] = await Promise.all(
    perProject.flatMap(({ project, designs: list }) =>
      // "critiquing" is the state a design reaches when it has been drawn and
      // scored and is waiting on a human — that is the approval card.
      list
        .filter((d) => d.status === 'critiquing')
        .map(async (design) => ({
          projectId: project.id,
          projectName: project.name,
          design,
          previewUrl: await previewFor(project.id, design),
        })),
    ),
  );

  const pendingPromotions: PendingPromotionSource[] = perProject.flatMap(({ project, pending }) =>
    pending.map((one) => ({ projectName: project.name, pending: one })),
  );

  // Tasks completed for a project after its brief was last touched — the
  // other half of the drift trigger, derived from tasks.json (kanban "done" +
  // completedAt) rather than inferred or parsed from anything (build brief §16).
  const completedSince = (projectId: string, updatedAt: string): number => {
    const threshold = Date.parse(updatedAt);
    return tasksFile.tasks.filter(
      (t) =>
        t.projectId === projectId &&
        t.kanban === 'done' &&
        t.completedAt &&
        Date.parse(t.completedAt) > threshold,
    ).length;
  };

  const staleBriefs: StaleBriefSource[] = perProject
    .filter(
      ({ brief }) =>
        brief &&
        (brief.staleFlaggedAt ||
          isBriefDrifted(brief, completedSince(brief.projectId, brief.updatedAt))),
    )
    .map(({ project, brief }) => ({
      projectId: project.id,
      projectName: project.name,
      prompt: brief?.prompt ?? '',
      // A drift-only card has no staleFlaggedAt — brief.updatedAt is the
      // stable anchor instead, so the card's createdAt doesn't drift on every poll.
      staleFlaggedAt: brief?.staleFlaggedAt ?? brief?.updatedAt ?? new Date().toISOString(),
      drifted: brief
        ? isBriefDrifted(brief, completedSince(brief.projectId, brief.updatedAt))
        : false,
    }));

  const adoptionRuns = listAdoptionRuns();

  const runsRes = await getVerificationRunsList(internalRequest('/api/verification-runs'));
  const runsBody = await jsonOf<{ runs: VerificationRunManifest[] }>(runsRes);
  const reviewedSpotChecks = reviewedRunIds();
  // Sample first, fetch second: the 1-in-10 rule decides which verdicts are
  // worth opening, so nine out of ten runs cost nothing. Reviewed runs and runs
  // whose task row is gone are dropped here rather than after the fetch, so an
  // orphan costs nothing either.
  const liveTasks = new Set(tasksFile.tasks.map((t) => t.id));
  const sampled = (runsBody?.runs ?? []).filter(
    (r) =>
      r.status === 'complete' &&
      r.verdictPath &&
      isSpotChecked(r.id) &&
      !reviewedSpotChecks.has(r.id) &&
      // A run names either a task or a journey. If it names a task, that task
      // has to still exist — otherwise the card points at nothing (P9).
      (r.taskId === null || liveTasks.has(r.taskId)),
  );
  const spotChecks = (await Promise.all(sampled.map((run) => spotCheckFor(run)))).filter(
    (s): s is SpotCheckSource => s !== null,
  );

  const { runs: allRuns } = await getActiveRuns();

  const cards = buildDeckCards({
    decisions: decisionsFile.decisions,
    taskProjects,
    designs,
    pendingPromotions,
    staleBriefs,
    adoptionRuns,
    spotChecks,
    reviewedSpotChecks,
    runsBlocked: blockedRuns(allRuns, tasksFile.tasks),
  });

  const byKind: Record<string, number> = {};
  for (const card of cards) byKind[card.kind] = (byKind[card.kind] ?? 0) + 1;

  return NextResponse.json(
    { cards, meta: { total: cards.length, byKind } },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}
