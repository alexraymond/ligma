import { DEFAULT_LIMIT, LIMITS, PROJECT_SHAPES } from '@ligma/api';
import { z } from 'zod';
import { NextResponse } from '../http';

export { DEFAULT_LIMIT, LIMITS };

// ─── Shared enums ──────────────────────────────────────────────────────────────

const importanceEnum = z.enum(['important', 'not-important']);
const urgencyEnum = z.enum(['urgent', 'not-urgent']);
const kanbanEnum = z.enum(['not-started', 'in-progress', 'awaiting-verification', 'done']);
const verificationStatusEnum = z.enum(['unverified', 'in-review', 'passed', 'failed', 'waived']);
const goalTypeEnum = z.enum(['long-term', 'medium-term']);
const goalStatusEnum = z.enum(['not-started', 'in-progress', 'completed']);
const projectStatusEnum = z.enum(['active', 'paused', 'completed', 'archived']);
// Derived from PROJECT_SHAPES — a shape added to the API must not be refused here.
const projectShapeEnum = z.enum(PROJECT_SHAPES);
// Relaxed from fixed enum to string — validated against agent registry at runtime.
const agentRoleEnum = z.string().min(1).max(50);
const actorEnum = z.string().min(1).max(50);
const messageTypeEnum = z.enum(['delegation', 'report', 'question', 'update', 'approval']);
const messageStatusEnum = z.enum(['unread', 'read', 'archived']);
const decisionStatusEnum = z.enum(['pending', 'answered']);
const eventTypeEnum = z.enum([
  'task_created',
  'task_updated',
  'task_completed',
  'task_delegated',
  'message_sent',
  'decision_requested',
  'decision_answered',
  'brain_dump_triaged',
  'milestone_completed',
  'agent_checkin',
  'run',
  'verdict',
  'promote',
  'design_turn',
]);

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

const dailyActionSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(LIMITS.SUBTASK_TITLE),
  done: z.boolean(),
  date: z.string().max(30),
});

const subtaskSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(LIMITS.SUBTASK_TITLE),
  done: z.boolean(),
});

const commentSchema = z.object({
  id: z.string().max(100),
  author: actorEnum,
  content: z.string().max(LIMITS.COMMENT_CONTENT),
  createdAt: z.string().max(30),
});

// ─── Task schemas ──────────────────────────────────────────────────────────────

export const taskCreateSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(LIMITS.TITLE, `Title must be under ${LIMITS.TITLE} characters`),
  description: z.string().max(LIMITS.DESCRIPTION).optional().default(''),
  importance: importanceEnum.optional().default('not-important'),
  urgency: urgencyEnum.optional().default('not-urgent'),
  kanban: kanbanEnum.optional().default('not-started'),
  verificationStatus: verificationStatusEnum.optional().default('unverified'),
  reviewed: z.boolean().optional(),
  verificationAttempts: z.number().int().min(0).optional(),
  projectId: z.string().nullable().optional().default(null),
  milestoneId: z.string().nullable().optional().default(null),
  assignedTo: agentRoleEnum.nullable().optional().default(null),
  collaborators: z.array(z.string().max(50)).max(20).optional().default([]),
  dailyActions: z.array(dailyActionSchema).max(LIMITS.MAX_DAILY_ACTIONS).optional().default([]),
  subtasks: z.array(subtaskSchema).max(LIMITS.MAX_SUBTASKS).optional().default([]),
  blockedBy: z.array(z.string()).max(LIMITS.MAX_BLOCKED_BY).optional().default([]),
  estimatedMinutes: z.number().min(0).max(LIMITS.MAX_MINUTES).nullable().optional().default(null),
  actualMinutes: z.number().min(0).max(LIMITS.MAX_MINUTES).nullable().optional().default(null),
  acceptanceCriteria: z
    .array(z.string().max(LIMITS.SUBTASK_TITLE))
    .max(LIMITS.MAX_CRITERIA)
    .optional()
    .default([]),
  comments: z.array(commentSchema).max(LIMITS.MAX_COMMENTS).optional().default([]),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional().default([]),
  notes: z.string().max(LIMITS.NOTES).optional().default(''),
  dueDate: z.string().max(30).nullable().optional().default(null),
  deletedAt: z.string().nullable().optional().default(null),
});

