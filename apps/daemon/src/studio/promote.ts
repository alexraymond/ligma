/**
 * Promote to build — propose, then commit.
 *
 * One pair of functions serves both entrances (UX spec F1.4): from an approved
 * design, or straight from the brief. The difference between them is a baseline
 * and a set of files, not a different pipeline — which is what stops the
 * headless path from quietly becoming the second-class one.
 *
 * `buildPromotePreview` is read-only. It compiles nothing, signs nothing, and
 * lands no tasks; it exists so the user sees the breakdown, the holdout
 * disclosure and the token estimate *before* the oracle freezes. `commitPromote`
 * is the irreversible half, and it takes the reviewed preview back rather than
 * recomputing — approving one breakdown and compiling a differently-worded one
 * would make the review theatre.
 */

import type {
  DesignBaselineRef,
  GovernorTokenEstimate,
  ProjectShape,
  PromotePreview,
  PromotePreviewRequest,
  PromoteProposedJourney,
  PromoteRequest,
  PromoteResult,
  PromotedTask,
  ProposedCriterion,
  ProposedTask,
  RunFailureCause,
} from '@ligma/api';
import { runTurn } from '@ligma/core/agent';
import { loadConfig } from '../engine/config';
import { lockedConstraints, readBrief, writeBrief } from '../engine/discovery';
import { verificationRosterSize } from '../engine/dispatcher';
import { logger } from '../engine/logger';
import { claimSpawn, deferralFields, status as governorStatus } from '../engine/quota-governor';
import { assignHoldouts } from '../harness/compile-contract';
import { compilePromotedContract } from '../harness/compile-contract';
import {
  ensureBuilderAgent,
  getProjects,
  mutateActivityLog,
  mutateProjects,
  mutateTasks,
} from '../store/data';
import { generateId } from '../store/ids';
import { writeJourney } from '../store/ligma-dir';
import { sourceDir } from './paths';
import { claimPromoteNonce } from './pending-promotion';
import { getStudioProvider } from './provider';
import { latestVersion, mutateManifest, readManifest } from './store';
import { type SubmittedPlan, createPlannerToolRegistry } from './tools';

const PLANNER_MODEL = process.env.LIGMA_STUDIO_PLANNER_MODEL ?? 'claude-sonnet-4-5';

/**
 * What a promotion will really cost, in sessions.
 *
 * `taskCount * 3` under-quoted a mixed-shape plan roughly five-fold
 * (execution-flow-review H3): `willDefer` said false for a breakdown that then
 * ate a whole 5-hour window. The arithmetic is now read off
 * `verificationRosterSize` — the very function the dispatcher's admission door
 * uses — plus the judge that door claims up front and the one builder that
 * produces the work, so the sheet and the door cannot drift apart.
 *
 * An unknown shape is costed as "ui", the most expensive panel: the same
 * fail-expensive default `getProjectShapes` documents, because an estimate that
 * can be wrong should be wrong in the direction that does not surprise anyone.
 */
export function estimateSpawns(
  taskCount: number,
  shape: ProjectShape = 'ui',
): { perRound: number; ceiling: number } {
  const harness = loadConfig().execution.harness;
  const perTask = 1 + verificationRosterSize(shape, harness.naiveUserRuns) + 1;
  return {
    perRound: taskCount * perTask,
    ceiling: taskCount * perTask * harness.maxVerificationAttempts,
  };
}

export function governorEstimate(
  taskCount: number,
  shape: ProjectShape = 'ui',
): GovernorTokenEstimate {
  const live = governorStatus();
  const { perRound, ceiling } = estimateSpawns(taskCount, shape);
  return {
    estimatedSpawns: perRound,
    // The honest worst case, disclosed but not used to decide: quoting the
    // ceiling as the price would defer plans that will usually pass first time.
    maxSpawns: ceiling,
    windowHours: live.windowHours,
    used: live.used,
    max: live.max,
    reserveFloor: live.reserveFloor,
    remainingForAutonomy: live.remainingForAutonomy,
    // A deferral is a queue, not a failure — the daemon picks denied builders up
    // next cycle. Surfacing it here just means the user is not surprised by it.
    willDefer: perRound > live.remainingForAutonomy,
    killSwitch: live.killSwitch,
  };
}

/** "the builder will see 7 of 10" — the holdout made legible before it freezes. */
export function holdoutNote(criteria: ProposedCriterion[]): string {
  const held = criteria.filter((c) => c.holdout).length;
  const visible = criteria.length - held;
  return `The builder will see ${visible} of ${criteria.length} criteria; ${held} are held out (all invariants always are), so the harness tests things the build did not aim at.`;
}

