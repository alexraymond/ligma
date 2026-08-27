/**
 * Pure helpers for the portfolio grid (`/projects`, UX spec §16 "Scale by
 * tiers" — the true cross-project dashboard). Kept separate from page.tsx so
 * the view-param parsing and sort comparators have a test that doesn't need a
 * DOM (this vitest config is node-environment only, same reason
 * board-view.tsx's helpers live outside its component tree).
 */
import type { Goal, Project, Task } from '@ligma/api';

export const PROJECT_VIEWS = ['projects', 'goals', 'tasks'] as const;
export type ProjectsView = (typeof PROJECT_VIEWS)[number];

const DEFAULT_VIEW: ProjectsView = 'projects';

/** `?view=` is untrusted input — anything unrecognized falls back to the default. */
export function parseView(raw: string | null): ProjectsView {
  return (PROJECT_VIEWS as readonly string[]).includes(raw ?? '')
    ? (raw as ProjectsView)
    : DEFAULT_VIEW;
}

// ─── Projects view: sort ────────────────────────────────────────────────────

export type ProjectSortKey = 'name' | 'status' | 'openTasks' | 'donePercent';

export const PROJECT_SORT_OPTIONS: { value: ProjectSortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'openTasks', label: 'Open tasks' },
  { value: 'donePercent', label: 'Done %' },
];

export function projectOpenTasks(project: Pick<Project, 'id'>, tasks: Task[]): number {
  return tasks.filter((t) => t.projectId === project.id && t.kanban !== 'done').length;
}

export function projectDonePercent(project: Pick<Project, 'id'>, tasks: Task[]): number {
  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  if (projectTasks.length === 0) return 0;
  return Math.round(
    (projectTasks.filter((t) => t.kanban === 'done').length / projectTasks.length) * 100,
  );
}

const STATUS_ORDER: Record<Project['status'], number> = {
  active: 0,
  paused: 1,
  completed: 2,
  archived: 3,
};

/** Sorts a copy — never mutates the caller's array. */
export function sortProjects(projects: Project[], tasks: Task[], key: ProjectSortKey): Project[] {
  const sorted = [...projects];
  sorted.sort((a, b) => {
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'status':
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name);
      case 'openTasks':
        return (
          projectOpenTasks(b, tasks) - projectOpenTasks(a, tasks) || a.name.localeCompare(b.name)
        );
      case 'donePercent':
        return (
          projectDonePercent(b, tasks) - projectDonePercent(a, tasks) ||
          a.name.localeCompare(b.name)
        );
    }
  });
  return sorted;
}

// ─── Goals view: grouping, including project-less goals ────────────────────

export interface GoalGroup {
  /** Null identifies the trailing project-less group. */
  projectId: string | null;
  projectName: string | null;
  goals: Goal[];
}

/**
 * Long-term goals grouped by project, project-less goals (`projectId: null`)
 * in their own trailing group so they're never silently dropped — the old
 * Objectives page rendered every long-term goal in one flat list and never
 * had to name this case.
 */
export function groupLongTermGoals(goals: Goal[], projects: Project[]): GoalGroup[] {
  const longTerm = goals.filter((g) => g.type === 'long-term');
  const byProject = new Map<string, Goal[]>();
  const projectless: Goal[] = [];
  for (const g of longTerm) {
    if (g.projectId) {
      const list = byProject.get(g.projectId) ?? [];
      list.push(g);
      byProject.set(g.projectId, list);
    } else {
      projectless.push(g);
    }
  }
  const groups: GoalGroup[] = [...byProject.entries()]
    .map(([projectId, gs]) => ({
      projectId,
      projectName: projects.find((p) => p.id === projectId)?.name ?? null,
      goals: gs,
    }))
    .sort((a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? ''));
  if (projectless.length > 0) {
    groups.push({ projectId: null, projectName: null, goals: projectless });
  }
  return groups;
}

// ─── Tasks view: cross-project table sort ───────────────────────────────────

export type TaskSortKey = 'updatedAt' | 'title' | 'project' | 'status';

export const TASK_SORT_OPTIONS: { value: TaskSortKey; label: string }[] = [
  { value: 'updatedAt', label: 'Last updated' },
  { value: 'title', label: 'Title' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
];

const KANBAN_ORDER: Record<Task['kanban'], number> = {
  'not-started': 0,
  'in-progress': 1,
  'awaiting-verification': 2,
  done: 3,
};

/** Sorts a copy — `updatedAt` (newest first) is the default per the spec. */
export function sortTasks(tasks: Task[], projects: Project[], key: TaskSortKey): Task[] {
  const nameOf = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? '') : '');
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    switch (key) {
      case 'updatedAt':
        return b.updatedAt.localeCompare(a.updatedAt);
      case 'title':
        return a.title.localeCompare(b.title);
      case 'project':
        return (
          nameOf(a.projectId).localeCompare(nameOf(b.projectId)) || a.title.localeCompare(b.title)
        );
      case 'status':
        return KANBAN_ORDER[a.kanban] - KANBAN_ORDER[b.kanban] || a.title.localeCompare(b.title);
    }
  });
  return sorted;
}