export const taskUpdateSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  title: z.string().min(1).max(LIMITS.TITLE).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  importance: importanceEnum.optional(),
  urgency: urgencyEnum.optional(),
  kanban: kanbanEnum.optional(),
  // No .default() here — PATCH spreads the parsed body, so a default would
  // silently reset a "passed" verification on every unrelated update.
  verificationStatus: verificationStatusEnum.optional(),
  reviewed: z.boolean().optional(),
  verificationAttempts: z.number().int().min(0).optional(),
  projectId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  assignedTo: agentRoleEnum.nullable().optional(),
  collaborators: z.array(z.string().max(50)).max(20).optional(),
  dailyActions: z.array(dailyActionSchema).max(LIMITS.MAX_DAILY_ACTIONS).optional(),
  subtasks: z.array(subtaskSchema).max(LIMITS.MAX_SUBTASKS).optional(),
  blockedBy: z.array(z.string()).max(LIMITS.MAX_BLOCKED_BY).optional(),
  estimatedMinutes: z.number().min(0).max(LIMITS.MAX_MINUTES).nullable().optional(),
  actualMinutes: z.number().min(0).max(LIMITS.MAX_MINUTES).nullable().optional(),
  acceptanceCriteria: z
    .array(z.string().max(LIMITS.SUBTASK_TITLE))
    .max(LIMITS.MAX_CRITERIA)
    .optional(),
  comments: z.array(commentSchema).max(LIMITS.MAX_COMMENTS).optional(),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional(),
  notes: z.string().max(LIMITS.NOTES).optional(),
  dueDate: z.string().max(30).nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

// ─── Goal schemas ──────────────────────────────────────────────────────────────

export const goalCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(LIMITS.TITLE),
  type: goalTypeEnum.optional().default('medium-term'),
  timeframe: z.string().max(100).optional().default(''),
  parentGoalId: z.string().nullable().optional().default(null),
  projectId: z.string().nullable().optional().default(null),
  status: goalStatusEnum.optional().default('not-started'),
  milestones: z.array(z.string()).max(LIMITS.MAX_MILESTONES).optional().default([]),
  tasks: z.array(z.string()).max(LIMITS.MAX_TASKS).optional().default([]),
  deletedAt: z.string().nullable().optional().default(null),
});

export const goalUpdateSchema = z.object({
  id: z.string().min(1, 'Goal ID is required'),
  title: z.string().min(1).max(LIMITS.TITLE).optional(),
  type: goalTypeEnum.optional(),
  timeframe: z.string().max(100).optional(),
  parentGoalId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  status: goalStatusEnum.optional(),
  milestones: z.array(z.string()).max(LIMITS.MAX_MILESTONES).optional(),
  tasks: z.array(z.string()).max(LIMITS.MAX_TASKS).optional(),
  deletedAt: z.string().nullable().optional(),
});

// ─── Project schemas ───────────────────────────────────────────────────────────

export const projectCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(LIMITS.TITLE),
  description: z.string().max(LIMITS.DESCRIPTION).optional().default(''),
  status: projectStatusEnum.optional().default('active'),
  color: z.string().max(20).optional().default('#6B7280'),
  teamMembers: z.array(z.string().max(50)).max(20).optional().default([]),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional().default([]),
  deletedAt: z.string().nullable().optional().default(null),
  repoPath: z.string().max(1000).nullable().optional(),
  shape: projectShapeEnum.optional(),
});

