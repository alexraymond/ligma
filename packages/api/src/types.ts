import type { SmokeDigest } from './journeys';
import type { ProjectShape } from './shapes';

export type Importance = 'important' | 'not-important';
export type Urgency = 'urgent' | 'not-urgent';
export type KanbanStatus = 'not-started' | 'in-progress' | 'awaiting-verification' | 'done';
/** Whether an acceptance harness has verified the task's work. "done" requires "passed". */
/**
 * "waived" = no oracle exists (the task carries no acceptance criteria), so the
 * task is complete but nothing was verified. It is deliberately a distinct value
 * from "passed": the UI must never present an unverified completion as a verified
 * one, and it must never leave such a task stuck in limbo either.
 */
export type VerificationStatus = 'unverified' | 'in-review' | 'passed' | 'failed' | 'waived';
export type GoalType = 'long-term' | 'medium-term';
export type GoalStatus = 'not-started' | 'in-progress' | 'completed';
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
// AgentRole is now a string validated against the agent registry at runtime.
// Built-in roles are kept as a type for backward compatibility.
export type BuiltInAgentRole = 'me' | 'researcher' | 'developer' | 'marketer' | 'business-analyst';
export type AgentRole = string;

// Legacy constant kept for backward compat — UI should prefer dynamic agents from API.
export const AGENT_ROLES: {
  id: BuiltInAgentRole;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: 'me', label: 'Me', icon: 'User', description: 'Tasks I do myself' },
  {
    id: 'researcher',
    label: 'Researcher',
    icon: 'Search',
    description: 'Market research, analysis, evaluation',
  },
  {
    id: 'developer',
    label: 'Developer',
    icon: 'Code',
    description: 'Implementation, bug fixes, testing',
  },
  {
    id: 'marketer',
    label: 'Marketer',
    icon: 'Megaphone',
    description: 'Copy, growth strategy, content',
  },
  {
    id: 'business-analyst',
    label: 'Business Analyst',
    icon: 'BarChart3',
    description: 'Strategy, planning, prioritization',
  },
];

// ─── Agent Definition (dynamic registry) ──────────────────────────────────────

export type AgentStatus = 'active' | 'inactive';

export interface AgentDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  instructions: string;
  capabilities: string[];
  skillIds: string[];
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsFile {
  agents: AgentDefinition[];
}

// ─── Skill Definition (skills library) ────────────────────────────────────────

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  content: string;
  agentIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillsLibraryFile {
  skills: SkillDefinition[];
}

// ─── AI Skills (slash commands) ───────────────────────────────────────────────

export interface SkillInfo {
  command: string;
  label: string;
  description: string;
  longDescription: string;
}

export const SKILLS: SkillInfo[] = [
  {
    command: '/standup',
    label: 'Daily Standup',
    description: 'Daily standup summary',
    longDescription:
      'Generates a standup report from git commits, in-progress tasks, inbox messages, and goal progress.',
  },
  {
    command: '/daily-plan',
    label: 'Daily Plan',
    description: 'Create daily plan',
    longDescription:
      'Creates a focused daily plan with top priorities, brain dump triage, pending decisions, and time blocks.',
  },
  {
    command: '/weekly-review',
    label: 'Weekly Review',
    description: 'Weekly review',
    longDescription:
      'Analyzes the week: tasks completed, goal progress, Eisenhower health, stale items, and next-week recommendations.',
  },
  {
    command: '/brainstorm',
    label: 'Brainstorm',
    description: 'Brainstorm ideas',
    longDescription:
      'Generates 10-15 creative ideas from multiple angles: technical, marketing, UX, business model, and partnerships.',
  },
  {
    command: '/research',
    label: 'Research',
    description: 'Research a topic',
    longDescription:
      'Researches a topic with web search, then saves structured findings to research/ with key insights and recommendations.',
  },
  {
    command: '/plan-feature',
    label: 'Plan Feature',
    description: 'Plan a feature',
    longDescription:
      'Breaks a feature into tasks with subtasks, estimates, dependencies, and creates a milestone with linked tasks.',
  },
  {
    command: '/ship-feature',
    label: 'Ship Feature',
    description: 'Ship a feature',
    longDescription:
      'Tests, lints, commits, updates task status, posts completion report to inbox, and logs activity.',
  },
  {
    command: '/pick-up-work',
    label: 'Pick Up Work',
    description: 'Check for new assignments',
    longDescription:
      'Checks inbox for new delegations, reviews pending tasks, and picks up the highest-priority unblocked work.',
  },
  {
    command: '/report',
    label: 'Report',
    description: 'Post a status report',
    longDescription:
      'Posts a status update or completion report to the inbox and logs the activity for the user to review.',
  },
  {
    command: '/orchestrate',
    label: 'Orchestrate',
    description: 'Run all agents',
    longDescription:
      'Meta-command that reads pending tasks, groups them by agent, and spawns sub-agents to execute work using their full personas and skills.',
  },
];

