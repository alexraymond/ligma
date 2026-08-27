import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ActiveRunsFile,
  ActivityLogFile,
  AgentsFile,
  BrainDumpFile,
  DecisionsFile,
  GoalsFile,
  InboxFile,
  ProjectsFile,
  SkillsLibraryFile,
  TasksFile,
} from '@ligma/api';
import { Mutex } from 'async-mutex';
import { withFileLockAsync } from '../engine/file-lock';

import { loadConfig } from '../engine/config';
import { DATA_DIR } from '../paths';
const CHECKPOINTS_DIR = path.join(DATA_DIR, 'checkpoints');

function filePath(name: string): string {
  return path.join(DATA_DIR, name);
}

/**
 * Read a store file, or fall back to `makeDefault()` when it is missing or
 * unparseable. A fresh install has none of these files yet — before this
 * helper existed, seven of the eleven read functions below let that ENOENT
 * bubble into the API as "Something went wrong" (walkthrough B1). One helper
 * so the tolerance can't drift file-by-file again.
 */
async function readOrDefault<T>(name: string, makeDefault: () => T): Promise<T> {
  try {
    const raw = await readFile(filePath(name), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return makeDefault();
  }
}

export function getCheckpointsDir(): string {
  return CHECKPOINTS_DIR;
}

export async function ensureCheckpointsDir(): Promise<void> {
  await mkdir(CHECKPOINTS_DIR, { recursive: true });
}

// ─── Checkpoint metadata type ────────────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  version: number;
  stats: {
    tasks: number;
    projects: number;
    goals: number;
    brainDump: number;
    inbox: number;
    decisions: number;
    agents: number;
    skills: number;
  };
}

export interface CheckpointFile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  version: number;
  data: {
    tasks: TasksFile;
    goals: GoalsFile;
    projects: ProjectsFile;
    brainDump: BrainDumpFile;
    inbox: InboxFile;
    decisions: DecisionsFile;
    agents: AgentsFile;
    skillsLibrary: SkillsLibraryFile;
  };
}

// ─── Bulk checkpoint helpers ─────────────────────────────────────────────────

export async function getAllCoreData(): Promise<CheckpointFile['data']> {
  const [tasks, goals, projects, brainDump, inbox, decisions, agents, skillsLibrary] =
    await Promise.all([
      getTasks(),
      getGoals(),
      getProjects(),
      getBrainDump(),
      getInbox(),
      getDecisions(),
      getAgents(),
      getSkillsLibrary(),
    ]);
  return { tasks, goals, projects, brainDump, inbox, decisions, agents, skillsLibrary };
}

export async function loadCoreData(data: CheckpointFile['data']): Promise<void> {
  // Write sequentially to avoid overwhelming mutexes
  await saveTasks(data.tasks);
  await saveGoals(data.goals);
  await saveProjects(data.projects);
  await saveBrainDump(data.brainDump);
  await saveInbox(data.inbox);
  await saveDecisions(data.decisions);
  await saveAgents(data.agents);
  await saveSkillsLibrary(data.skillsLibrary);
  // Activity log is intentionally left alone: a checkpoint replaces core data,
  // it does not erase the history of what happened while getting here.
}

// ─── Checkpoint CRUD helpers ─────────────────────────────────────────────────