export const projectUpdateSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  name: z.string().min(1).max(LIMITS.TITLE).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  status: projectStatusEnum.optional(),
  color: z.string().max(20).optional(),
  teamMembers: z.array(z.string().max(50)).max(20).optional(),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional(),
  deletedAt: z.string().nullable().optional(),
  repoPath: z.string().max(1000).nullable().optional(),
  shape: projectShapeEnum.optional(),
});

/** PATCH /api/projects/:id — the id travels in the path, not the body. */
export const projectPatchSchema = projectUpdateSchema.omit({ id: true });

// ─── Brain Dump schemas ────────────────────────────────────────────────────────

export const brainDumpCreateSchema = z.object({
  id: z.string().optional(),
  content: z.string().min(1, 'Content is required').max(LIMITS.CONTENT),
  capturedAt: z.string().max(30).optional(),
  processed: z.boolean().optional().default(false),
  convertedTo: z.string().nullable().optional().default(null),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional().default([]),
});

export const brainDumpUpdateSchema = z.object({
  id: z.string().min(1, 'Entry ID is required'),
  content: z.string().min(1).max(LIMITS.CONTENT).optional(),
  processed: z.boolean().optional(),
  convertedTo: z.string().nullable().optional(),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional(),
});

// ─── Inbox schemas ─────────────────────────────────────────────────────────────

export const inboxCreateSchema = z.object({
  id: z.string().optional(),
  from: actorEnum.optional().default('me'),
  to: agentRoleEnum,
  type: messageTypeEnum.optional().default('update'),
  taskId: z.string().nullable().optional().default(null),
  subject: z.string().min(1, 'Subject is required').max(LIMITS.SUBJECT),
  body: z.string().max(LIMITS.BODY).optional().default(''),
  createdAt: z.string().max(30).optional(),
});

export const inboxUpdateSchema = z.object({
  id: z.string().min(1, 'Message ID is required'),
  status: messageStatusEnum.optional(),
  readAt: z.string().max(30).nullable().optional(),
  from: actorEnum.optional(),
  to: agentRoleEnum.optional(),
  type: messageTypeEnum.optional(),
  taskId: z.string().nullable().optional(),
  subject: z.string().max(LIMITS.SUBJECT).optional(),
  body: z.string().max(LIMITS.BODY).optional(),
});

// ─── Decision schemas ──────────────────────────────────────────────────────────

export const decisionCreateSchema = z.object({
  id: z.string().optional(),
  requestedBy: actorEnum.optional().default('developer'),
  taskId: z.string().nullable().optional().default(null),
  question: z.string().min(1, 'Question is required').max(LIMITS.QUESTION),
  options: z.array(z.string().max(LIMITS.ANSWER)).max(LIMITS.MAX_OPTIONS).optional().default([]),
  context: z.string().max(LIMITS.CONTEXT).optional().default(''),
  blocksTask: z.boolean().optional(),
  createdAt: z.string().max(30).optional(),
});

export const decisionUpdateSchema = z.object({
  id: z.string().min(1, 'Decision ID is required'),
  status: decisionStatusEnum.optional(),
  answer: z.string().max(LIMITS.ANSWER).nullable().optional(),
  question: z.string().max(LIMITS.QUESTION).optional(),
  options: z.array(z.string().max(LIMITS.ANSWER)).max(LIMITS.MAX_OPTIONS).optional(),
  context: z.string().max(LIMITS.CONTEXT).optional(),
  requestedBy: actorEnum.optional(),
  taskId: z.string().nullable().optional(),
  blocksTask: z.boolean().optional(),
  deferUntil: z.string().max(30).nullable().optional(),
  deferCount: z.number().int().min(0).optional(),
  urgentAt: z.string().max(30).nullable().optional(),
  // Written by whoever APPLIES the answer (the amend path today). Optional, so
  // every existing client that never sends it keeps validating.
  consequenceTaskIds: z.array(z.string().max(100)).max(200).optional(),
});

// ─── Activity Log schemas ──────────────────────────────────────────────────────