// ─── Daily Actions ────────────────────────────────────────────────────────────

export interface DailyAction {
  id: string;
  title: string;
  done: boolean;
  date: string;
}

// ─── Subtasks ─────────────────────────────────────────────────────────────────

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

// ─── Task Comments ───────────────────────────────────────────────────────────

export interface TaskComment {
  id: string;
  author: AgentRole | 'system';
  content: string;
  createdAt: string;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description: string;
  importance: Importance;
  urgency: Urgency;
  kanban: KanbanStatus;
  verificationStatus: VerificationStatus;
  projectId: string | null;
  milestoneId: string | null;
  assignedTo: AgentRole | null;
  collaborators: string[];
  dailyActions: DailyAction[];
  subtasks: Subtask[];
  blockedBy: string[];
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  acceptanceCriteria: string[];
  comments: TaskComment[];
  tags: string[];
  notes: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  /** Human acknowledged a completed agent task (upstream b6224c2). */
  reviewed?: boolean;
  /** Verification runs attempted since the last successful build; caps respawn storms. */
  verificationAttempts?: number;
  /**
   * The approved design this task realises, and the design files it covers —
   * carried through Promote so the board card can show what it is building and
   * the drawer can link back to it ("what made this", seam rule §8.3). Absent
   * on headless projects, which is normal, not missing.
   */
  designId?: string | null;
  designFilePaths?: string[];
  /**
   * Set when the human defers this task from the Runs surface. The dispatcher
   * skips it until the time passes; nothing else reads it, and it is cleared
   * when the task next runs.
   */
  deferredUntil?: string | null;
  /**
   * Why the dispatcher last skipped this task, in a sentence — unanswered
   * decisions piling up, or the retry limit reached.
   *
   * Written by the dispatcher as it decides, and cleared by the same pass when
   * the condition lifts, so it is never a stale claim. It exists because the
   * most common parked state used to be invisible: the ≥3-pending-decisions park
   * produced 413 log lines and no UI at all (execution-flow-review H4).
   */
  parkedReason?: string | null;
  /**
   * **Wire-only, never stored.** The latest verification run for this task,
   * joined server-side by `GET /api/tasks` so a board of fifty cards costs zero
   * extra fetches. Absent when the task has never been verified.
   */
  lastVerificationRunId?: string | null;
  /** Wire-only: when that run finished — what staleness decays against. */
  lastVerifiedAt?: string | null;
}

export interface TasksFile {
  tasks: Task[];
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  title: string;
  type: GoalType;
  timeframe: string;
  parentGoalId: string | null;
  projectId: string | null;
  status: GoalStatus;
  milestones: string[];
  tasks: string[];
  createdAt: string;
  deletedAt: string | null;
}

export interface GoalsFile {
  goals: Goal[];
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  teamMembers: string[];
  createdAt: string;
  tags: string[];
  deletedAt: string | null;
  /**
   * Absolute path to the adopted repo (twin-primitives §1). Null — or absent on
   * rows written before Phase 3 — for a project that is not a codebase; its
   * `.ligma/` knowledge and journeys live under this path when it is one.
   */
  repoPath?: string | null;
  /**
   * Which pipeline this project uses (UX spec §3). Absent means "not yet
   * confirmed" — inferred at discovery, changeable in Knowledge.
   */
  shape?: ProjectShape;
  /** The brief this project was promoted from, where one exists. */
  briefId?: string;
  /**
   * Pinned to the front of the project rail (UX-REDESIGN §16 "Scale by tiers").
   * Absent means not pinned — the rail falls back to most-recently-visited.
   */
  pinned?: boolean;
  /**
   * True when `name` is the composer's no-LLM fallback (first line of the
   * prompt, truncated) rather than a name a human typed or the promote
   * planner settled on. Read once, by the first promote preview's planner
   * turn, to decide whether its proposed `title` may replace `name` — a
   * human-typed name always wins and this stays false for it. Absent on
   * projects created before this field existed; those are never renamed.
   */
  nameIsPlaceholder?: boolean;
}