export async function listCheckpoints(): Promise<CheckpointMeta[]> {
  await ensureCheckpointsDir();
  const files = await readdir(CHECKPOINTS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const metas: CheckpointMeta[] = [];
  for (const file of jsonFiles) {
    try {
      const raw = await readFile(path.join(CHECKPOINTS_DIR, file), 'utf-8');
      const snap = JSON.parse(raw) as CheckpointFile;
      metas.push({
        id: snap.id,
        name: snap.name,
        description: snap.description,
        createdAt: snap.createdAt,
        version: snap.version,
        stats: {
          tasks: snap.data.tasks.tasks.length,
          projects: snap.data.projects.projects.length,
          goals: snap.data.goals.goals.length,
          brainDump: snap.data.brainDump.entries.length,
          inbox: snap.data.inbox.messages.length,
          decisions: snap.data.decisions.decisions.length,
          agents: snap.data.agents.agents.length,
          skills: snap.data.skillsLibrary.skills.length,
        },
      });
    } catch {
      // Skip malformed checkpoint files
    }
  }
  return metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getCheckpoint(id: string): Promise<CheckpointFile> {
  const raw = await readFile(path.join(CHECKPOINTS_DIR, `${id}.json`), 'utf-8');
  return JSON.parse(raw) as CheckpointFile;
}

export async function saveCheckpoint(snap: CheckpointFile): Promise<void> {
  await ensureCheckpointsDir();
  await writeFile(
    path.join(CHECKPOINTS_DIR, `${snap.id}.json`),
    JSON.stringify(snap, null, 2),
    'utf-8',
  );
}

export async function deleteCheckpoint(id: string): Promise<void> {
  await unlink(path.join(CHECKPOINTS_DIR, `${id}.json`));
}

// ─── Internal write helper (no mutex — caller must hold the lock) ────────────

/**
 * Write a store file atomically: temp file, then rename over the target.
 *
 * A plain `writeFile` truncates first, so a crash (or a `kill -9` of the daemon)
 * mid-write left a torn `tasks.json` — after which `readOrDefault` silently
 * answered `{tasks: []}`, the board read empty, and the next save persisted the
 * emptiness (R3). Rename is atomic on the same filesystem, so a reader sees
 * either the old file or the new one, never half of one.
 *
 * The temp name carries the pid so two processes writing the same store cannot
 * collide on the temp file itself.
 */
async function _writeJson(name: string, data: unknown): Promise<void> {
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, target);
}

// ─── Locking ─────────────────────────────────────────────────────────────────

/**
 * The lock name the ENGINE already uses for this store — `tasks.json` →
 * `"tasks"`, matching every `withFileLock("tasks", …)` in `engine/` and
 * `harness/`. Same string, same lock directory, so the two disciplines finally
 * exclude each other.
 */
function lockName(name: string): string {
  return name.replace(/\.json$/, '');
}

/**
 * Hold BOTH locks for a store mutation: the in-process mutex (cheap, orders this
 * process's own callers) and the cross-process file lock (what the daemon's
 * detached children — run-task, run-verification — have always taken).
 *
 * Before this, HTTP routes serialized on the mutex alone while the engine
 * serialized on the file lock alone, and the two never excluded each other: a
 * promote racing a run-task settle was an unguarded read-modify-write against a
 * guarded one, and 12 of 40 concurrent creates were lost across two API
 * processes over one store (R1/P3).
 *
 * Order is always mutex → file lock. Never the reverse, or the two orderings
 * would deadlock against each other.
 */
async function withStoreLock<T>(
  key: keyof typeof fileMutexes,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fileMutexes[key].runExclusive(() => withFileLockAsync(lockName(name), fn));
}

/**
 * Lock → read (missing/corrupt ⇒ `makeDefault()`) → mutate → write atomically.
 *
 * The fallback is the whole of P1: `mutateTasks`/`mutateGoals`/`mutateProjects`/
 * `mutateBrainDump`/`mutateInbox`/`mutateDecisions` used a raw `readFile` and
 * threw on a fresh data root, so the first write of a brand-new install —
 * the composer's very first submit — 500'd with a raw ENOENT, while the read
 * side (`readOrDefault`) and six of their own siblings had tolerated it all
 * along. One helper, so the tolerance cannot drift apart again.
 */
async function mutateFile<T, D>(
  key: keyof typeof fileMutexes,
  name: string,
  makeDefault: () => D,
  fn: (data: D) => Promise<T>,
): Promise<T> {
  return withStoreLock(key, name, async () => {
    const data = await readOrDefault(name, makeDefault);
    const result = await fn(data);
    await _writeJson(name, data);
    return result;
  });
}

// ─── Per-file mutexes for concurrent write safety ─────────────────────────────

const fileMutexes = {
  tasks: new Mutex(),
  tasksArchive: new Mutex(),
  goals: new Mutex(),
  projects: new Mutex(),
  brainDump: new Mutex(),
  activityLog: new Mutex(),
  inbox: new Mutex(),
  decisions: new Mutex(),
  agents: new Mutex(),
  skillsLibrary: new Mutex(),
  activeRuns: new Mutex(),
  daemonConfig: new Mutex(),
};

// ─── Read functions (no locking needed — reads are safe) ──────────────────────

export async function getTasks(): Promise<TasksFile> {
  return readOrDefault('tasks.json', () => ({ tasks: [] }));
}

export async function getTasksArchive(): Promise<TasksFile> {
  return readOrDefault('tasks-archive.json', () => ({ tasks: [] }));
}

export async function getGoals(): Promise<GoalsFile> {
  return readOrDefault('goals.json', () => ({ goals: [] }));
}

export async function getProjects(): Promise<ProjectsFile> {
  return readOrDefault('projects.json', () => ({ projects: [] }));
}

export async function getBrainDump(): Promise<BrainDumpFile> {
  return readOrDefault('brain-dump.json', () => ({ entries: [] }));
}

export async function getActivityLog(): Promise<ActivityLogFile> {
  return readOrDefault('activity-log.json', () => ({ events: [] }));
}

export async function getInbox(): Promise<InboxFile> {
  return readOrDefault('inbox.json', () => ({ messages: [] }));
}

export async function getDecisions(): Promise<DecisionsFile> {
  return readOrDefault('decisions.json', () => ({ decisions: [] }));
}

export async function getAgents(): Promise<AgentsFile> {
  return readOrDefault('agents.json', () => ({ agents: [] }));
}

export async function getSkillsLibrary(): Promise<SkillsLibraryFile> {
  return readOrDefault('skills-library.json', () => ({ skills: [] }));
}

export async function getActiveRuns(): Promise<ActiveRunsFile> {
  return readOrDefault('active-runs.json', () => ({ runs: [] }));
}

/**
 * Config consumers (web's `useDaemon`, `/runs`, `/settings`) read
 * `config.concurrency.maxParallelAgents` off this unconditionally — an empty
 * `{}` default satisfied "don't throw" but still crashed every caller on a
 * fresh install (walkthrough B1, "reading 'maxParallelAgents'"). `loadConfig`
 * is the daemon engine's own default-config source of truth (also self-heals
 * by writing the file), so the API default and the engine default can't drift
 * apart the way a second hand-copied object would.
 */
export async function getDaemonConfig(): Promise<Record<string, unknown>> {
  return readOrDefault(
    'daemon-config.json',
    () => loadConfig() as unknown as Record<string, unknown>,
  );
}

// ─── Save functions (lock-protected to prevent concurrent write corruption) ───

export async function saveTasks(data: TasksFile): Promise<void> {
  await withStoreLock('tasks', 'tasks.json', () => _writeJson('tasks.json', data));
}

export async function saveTasksArchive(data: TasksFile): Promise<void> {
  await withStoreLock('tasksArchive', 'tasks-archive.json', () =>
    _writeJson('tasks-archive.json', data),
  );
}

export async function saveGoals(data: GoalsFile): Promise<void> {
  await withStoreLock('goals', 'goals.json', () => _writeJson('goals.json', data));
}

export async function saveProjects(data: ProjectsFile): Promise<void> {
  await withStoreLock('projects', 'projects.json', () => _writeJson('projects.json', data));
}

export async function saveBrainDump(data: BrainDumpFile): Promise<void> {
  await withStoreLock('brainDump', 'brain-dump.json', () => _writeJson('brain-dump.json', data));
}

export async function saveActivityLog(data: ActivityLogFile): Promise<void> {
  await withStoreLock('activityLog', 'activity-log.json', () =>
    _writeJson('activity-log.json', data),
  );
}

export async function saveInbox(data: InboxFile): Promise<void> {
  await withStoreLock('inbox', 'inbox.json', () => _writeJson('inbox.json', data));
}

export async function saveDecisions(data: DecisionsFile): Promise<void> {
  await withStoreLock('decisions', 'decisions.json', () => _writeJson('decisions.json', data));
}

export async function saveAgents(data: AgentsFile): Promise<void> {
  await withStoreLock('agents', 'agents.json', () => _writeJson('agents.json', data));
}

export async function saveSkillsLibrary(data: SkillsLibraryFile): Promise<void> {
  await withStoreLock('skillsLibrary', 'skills-library.json', () =>
    _writeJson('skills-library.json', data),
  );
}

export async function saveActiveRuns(data: ActiveRunsFile): Promise<void> {
  await withStoreLock('activeRuns', 'active-runs.json', () => _writeJson('active-runs.json', data));
}

// ─── Atomic read-modify-write helpers (legacy — read-only inside lock) ────────
// NOTE: These do NOT write back. Calling save*() inside these will DEADLOCK
// (async-mutex is not reentrant). Use mutate*() below for mutations instead.

export async function withTasks<T>(fn: (data: TasksFile) => Promise<T>): Promise<T> {
  return fileMutexes.tasks.runExclusive(async () => {
    const data = await getTasks();
    return fn(data);
  });
}

export async function withTasksArchive<T>(fn: (data: TasksFile) => Promise<T>): Promise<T> {
  return fileMutexes.tasksArchive.runExclusive(async () => {
    const data = await getTasksArchive();
    return fn(data);
  });
}

export async function withGoals<T>(fn: (data: GoalsFile) => Promise<T>): Promise<T> {
  return fileMutexes.goals.runExclusive(async () => {
    const data = await getGoals();
    return fn(data);
  });
}

export async function withProjects<T>(fn: (data: ProjectsFile) => Promise<T>): Promise<T> {
  return fileMutexes.projects.runExclusive(async () => {
    const data = await getProjects();
    return fn(data);
  });
}

export async function withBrainDump<T>(fn: (data: BrainDumpFile) => Promise<T>): Promise<T> {
  return fileMutexes.brainDump.runExclusive(async () => {
    const data = await getBrainDump();
    return fn(data);
  });
}

export async function withActivityLog<T>(fn: (data: ActivityLogFile) => Promise<T>): Promise<T> {
  return fileMutexes.activityLog.runExclusive(async () => {
    const data = await getActivityLog();
    return fn(data);
  });
}

export async function withInbox<T>(fn: (data: InboxFile) => Promise<T>): Promise<T> {
  return fileMutexes.inbox.runExclusive(async () => {
    const data = await getInbox();
    return fn(data);
  });
}

export async function withDecisions<T>(fn: (data: DecisionsFile) => Promise<T>): Promise<T> {
  return fileMutexes.decisions.runExclusive(async () => {
    const data = await getDecisions();
    return fn(data);
  });
}

export async function withAgents<T>(fn: (data: AgentsFile) => Promise<T>): Promise<T> {
  return fileMutexes.agents.runExclusive(async () => {
    const data = await getAgents();
    return fn(data);
  });
}

/**
 * The agent promoted build tasks are assigned to. A greenfield instance boots
 * with an empty crew; a factory with no workers cannot build (brief F1 step 4:
 * "tasks land on the Board, daemon picks them up"), so promote ensures one
 * exists: the first active non-"me" agent wins, else a default builder is
 * created — visible and editable in Crew like any other agent.
 */
export async function ensureBuilderAgent(): Promise<string> {
  return withStoreLock('agents', 'agents.json', async () => {
    const data = await getAgents();
    const existing = data.agents.find((a) => a.id !== 'me' && a.status === 'active');
    if (existing) return existing.id;
    const now = new Date().toISOString();
    const builder = {
      id: 'builder',
      name: 'Builder',
      icon: 'Hammer',
      description: 'Default build agent — implements promoted tasks in the product repo',
      instructions:
        'You are the build agent. Implement the assigned task in the product repository exactly as scoped: read the task description and its visible acceptance criteria, write the code and docs the task calls for, keep the repo bootable (a valid .ligma/boot.json and an accurate README quickstart are part of done), and report honestly — never claim completion for work that is not finished. You cannot see the held-out criteria or baselines; build to the task, not to the test.',
      capabilities: ['build'],
      skillIds: [],
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    data.agents.push(builder);
    await _writeJson('agents.json', data);
    return builder.id;
  });
}

export async function withSkillsLibrary<T>(
  fn: (data: SkillsLibraryFile) => Promise<T>,
): Promise<T> {
  return fileMutexes.skillsLibrary.runExclusive(async () => {
    const data = await getSkillsLibrary();
    return fn(data);
  });
}

export async function withActiveRuns<T>(fn: (data: ActiveRunsFile) => Promise<T>): Promise<T> {
  return fileMutexes.activeRuns.runExclusive(async () => {
    const data = await getActiveRuns();
    return fn(data);
  });
}

// ─── Atomic mutate helpers (lock → read → callback → auto-write → unlock) ────
// Use these for ALL mutation operations. The callback mutates `data` in place,
// and the file is automatically written after the callback returns.
// If the callback throws, the file is NOT written (implicit rollback).
// Every one of them holds the in-process mutex AND the cross-process file lock,
// and tolerates a store file that does not exist yet (see `mutateFile`).

export async function mutateTasks<T>(fn: (data: TasksFile) => Promise<T>): Promise<T> {
  return mutateFile('tasks', 'tasks.json', () => ({ tasks: [] }), fn);
}

export async function mutateTasksArchive<T>(fn: (data: TasksFile) => Promise<T>): Promise<T> {
  return mutateFile('tasksArchive', 'tasks-archive.json', () => ({ tasks: [] }), fn);
}

export async function mutateGoals<T>(fn: (data: GoalsFile) => Promise<T>): Promise<T> {
  return mutateFile('goals', 'goals.json', () => ({ goals: [] }), fn);
}

export async function mutateProjects<T>(fn: (data: ProjectsFile) => Promise<T>): Promise<T> {
  return mutateFile('projects', 'projects.json', () => ({ projects: [] }), fn);
}

export async function mutateBrainDump<T>(fn: (data: BrainDumpFile) => Promise<T>): Promise<T> {
  return mutateFile('brainDump', 'brain-dump.json', () => ({ entries: [] }), fn);
}

export async function mutateInbox<T>(fn: (data: InboxFile) => Promise<T>): Promise<T> {
  return mutateFile('inbox', 'inbox.json', () => ({ messages: [] }), fn);
}

export async function mutateDecisions<T>(fn: (data: DecisionsFile) => Promise<T>): Promise<T> {
  return mutateFile('decisions', 'decisions.json', () => ({ decisions: [] }), fn);
}

export async function mutateActivityLog<T>(fn: (data: ActivityLogFile) => Promise<T>): Promise<T> {
  return withStoreLock('activityLog', 'activity-log.json', async () => {
    let data: ActivityLogFile;
    try {
      data = JSON.parse(await readFile(filePath('activity-log.json'), 'utf-8')) as ActivityLogFile;
    } catch (err) {
      // A MISSING log is a fresh install — the same case `readOrDefault` covers
      // for the read side, and the same tolerance `mutateAgents` already has.
      // Appending the first-ever event must not be the one write that fails.
      //
      // A CORRUPT log still throws, deliberately: this function ends in a full
      // rewrite, so swallowing a parse error here would silently replace
      // somebody's history with an empty array. Losing an event beats that.
      // (This is the ONE mutate helper that does not use `mutateFile`, for
      // exactly that reason.)
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      data = { events: [] };
    }
    const result = await fn(data);
    await _writeJson('activity-log.json', data);
    return result;
  });
}

export async function mutateAgents<T>(fn: (data: AgentsFile) => Promise<T>): Promise<T> {
  return mutateFile('agents', 'agents.json', () => ({ agents: [] }), fn);
}

export async function mutateSkillsLibrary<T>(
  fn: (data: SkillsLibraryFile) => Promise<T>,
): Promise<T> {
  return mutateFile('skillsLibrary', 'skills-library.json', () => ({ skills: [] }), fn);
}

export async function mutateActiveRuns<T>(fn: (data: ActiveRunsFile) => Promise<T>): Promise<T> {
  return mutateFile('activeRuns', 'active-runs.json', () => ({ runs: [] }), fn);
}

export async function mutateDaemonConfig<T>(
  fn: (data: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  return mutateFile(
    'daemonConfig',
    'daemon-config.json',
    () => ({}) as Record<string, unknown>,
    fn,
  );
}