export const activityEventCreateSchema = z.object({
  id: z.string().optional(),
  type: eventTypeEnum,
  actor: actorEnum.optional().default('system'),
  taskId: z.string().nullable().optional().default(null),
  // Optional, NOT defaulted: an omitted projectId must stay omitted rather than
  // become an explicit null, so a row that simply predates Phase 2 is
  // distinguishable from one a writer deliberately scoped to no project.
  projectId: z.string().max(100).nullable().optional(),
  summary: z.string().min(1, 'Summary is required').max(LIMITS.SUBJECT),
  details: z.string().max(LIMITS.DESCRIPTION).optional().default(''),
  timestamp: z.string().max(30).optional(),
});

// ─── Agent schemas ───────────────────────────────────────────────────────────

const agentStatusEnum = z.enum(['active', 'inactive']);

export const agentCreateSchema = z.object({
  id: z
    .string()
    .min(1, 'ID is required')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1, 'Name is required').max(LIMITS.TITLE),
  icon: z.string().max(50).optional().default('Bot'),
  description: z.string().max(LIMITS.DESCRIPTION).optional().default(''),
  instructions: z.string().max(20000).optional().default(''),
  capabilities: z.array(z.string().max(100)).max(50).optional().default([]),
  skillIds: z.array(z.string().max(100)).max(50).optional().default([]),
  status: agentStatusEnum.optional().default('active'),
});

export const agentUpdateSchema = z.object({
  id: z.string().min(1, 'Agent ID is required'),
  name: z.string().min(1).max(LIMITS.TITLE).optional(),
  icon: z.string().max(50).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  instructions: z.string().max(20000).optional(),
  capabilities: z.array(z.string().max(100)).max(50).optional(),
  skillIds: z.array(z.string().max(100)).max(50).optional(),
  status: agentStatusEnum.optional(),
});

// ─── Skill schemas ──────────────────────────────────────────────────────────

/**
 * A skill id is a DIRECTORY NAME: `sync-commands.ts` does
 * `path.join(SKILLS_DIR, skill.id)` + mkdir + writeFile, so an unconstrained id
 * was an arbitrary-file-write ("../../evil" wrote outside the skills dir —
 * codebase audit R2). Same trust boundary `assertSafeId` guards elsewhere, and
 * the same pattern, which also keeps `generateId("skill")`'s nanoid (mixed case,
 * `_`/`-`) valid so existing rows stay updatable.
 */
const SKILL_ID = z
  .string()
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Skill ID must match /^[A-Za-z0-9_-]+$/ — it is used as a directory name',
  );

export const skillCreateSchema = z.object({
  id: SKILL_ID.optional(),
  name: z.string().min(1, 'Name is required').max(LIMITS.TITLE),
  description: z.string().max(LIMITS.DESCRIPTION).optional().default(''),
  content: z.string().max(50000).optional().default(''),
  agentIds: z.array(z.string().max(50)).max(20).optional().default([]),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional().default([]),
});

export const skillUpdateSchema = z.object({
  id: SKILL_ID.min(1, 'Skill ID is required'),
  name: z.string().min(1).max(LIMITS.TITLE).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  content: z.string().max(50000).optional(),
  agentIds: z.array(z.string().max(50)).max(20).optional(),
  tags: z.array(z.string().max(LIMITS.TAG)).max(LIMITS.MAX_TAGS).optional(),
});

// ─── Promote schemas ───────────────────────────────────────────────────────────

/**
 * `POST /api/projects/:id/promote` — the most consequential write in the
 * product, and until now the only one that took its body as `jsonBody` + a cast.
 *
 * Two things that cost real damage rode in through that gap (process audit P6):
 * a criterion `kind` outside `"criterion" | "invariant"` slipped past
 * `assignHoldouts`' "at least one visible criterion" repair and produced a
 * signed contract the builder could not see any of; and journeys of the wrong
 * shape were dropped inside a per-journey catch while the 201 reported success.
 *
 * `.strict()` is deliberate on the leaf objects: a preview is echoed back from
 * a preview call, so an unexpected key means the client built it by hand, and
 * silently dropping the key is how a reviewed sheet and a compiled contract
 * come to disagree.
 */