export interface ProjectsFile {
  projects: Project[];
}

// ─── Brain Dump ───────────────────────────────────────────────────────────────

export interface BrainDumpEntry {
  id: string;
  content: string;
  capturedAt: string;
  processed: boolean;
  convertedTo: string | null;
  tags: string[];
}

export interface BrainDumpFile {
  entries: BrainDumpEntry[];
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export type EventType =
  | 'task_created'
  | 'task_updated'
  | 'task_completed'
  | 'task_delegated'
  | 'message_sent'
  | 'decision_requested'
  | 'decision_answered'
  | 'brain_dump_triaged'
  | 'milestone_completed'
  | 'agent_checkin'
  // Phase 2: the timeline stops being a task-only log. Each of these is written
  // by the one site that already holds the fact — never inferred from prose.
  | 'run'
  | 'verdict'
  | 'promote'
  | 'design_turn';

export interface ActivityEvent {
  id: string;
  type: EventType;
  actor: AgentRole | 'system';
  taskId: string | null;
  /**
   * The project this event belongs to, so a project timeline is a filter rather
   * than a join through tasks.json. Derived at the writer from the fact it
   * already has (the task's projectId, the run's, the design's). Absent on every
   * row written before Phase 2, and null for genuinely project-less events —
   * readers must treat absent and null the same.
   */
  projectId?: string | null;
  summary: string;
  details: string;
  timestamp: string;
}

export interface ActivityLogFile {
  events: ActivityEvent[];
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

export type MessageType = 'delegation' | 'report' | 'question' | 'update' | 'approval';
export type MessageStatus = 'unread' | 'read' | 'archived';

export interface InboxMessage {
  id: string;
  from: AgentRole | 'system';
  to: AgentRole;
  type: MessageType;
  taskId: string | null;
  subject: string;
  body: string;
  status: MessageStatus;
  createdAt: string;
  readAt: string | null;
  /**
   * Present only on the morning smoke digest: the per-journey rows the body
   * describes in prose, as data. A reader that renders it gets the passed /
   * failed / **error** distinction and a link per row; one that doesn't still
   * has the body. Additive — every other message omits it.
   */
  smokeDigest?: SmokeDigest;
}

export interface InboxFile {
  messages: InboxMessage[];
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export type DecisionStatus = 'pending' | 'answered';

export interface DecisionItem {
  id: string;
  requestedBy: AgentRole | 'system';
  taskId: string | null;
  question: string;
  options: string[];
  context: string;
  status: DecisionStatus;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  /** False when the agent can keep working on other parts. Missing = blocking. */
  blocksTask?: boolean;
  /**
   * What raised this card, when it is not a plain question — currently only
   * `"verification-cap"` (harness/verdict.ts's `VERIFICATION_CAP_KIND`), whose
   * four options are consumed by machinery rather than read as prose.
   *
   * It was already being written into decisions.json and dropped on the way to
   * the UI, so an "attempts exhausted" card rendered as a generic decision with
   * no hint of where it came from (execution-flow-review L3). Absent on an
   * ordinary decision, which is the overwhelming majority.
   */
  kind?: string;
  /**
   * Flagged for attention — surfaces first in the deck. Deliberately NOT
   * blocksTask: marking a card urgent must not silently halt the agent's task,
   * which is the opposite of what the human meant by "look at this first".
   */
  urgentAt?: string | null;
  /** Defer lane: still "pending" but hidden from the deck until this time. */
  deferUntil?: string | null;
  /** How many times this decision has been deferred. */
  deferCount?: number;
  /**
   * Tasks created or changed by APPLYING this decision's answer — written at the
   * site that applied it, from the ids it actually touched. Never parsed out of
   * the answer text. Absent means "nobody recorded consequences", which is not
   * the same as `[]` ("applied, and it changed no tasks").
   */
  consequenceTaskIds?: string[];
  /**
   * sha256 of this question's normalized text, written when the card is created.
   *
   * The identity of the QUESTION rather than of the card, so the acceptance
   * panel can recognise a question this task already carries and not ask it
   * again — one task collected 11 near-identical pending cards from two runs 84
   * seconds apart before this existed (execution-flow-review H6). Absent on
   * cards written before it, which are fingerprinted on read.
   */
  questionFingerprint?: string;
}

export interface DecisionsFile {
  decisions: DecisionItem[];
}

// ─── Active Runs (task execution tracking) ───────────────────────────────────

export type RunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'deferred';

/**
 * Why a run stopped, as a class rather than a sentence (UX spec F5: every
 * failure gets its one right recovery button).
 *
 * Set ONLY at the site that raised the condition, from the structured fact it
 * already had — a governor denial, a boot-recipe read, a JSON parse that threw.
 * Never inferred by matching words in an error string: that is how a "rate
 * limit" card ends up on a task whose product mentioned rate limits. A site
 * that does not know leaves it undefined, and the UI renders the generic card.
 *
 *   auth       — credentials rejected or missing
 *   rate-limit — the quota governor deferred, or the backend said 429
 *   parse      — a reply that had to be structured was not
 *   backend    — the CLI could not be spawned, or exited non-zero
 *   env        — the product's environment could not be booted (boot recipe, preflight)
 *   harness    — our own machinery malfunctioned
 */
export type RunFailureCause = 'auth' | 'rate-limit' | 'parse' | 'backend' | 'env' | 'harness';

export interface ActiveRun {
  id: string;
  taskId: string;
  agentId: string;
  projectId: string | null;
  pid: number;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
  outputFile?: string | null;
  /**
   * mtime of the run's append-only output file — when it last said anything.
   * Set by `GET /api/runs` for running rows only, and absent when the file is
   * missing, so the quiet-duration badge measures real silence instead of
   * elapsed time (D7 MC-110).
   */
  lastOutputAt?: string;
  /** Why it stopped. Absent when the site that stopped it could not tell. */
  causeKind?: RunFailureCause;
  /**
   * When a deferred run may go again — the governor's own retry estimate, so
   * the calm "Deferred, resumes ~14:30" card shows a real time instead of a
   * shrug. Only ever set alongside `status: "deferred"`.
   */
  resumesAt?: string;
  /**
   * When the human stopped this run from the Runs surface. A stopped run is not
   * a malfunction, so this is the structured field the failure-class classifier
   * reads to render no card at all — rather than the UI guessing from `error`.
   */
  interruptedAt?: string;
  /**
   * What kind of run this row is. Absent means a task run — the default, and
   * every row that existed before adoption runs joined the listing. F2 says an
   * adoption run is watchable like any other run, so it IS one on the wire.
   */
  kind?: 'task' | 'adoption';
  /** The repo an adoption run is adopting. Only set on `kind: "adoption"`. */
  repoPath?: string;
  /**
   * `git rev-parse HEAD` in the builder's cwd, read at spawn. Null when that cwd
   * is not a repo (or git refused) — a run with no commit to point at is a fact,
   * not an error. Absent on every row written before Phase 2.
   */
  commitSha?: string | null;
  /** `data/run-outputs/<id>.prompt.txt` — the prompt this run was actually given. */
  promptFile?: string;
  /**
   * `data/run-outputs/<id>.changes.json` — the diff this run left behind, stored
   * as JSON because `GET /api/runs/:id/changes` serves its parts separately and
   * a diff can contain any text at all, section headers included.
   */
  changesFile?: string;
}

export interface ActiveRunsFile {
  runs: ActiveRun[];
}

// ─── Task outcome (GET /api/tasks/:id/outcome) ───────────────────────────────

/**
 * What the builder said it did, from the JSON block the SOP requires of it.
 *
 * `summary: null` means it returned NONE. That is deliberately not the empty
 * string and never a stand-in sentence: a build that produced a whole tree of
 * files once reported "No additional notes.", and the UI's job is to say the
 * summary is missing and point at `outputLogPath`, not to invent calm.
 */
export interface TaskOutcomeBuilderReport {
  /** The run this report came from, or null when no run left one. */
  runId: string | null;
  summary: string | null;
  /** Paths the builder says it wrote, relative to the product repo. */
  artifacts: string[];
  reportedAt: string | null;
  /** The completion report as posted to the inbox, verbatim. */
  inboxBody: string | null;
  outputLogPath: string | null;
  /** Tail of the run's output log, oldest line first. Capped by the route. */
  outputTail: string[];
}

/** One acceptance run for the task, as its own manifest recorded it. */
export interface TaskOutcomeVerificationRun {
  id: string;
  status: 'running' | 'complete' | 'error';
  error: string | null;
  /** Set only by the site that raised the failure — never inferred from prose. */
  errorKind: string | null;
  causeKind: RunFailureCause | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A criterion verdict with the criterion's own text resolved, when the contract still has it. */
export interface TaskOutcomeCriterion {
  criterionId: string;
  /** Null when the contract that defined it is gone — the id is still true. */
  text: string | null;
  status: string;
  reasoning: string;
  evidence: string[];
}

/**
 * The quota governor holding this task's verification back, right now.
 *
 * Derived at read time from the same `canSpawn` decision the dispatcher makes,
 * because a deferral writes nothing: before this route it existed only as one
 * line in the daemon log, which is why a waiting project looked like a dead one.
 * `resumesAt` is null for a kill switch — that resumes when a human says so,
 * and a clock on it would be a lie.
 */
export interface TaskOutcomeDeferral {
  reason: string;
  resumesAt: string | null;
}

export interface TaskOutcome {
  taskId: string;
  kanban: KanbanStatus;
  verificationStatus: VerificationStatus;
  verificationAttempts: number;
  /** The cap from config — `attempts` is only readable against it. */
  maxVerificationAttempts: number;
  builder: TaskOutcomeBuilderReport;
  /** Newest first. */
  verificationRuns: TaskOutcomeVerificationRun[];
  latestVerdict: {
    runId: string;
    outcome: 'passed' | 'failed' | 'error';
    criterionVerdicts: TaskOutcomeCriterion[];
  } | null;
  /** Null unless the governor is deferring this task's verification right now. */
  deferred: TaskOutcomeDeferral | null;
  /**
   * Why the dispatcher is holding this task back, verbatim from `Task.parkedReason`.
   *
   * A deferral is the governor saying "later"; a park is the daemon saying "not
   * until a human does something". Different states, so they are different
   * fields rather than one overloaded string.
   */
  parkedReason: string | null;
  /** Unanswered decisions on this task — what a park most often names. */
  pendingDecisions: number;
}

// ─── Eisenhower quadrant helpers ──────────────────────────────────────────────

export type EisenhowerQuadrant =
  | 'do' // important + urgent
  | 'schedule' // important + not-urgent
  | 'delegate' // not-important + urgent
  | 'eliminate'; // not-important + not-urgent

export function getQuadrant(task: Task): EisenhowerQuadrant {
  if (task.importance === 'important' && task.urgency === 'urgent') return 'do';
  if (task.importance === 'important' && task.urgency === 'not-urgent') return 'schedule';
  if (task.importance === 'not-important' && task.urgency === 'urgent') return 'delegate';
  return 'eliminate';
}

export function quadrantFromValues(importance: Importance, urgency: Urgency): EisenhowerQuadrant {
  if (importance === 'important' && urgency === 'urgent') return 'do';
  if (importance === 'important' && urgency === 'not-urgent') return 'schedule';
  if (importance === 'not-important' && urgency === 'urgent') return 'delegate';
  return 'eliminate';
}

export function valuesFromQuadrant(quadrant: EisenhowerQuadrant): {
  importance: Importance;
  urgency: Urgency;
} {
  switch (quadrant) {
    case 'do':
      return { importance: 'important', urgency: 'urgent' };
    case 'schedule':
      return { importance: 'important', urgency: 'not-urgent' };
    case 'delegate':
      return { importance: 'not-important', urgency: 'urgent' };
    case 'eliminate':
      return { importance: 'not-important', urgency: 'not-urgent' };
  }
}