async function designBaselineFor(projectId: string, designId: string): Promise<DesignBaselineRef> {
  const manifest = await readManifest(projectId, designId);
  if (!manifest) throw new Error(`Design not found: ${designId}`);
  if (manifest.status !== 'approved') {
    throw new Error(
      `Design ${designId} is "${manifest.status}" — only an approved design can be an oracle, because only an approved design is frozen`,
    );
  }
  const version = latestVersion(manifest);
  if (!version) throw new Error(`Design ${designId} is approved but has no versions`);
  return {
    designId,
    versionId: version.id,
    approvedAt: manifest.approvedAt ?? manifest.updatedAt,
    designSystem: manifest.designSystem,
    files: version.files,
  };
}

/**
 * A preview failure carrying the class the web's one failure-card family
 * renders, decided here rather than guessed from the message downstream.
 */
export class PreviewFailure extends Error {
  constructor(
    message: string,
    readonly causeKind: RunFailureCause,
    readonly resumesAt: string | null = null,
  ) {
    super(message);
    this.name = 'PreviewFailure';
  }
}

/**
 * Ask the planner for a breakdown, as structured tool output.
 *
 * Governed like every other spawn (build brief §4 principle 9). A denial or a
 * malfunction produces a preview carrying `error` — never a fabricated plan,
 * because a plan the user confirms becomes a signed contract.
 *
 * The claim does NOT wait. This runs inside an HTTP request the user is
 * watching a spinner for, and the old 5-minute `awaitClaimedSlot` block was
 * what made d1-attempt-1's promote unusable: with the window at its reserve
 * floor every preview sat silent until Node killed the socket. A denial is a
 * fact the governor already knows — "deferred, resumes ~HH:MM" answered in a
 * second beats a plan answered never.
 */
async function runPlanner(
  brief: string,
  locked: string[],
  designRoot: string | null,
  designFiles: string[],
): Promise<SubmittedPlan> {
  const decision = claimSpawn('builder', { ref: 'promote-plan' });
  if (!decision.allowed) {
    const { causeKind, resumesAt } = deferralFields(decision);
    throw new PreviewFailure(
      `the governor is holding sessions back (${decision.reason}) — no planner ran`,
      causeKind,
      resumesAt ?? null,
    );
  }
  logger.info('studio', `Promote planner claimed a ${decision.backend} slot`);

  let plan: SubmittedPlan | null = null;
  const registry = createPlannerToolRegistry(designRoot, (submitted) => {
    plan = submitted;
  });

  const systemPrompt = [
    'You are planning a build. Break the work into tasks a single agent can each complete.',
    '',
    ...(locked.length > 0
      ? [
          '## Locked constraints — violating any of these fails the work',
          'The user locked these answers during discovery. They are hard constraints, not',
          'suggestions — do not propose a task, feature or scope that contradicts any of them:',
          ...locked.map((c) => `- ${c}`),
          '',
        ]
      : []),
    'Acceptance criteria must be USER-OBSERVABLE behaviour — what a person using the product can see or do.',
    'Never mention files, functions, or implementation in a criterion.',
    'Also propose 2-4 invariants: things the product must NEVER do.',
    'Give every task its own `id` ("t1", "t2", …) and declare the order in `dependsOn`:',
    'if the write-up can only be written once the thing it describes is built, the write-up',
    'depends on the build. Only real ordering — a dependency that is not one just serialises work.',
    'Mark each task\'s `risk`: "high" if it is uncertain, novel, or several other tasks wait on it;',
    '"low" if it is routine. This is what decides which task the daemon picks up first.',
    'Also propose goal-oriented user journeys (what the user is trying to achieve, not a click script).',
    designRoot !== null
      ? `An approved design exists. Read it with \`list_files\` and \`read_file\` (${designFiles.length} files) and map each task to the design files it realises.`
      : 'There is no design — this is a headless product. Plan from the brief alone.',
    '',
    'Also include `title`: a short name (<=60 characters) for the project itself —',
    'a plain noun phrase naming what is being built, not a task and not a',
    'restatement of the brief.',
    '',
    'Call `submit_plan` exactly once, last.',
  ].join('\n');

  const controller = new AbortController();
  const provider = await getStudioProvider()({
    systemPrompt,
    prompt: `Plan the build for this brief:\n\n${brief}`,
    registry,
    cwd: designRoot ?? process.cwd(),
    signal: controller.signal,
    model: PLANNER_MODEL,
  });

  let stopReason = 'stop';
  for await (const event of runTurn({ provider, tools: registry, signal: controller.signal })) {
    if (event.type === 'turn_done') stopReason = event.stopReason;
  }

  if (plan === null) {
    // The model answered but not in the shape the contract needs — a parse
    // failure, which retries, not a backend one, which does not.
    throw new PreviewFailure(
      `planner finished (${stopReason}) without calling submit_plan — no breakdown was produced`,
      'parse',
    );
  }
  return plan;
}