const proposedTaskSchema = z
  .object({
    tempId: z.string().min(1).max(64),
    title: z.string().min(1).max(LIMITS.TITLE),
    description: z.string().max(LIMITS.DESCRIPTION).default(''),
    acceptanceCriteria: z.array(z.string().min(1).max(2000)).max(50).default([]),
    dependsOn: z.array(z.string().min(1).max(64)).max(50).default([]),
    designFilePaths: z.array(z.string().max(500)).max(100).default([]),
    risk: z.enum(['low', 'high']).optional(),
  })
  .strict();

const proposedCriterionSchema = z
  .object({
    taskTempId: z.string().min(1).max(64),
    text: z.string().min(1).max(2000),
    // The field that was flying blind. CriterionKind, exactly.
    kind: z.enum(['criterion', 'invariant']),
    holdout: z.boolean(),
    quote: z.string().max(2000).default(''),
  })
  .strict();

const proposedJourneySchema = z
  .object({
    tempId: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    goal: z.string().min(1).max(2000),
    steps: z.array(z.string().min(1).max(500)).max(50).default([]),
  })
  .strict();

const designFileRefSchema = z
  .object({
    path: z.string().min(1).max(500),
    fingerprint: z.string().min(1).max(128),
    byteSize: z.number().int().min(0),
  })
  .strict();

const designBaselineRefSchema = z
  .object({
    designId: z.string().min(1).max(64),
    versionId: z.string().min(1).max(64),
    approvedAt: z.string().min(1).max(64),
    designSystem: z.string().max(200).nullable(),
    files: z.array(designFileRefSchema).max(500),
  })
  .strict();

/** Disclosure only — the commit reads none of it, so the bounds are loose. */
const governorEstimateSchema = z.object({
  estimatedSpawns: z.number().int().min(0),
  maxSpawns: z.number().int().min(0).optional(),
  windowHours: z.number(),
  used: z.number(),
  max: z.number(),
  reserveFloor: z.number(),
  remainingForAutonomy: z.number(),
  willDefer: z.boolean(),
  killSwitch: z.boolean(),
});

export const promotePreviewSchema = z.object({
  projectId: z.string().min(1).max(64),
  nonce: z.string().min(1).max(64).optional(),
  source: z.enum(['design', 'brief']),
  designId: z.string().min(1).max(64).nullable(),
  tasks: z.array(proposedTaskSchema).min(1, 'Refusing to promote an empty task breakdown').max(100),
  criteria: z.array(proposedCriterionSchema).max(1000),
  holdoutNote: z.string().max(2000).default(''),
  journeys: z.array(proposedJourneySchema).max(100).default([]),
  governor: governorEstimateSchema,
  designBaseline: designBaselineRefSchema.nullable(),
  error: z.string().nullable(),
  causeKind: z
    .enum(['auth', 'rate-limit', 'parse', 'backend', 'env', 'harness'])
    .nullable()
    .optional(),
  resumesAt: z.string().max(64).nullable().optional(),
});

export const promoteRequestSchema = z.object({
  preview: promotePreviewSchema,
});

// ─── Daemon Config schemas ─────────────────────────────────────────────────────

const scheduleEntrySchema = z.object({
  enabled: z.boolean(),
  cron: z.string().min(1).max(200),
  command: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Command must be lowercase alphanumeric with hyphens'),
});

export const daemonConfigUpdateSchema = z
  .object({
    polling: z
      .object({
        enabled: z.boolean(),
        intervalMinutes: z.number().int().min(1).max(60),
      })
      .optional(),
    concurrency: z
      .object({
        maxParallelAgents: z.number().int().min(1).max(10),
      })
      .optional(),
    schedule: z.record(z.string().max(50), scheduleEntrySchema).optional(),
    execution: z
      .object({
        maxTurns: z.number().int().min(1).max(100),
        timeoutMinutes: z.number().int().min(1).max(120),
        retries: z.number().int().min(0).max(5),
        retryDelayMinutes: z.number().int().min(1).max(30),
        skipPermissions: z.boolean(),
        allowedTools: z.array(z.string().min(1).max(100)).max(50),
        agentTeams: z.boolean(),
        claudeBinaryPath: z.string().nullable(),
        backendMode: z.enum(['claude', 'mixed', 'codex', 'gemini']),
        codexTaskTags: z.array(z.string().min(1).max(100)).max(50),
        codexBinaryPath: z.string().nullable(),
        codexModel: z.string().nullable(),
        geminiTaskTags: z.array(z.string().min(1).max(100)).max(50),
        geminiBinaryPath: z.string().nullable(),
        geminiModel: z.string().nullable(),
        claudeAutoFailoverEnabled: z.boolean(),
        claudeAutoFailoverThreshold: z.number().int().min(1).max(10),
        claudeAutoFailoverBackend: z.enum(['codex', 'gemini']).nullable(),
        // Additive/optional: an old client that doesn't send it leaves the daemon's
        // current value alone (route.ts spreads updates.execution over the existing block).
        workerModel: z.string().min(1).nullable().optional(),
        // OD-092 cross-session memory. Bounds MUST match engine/config.ts (1..500).
        memory: z
          .object({
            enabled: z.boolean(),
            maxEntries: z.number().int().min(1).max(500),
          })
          .optional(),
        // Optional blocks with daemon-side defaults (scripts/daemon/config.ts).
        // They must be declared here or UI config saves silently strip them.
        harness: z
          .object({
            autoVerify: z.boolean(),
            maxParallelPersonas: z.number().int().min(1).max(8),
            // Bounds MUST match scripts/daemon/config.ts validateConfig — a value the UI
            // accepts but the daemon rejects silently reverts to defaults, so the
            // dashboard shows one setting while the daemon runs another.
            naiveUserRuns: z.number().int().min(1).max(5),
            maxVerificationAttempts: z.number().int().min(1).max(10),
            judgeModel: z.string().min(1).nullable(),
            personaModel: z.string().min(1).nullable().optional(),
          })
          .optional(),
        governor: z
          .object({
            enabled: z.boolean(),
            windowHours: z.number().min(1).max(168),
            maxSessionsPerWindow: z.number().int().min(1).max(1000),
            reservePercent: z.number().min(0).max(100),
            killSwitch: z.boolean(),
            roleRouting: z.object({
              builder: z.enum(['claude', 'codex', 'gemini']),
              persona: z.enum(['claude', 'codex', 'gemini']),
              judge: z.enum(['claude', 'codex', 'gemini']),
              scheduled: z.enum(['claude', 'codex', 'gemini']).optional(),
            }),
          })
          .optional(),
      })
      .optional(),
    // OD-097: the product-repo root override. Whole-section replace, same as
    // polling/concurrency — there is only one field, no merge-by-field needed.
    storage: z
      .object({
        productsDir: z.string().max(1000).nullable(),
      })
      .optional(),
    // OD-096: the desktop-notification toggle.
    notifications: z
      .object({
        desktopEnabled: z.boolean(),
      })
      .optional(),
  })
  .strict();

// ─── Validation helper ─────────────────────────────────────────────────────────

type ValidationSuccess<T> = { success: true; data: T };
type ValidationFailure = { success: false; error: NextResponse };
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export async function validateBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ValidationResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      success: false,
      error: NextResponse.json(
        { error: 'Validation failed', details: fieldErrors },
        { status: 400 },
      ),
    };
  }

  return { success: true, data: result.data };
}