export async function buildPromotePreview(
  projectId: string,
  request: PromotePreviewRequest,
): Promise<PromotePreview> {
  if (request.designId && request.brief) {
    throw new Error(
      'Send either `designId` or `brief`, not both — they name two different oracles',
    );
  }

  const source: 'design' | 'brief' = request.designId ? 'design' : 'brief';
  const designBaseline = request.designId
    ? await designBaselineFor(projectId, request.designId)
    : null;

  let brief = request.brief ?? '';
  if (designBaseline) {
    const manifest = await readManifest(projectId, designBaseline.designId);
    brief = manifest?.sourcePrompt ?? brief;
  } else {
    // Headless entrance: the stored brief is the single source of truth when
    // one exists. The web's brief page sends `brief.id` in this field (a
    // reference, not text) — planning from whatever string the client passed
    // meant the live planner saw an opaque "brf_…" id (d2 attempt-6 era bug).
    const stored = readBrief(projectId);
    if (stored?.prompt.trim()) brief = stored.prompt;
  }
  if (brief.trim() === '') {
    const projects = await getProjects();
    brief = projects.projects.find((p) => p.id === projectId)?.description ?? '';
  }
  if (brief.trim() === '') {
    throw new Error('Nothing to promote: no design, no brief, and the project has no description');
  }

  const empty = (
    error: string,
    causeKind: RunFailureCause,
    resumesAt: string | null = null,
  ): PromotePreview => ({
    projectId,
    source,
    designId: request.designId ?? null,
    tasks: [],
    criteria: [],
    holdoutNote: '',
    journeys: [],
    governor: governorEstimate(0),
    designBaseline,
    error,
    causeKind,
    resumesAt,
  });

  // The locked brief — not just whatever free text reached this call as
  // `brief` above — because the studio composer's prompt and the headless
  // entrance's raw string both carry only what a human happened to retype,
  // never the discovery answers a human already locked in. A locked
  // "no rounding" must reach every stage that could re-add it.
  const briefRecord = readBrief(projectId);
  const locked = briefRecord ? lockedConstraints(briefRecord) : [];

  let plan: SubmittedPlan;
  try {
    plan = await runPlanner(
      brief,
      locked,
      designBaseline ? sourceDir(projectId, designBaseline.designId) : null,
      designBaseline?.files.map((f) => f.path) ?? [],
    );
  } catch (err) {
    // Fail-honest: an unplanned promotion is reported as such, never guessed.
    // Anything that is not a class this function decided is the model wire
    // itself failing — a missing/unauthenticated CLI, a dead SDK stream.
    const message = err instanceof Error ? err.message : String(err);
    logger.error('studio', `Promote preview for ${projectId} failed: ${message}`);
    return err instanceof PreviewFailure
      ? empty(message, err.causeKind, err.resumesAt)
      : empty(message, 'backend');
  }

  // The proposal landing is the first point an LLM has actually read the
  // brief, so it is where the composer's no-LLM placeholder name (the raw
  // prompt's first line) gets to be replaced by a real one — but only that
  // placeholder: a human-typed name (`nameIsPlaceholder` false or absent)
  // always wins and the planner's title is dropped on the floor.
  if (plan.title) {
    await mutateProjects(async (data) => {
      const row = data.projects.find((p) => p.id === projectId);
      if (row?.nameIsPlaceholder) {
        row.name = plan.title!;
        row.nameIsPlaceholder = false;
      }
    });
  }

  // The planner's own id IS the tempId — validated unique and resolvable by
  // `parsePromotionPlan`, so `dependsOn` already speaks this vocabulary and the
  // commit step's map has something real to look up.
  const tasks: ProposedTask[] = plan.tasks.map((task) => ({
    tempId: task.id,
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
    designFilePaths: task.designFilePaths,
    risk: task.risk,
  }));

  // The holdout split is computed here so the sheet shows the real one — not an
  // approximation the compiler later disagrees with. Same function, same salt.
  const criteria: ProposedCriterion[] = tasks.flatMap((task) => {
    const scoped = assignHoldouts(
      [
        ...task.acceptanceCriteria.map((text, i) => ({
          id: `crit_${i + 1}`,
          kind: 'criterion' as const,
          text,
          holdout: false,
          provenance: { source: 'promote.plan', quote: text },
        })),
        ...plan.invariants.map((text, i) => ({
          id: `inv_${i + 1}`,
          kind: 'invariant' as const,
          text,
          holdout: true,
          provenance: { source: 'promote.plan', quote: text },
        })),
      ],
      task.tempId,
    );
    return scoped.map((c) => ({
      taskTempId: task.tempId,
      text: c.text,
      kind: c.kind,
      holdout: c.holdout,
      quote: c.provenance?.quote ?? c.text,
    }));
  });

  const journeys: PromoteProposedJourney[] = plan.journeys.map((journey, i) => ({
    tempId: `j${i + 1}`,
    title: journey.title,
    goal: journey.goal,
    steps: journey.steps,
  }));

  // The shape decides the panel, and the panel is most of the cost. An absent
  // one falls back to the estimator's fail-expensive "ui" default.
  const shape = (await getProjects()).projects.find((p) => p.id === projectId)?.shape;

  return {
    projectId,
    // Minted here, burned by the first commit — see PromotePreview.nonce (P5).
    nonce: generateId('promo'),
    source,
    designId: request.designId ?? null,
    tasks,
    criteria,
    holdoutNote: holdoutNote(criteria),
    journeys,
    governor: governorEstimate(tasks.length, shape),
    designBaseline,
    error: null,
    causeKind: null,
    resumesAt: null,
  };
}

// ─── Commit ──────────────────────────────────────────────────────────────────

/**
 * A commit refused because this exact preview was already committed. Carries
 * its own type so the route can answer 409 rather than folding a replay into
 * the same 400 a malformed body gets (P5).
 */
export class PromoteAlreadyCommittedError extends Error {
  constructor(nonce: string) {
    super(
      `This promote preview (${nonce}) was already committed. Its tasks and contracts exist — re-run the preview if you want to promote again.`,
    );
    this.name = 'PromoteAlreadyCommittedError';
  }
}

export async function commitPromote(
  projectId: string,
  request: PromoteRequest,
): Promise<PromoteResult> {
  const preview = request.preview;
  if (preview.error !== null) {
    throw new Error(`Refusing to promote a preview that reported an error: ${preview.error}`);
  }
  if (preview.tasks.length === 0) throw new Error('Refusing to promote an empty task breakdown');
  if (preview.projectId !== projectId) {
    throw new Error(`Preview is for project ${preview.projectId}, not ${projectId}`);
  }
  // Before anything lands. A preview minted before nonces existed carries none
  // and keeps the old at-most-once-by-convention behaviour.
  if (preview.nonce && !claimPromoteNonce(projectId, preview.nonce)) {
    throw new PromoteAlreadyCommittedError(preview.nonce);
  }

  // Tasks land first so the contracts have a scope to be compiled against.
  const idByTempId = new Map<string, string>();
  for (const task of preview.tasks) idByTempId.set(task.tempId, generateId('task'));

  // Promote means "the daemon picks these up" (F1 step 4) — tasks must land
  // dispatchable: kanban not-started and assigned to a real build agent, or
  // getPendingTasks() will never see them.
  const builderId = await ensureBuilderAgent();

  await mutateTasks(async (data) => {
    const now = new Date().toISOString();
    for (const task of preview.tasks) {
      data.tasks.push({
        id: idByTempId.get(task.tempId)!,
        title: task.title,
        description: task.description,
        importance: 'important',
        // The planner's risk call, not a stamp. Everything promoted is
        // important (it is the plan); risk is what separates "start this now"
        // from "schedule it", which is what made the Eisenhower sort a no-op
        // and left dispatch order equal to plan order. A preview from before
        // `risk` existed carries none, and reads as the old default.
        urgency: task.risk === 'high' ? 'urgent' : 'not-urgent',
        kanban: 'not-started',
        verificationStatus: 'unverified',
        projectId,
        milestoneId: null,
        assignedTo: builderId,
        collaborators: [],
        dailyActions: [],
        subtasks: [],
        // Task has no dependsOn — blockedBy is the field the dispatcher honors.
        // Every ref resolves: the preview refused any plan whose deps did not.
        blockedBy: task.dependsOn.map((dep) => {
          const id = idByTempId.get(dep);
          if (id === undefined) {
            throw new Error(
              `Task "${task.title}" depends on "${dep}", which is not in this preview`,
            );
          }
          return id;
        }),
        estimatedMinutes: null,
        actualMinutes: null,
        acceptanceCriteria: task.acceptanceCriteria,
        comments: [],
        tags: [],
        notes: '',
        dueDate: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        deletedAt: null,
        // The design this task realises, carried onto the board so the card can
        // show what it is building and the drawer can link back to it (§8.3
        // "no dead ends"). Absent on the headless entrance, which is normal.
        designId: preview.designId,
        designFilePaths: task.designFilePaths,
      });
    }
  });

  const promoted: PromotedTask[] = [];
  for (const task of preview.tasks) {
    const taskId = idByTempId.get(task.tempId)!;
    const criteria = preview.criteria
      .filter((c) => c.taskTempId === task.tempId)
      .map((c) => ({ text: c.text, kind: c.kind, quote: c.quote }));
    const contract = compilePromotedContract({
      taskId,
      title: task.title,
      criteria,
      ...(preview.designBaseline ? { designBaseline: preview.designBaseline } : {}),
    });
    promoted.push({
      tempId: task.tempId,
      taskId,
      contractId: contract.id,
      contractVersion: contract.version,
      visibleCriteria: contract.criteria.filter((c) => !c.holdout).length,
      holdoutCriteria: contract.criteria.filter((c) => c.holdout).length,
    });
  }

  // Journeys go in-repo (twin-primitives: `.ligma/journeys/`), so they only
  // land when the project actually has a repo to put them in.
  const journeyIds: string[] = [];
  const journeysDropped: PromoteResult['journeysDropped'] = [];
  const projects = await getProjects();
  const repoPath = (
    projects.projects.find((p) => p.id === projectId) as { repoPath?: string | null } | undefined
  )?.repoPath;
  if (repoPath) {
    for (const journey of preview.journeys) {
      try {
        journeyIds.push(
          writeJourney(repoPath, {
            title: journey.title,
            goal: journey.goal,
            steps: journey.steps,
            tags: [],
            origin: 'human',
            schedule: null,
          }).id,
        );
      } catch (err) {
        // A journey that will not write must not roll back signed contracts —
        // but it must not vanish into a daemon log either, or the 201 promises
        // the reviewer a journey the commit discarded (P6).
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('studio', `Could not write journey "${journey.title}": ${reason}`);
        journeysDropped.push({ title: journey.title, reason });
      }
    }
  } else if (preview.journeys.length > 0) {
    for (const journey of preview.journeys) {
      journeysDropped.push({
        title: journey.title,
        reason: "the project has no repoPath — journeys live in the target repo's .ligma/journeys/",
      });
    }
  }

  // The moment a contract compiled against this brief. `editFlagsStale` reads
  // exactly this field, and nothing wrote it — so the pinned default "editing a
  // brief after contract compilation flags dependents stale" was dead code and
  // the stale-brief card was reachable only by the age trigger (P4).
  const brief = readBrief(projectId);
  if (brief && brief.compiledAt === null) {
    writeBrief({ ...brief, status: 'compiled', compiledAt: new Date().toISOString() });
  }

  if (preview.designId) {
    await mutateManifest(projectId, preview.designId, (manifest) => {
      manifest.promotedContractId = promoted[0]?.contractId ?? null;
    });
  }

  // The moment a design (or a brief) became work the daemon will pick up. This
  // is the one event on the project timeline that explains where a batch of
  // tasks suddenly came from, so it names the count and the source rather than
  // leaving the reader to infer a promotion from a burst of task_created rows.
  await mutateActivityLog(async (logData) => {
    logData.events.push({
      id: generateId('evt'),
      type: 'promote',
      actor: 'system',
      taskId: null,
      projectId,
      summary: `Promoted ${promoted.length} task${promoted.length === 1 ? '' : 's'} to build`,
      details: `from ${preview.source}${preview.designId ? ` design:${preview.designId}` : ''}, ${journeyIds.length} journey(s)`,
      timestamp: new Date().toISOString(),
    });
  });

  return {
    projectId,
    source: preview.source,
    designId: preview.designId,
    tasks: promoted,
    journeyIds,
    journeysDropped,
    designBaselineIngested: preview.designBaseline !== null,
  };
}
