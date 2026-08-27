'use client';

import {
  BoardPanels,
  useSelection,
  useTaskHandlers,
  visibleColumnTasks,
} from '@/components/board-view';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { BulkActionBar } from '@/components/bulk-action-bar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CreateGoalDialog } from '@/components/create-goal-dialog';
import { CreateProjectDialog } from '@/components/create-project-dialog';
import { EditGoalDialog } from '@/components/edit-goal-dialog';
import { EditProjectDialog } from '@/components/edit-project-dialog';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { GoalCard, MilestoneCard } from '@/components/goal-card';
import { ProjectCardLarge } from '@/components/project-card-large';
import { GoalCardSkeleton, KanbanSkeleton, ProjectCardSkeleton } from '@/components/skeletons';
import { VerificationPill } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tip } from '@/components/ui/tip';
import { useAgents, useGoals, useProjects, useTasks } from '@/hooks/use-data';
import { taskVerificationPill } from '@/lib/health';
import { kanbanDot, kanbanLabels } from '@/lib/kanban';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import type { Goal, GoalStatus, GoalType, Project, ProjectStatus, Task } from '@ligma/api';
import { ArrowUpDown, Eye, EyeOff, FolderOpen, Plus, Target } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  PROJECT_SORT_OPTIONS,
  type ProjectSortKey,
  TASK_SORT_OPTIONS,
  type TaskSortKey,
  groupLongTermGoals,
  parseView,
  sortProjects,
  sortTasks,
} from './page-helpers';

/** Past this many rows the portfolio Tasks table collapses behind a "show all" toggle (W17). */
const TASKS_TABLE_LIMIT = 100;

export default function ProjectsPage() {
  const {
    projects,
    loading: loadingProjects,
    create: createProject,
    update: updateProject,
    remove: deleteProject,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects();
  const {
    tasks,
    loading: loadingTasks,
    update: updateTask,
    create: createTask,
    remove: deleteTask,
    bulkUpdate,
    bulkRemove,
    error: tasksError,
    refetch: refetchTasks,
  } = useTasks();
  const {
    goals,
    loading: loadingGoals,
    create: createGoal,
    update: updateGoal,
    remove: deleteGoal,
    error: goalsError,
    refetch: refetchGoals,
  } = useGoals();
  const { agents } = useAgents();
  const { isProjectRunning, runProject } = useActiveRuns();

  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));

  function setView(next: string) {
    router.push(next === 'projects' ? '/projects' : `/projects?view=${next}`);
  }

  // ── Projects view state ──────────────────────────────────────────────────
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [projectSort, setProjectSort] = useState<ProjectSortKey>('name');

  // The project switcher's "New project" links here with ?new=1 so it can
  // open this dialog without duplicating CreateProjectDialog elsewhere.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowCreateProject(true);
      router.replace('/projects');
    }
  }, [searchParams, router]);

  const handleCreateProject = async (data: {
    name: string;
    description: string;
    color: string;
    tags: string;
    teamMembers?: string[];
  }) => {
    // No client-generated id (W25): the daemon always assigns its own
    // (`generateId("proj")`, apps/daemon/src/routes/projects/route.ts) and
    // ignores whatever the client sends, so this was dead weight.
    await createProject({
      name: data.name,
      description: data.description,
      status: 'active',
      color: data.color,
      teamMembers: data.teamMembers ?? [],
      tags: data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
    });
  };

  const handleEditProject = async (data: {
    name: string;
    description: string;
    status: ProjectStatus;
    color: string;
    teamMembers: string[];
    tags: string[];
  }) => {
    if (!editingProject) return;
    await updateProject(editingProject.id, data);
    setEditingProject(null);
  };

  const handleArchiveProject = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    await updateProject(id, { status: project.status === 'archived' ? 'active' : 'archived' });
  };

  const handleTogglePin = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    await updateProject(id, { pinned: !project.pinned });
  };

  const handleDeleteProject = async () => {
    if (!deletingProjectId) return;
    await deleteProject(deletingProjectId);
    setDeletingProjectId(null);
  };

  const archivedCount = projects.filter((p) => p.status === 'archived').length;
  const visibleProjects = sortProjects(
    showArchived ? projects : projects.filter((p) => p.status !== 'archived'),
    tasks,
    projectSort,
  );

  // ── Goals view state ─────────────────────────────────────────────────────
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);

  // Deep link: `/projects?view=goals&goal=<id>` opens the objective itself,
  // same honest behavior the old `/objectives?goal=` deep link had (D7 DC-3).
  const requestedGoalId = searchParams.get('goal');
  useEffect(() => {
    if (view !== 'goals' || !requestedGoalId) return;
    const match = goals.find((g) => g.id === requestedGoalId);
    if (match) setEditingGoal(match);
  }, [view, requestedGoalId, goals]);

  const milestones = goals.filter((g) => g.type === 'medium-term');
  const goalGroups = groupLongTermGoals(goals, projects);

  const handleCreateGoal = async (data: {
    title: string;
    type: GoalType;
    timeframe: string;
    projectId: string | null;
    parentGoalId: string | null;
  }) => {
    await createGoal({
      title: data.title,
      type: data.type,
      timeframe: data.timeframe,
      parentGoalId: data.parentGoalId,
      projectId: data.projectId,
      status: 'not-started',
      milestones: [],
      tasks: [],
    });
  };

  const handleEditGoal = async (data: {
    title: string;
    type: GoalType;
    timeframe: string;
    status: GoalStatus;
    projectId: string | null;
    parentGoalId: string | null;
  }) => {
    if (!editingGoal) return;
    await updateGoal(editingGoal.id, data);
    setEditingGoal(null);
  };

  const handleDeleteGoal = async () => {
    if (!deletingGoalId) return;
    await deleteGoal(deletingGoalId);
    setDeletingGoalId(null);
  };

  // ── Tasks view state — the board's own primitives, wired the same way ───
  const [taskSort, setTaskSort] = useState<TaskSortKey>('updatedAt');
  const selection = useSelection();
  const {
    selectedTask,
    setSelectedTask,
    showCreateTask,
    setShowCreateTask,
    handleUpdateTask,
    handleCreateTask,
    handleDeleteTask,
  } = useTaskHandlers(tasks, updateTask, createTask, deleteTask);

  const sortedTasks = sortTasks(tasks, projects, taskSort);
  // The portfolio Tasks table used to render every task in one DOM tree — a
  // workspace with hundreds of tasks paid for all of them on every render
  // (W17). Same collapse-behind-a-toggle pattern the Board's Done column uses.
  const [showAllTasks, setShowAllTasks] = useState(false);
  const visibleTasks = visibleColumnTasks(sortedTasks, TASKS_TABLE_LIMIT, showAllTasks);

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Projects' }]} />

      <Tabs value={view} onValueChange={setView}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold">Projects</h1>
          <TabsList>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {view === 'projects' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {archivedCount > 0 && (
                <Tip content="Toggle archived projects">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs text-muted-foreground"
                    onClick={() => setShowArchived(!showArchived)}
                  >
                    {showArchived ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
                  </Button>
                </Tip>
              )}
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  value={projectSort}
                  onValueChange={(v) => setProjectSort(v as ProjectSortKey)}
                >
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Tip content="Create a new project">
              <Button size="sm" onClick={() => setShowCreateProject(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Project
              </Button>
            </Tip>
          </div>

          {loadingProjects ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
            </div>
          ) : projectsError ? (
            <ErrorState message={projectsError} onRetry={refetchProjects} />
          ) : visibleProjects.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No projects yet"
              description="Projects help you organize tasks and track progress across workstreams."
              actionLabel="Create a project"
              onAction={() => setShowCreateProject(true)}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleProjects.map((project) => (
                <ProjectCardLarge
                  key={project.id}
                  project={project}
                  tasks={tasks}
                  goals={goals}
                  isRunning={isProjectRunning(project.id)}
                  onRun={runProject}
                  onEdit={(id) => {
                    const p = projects.find((proj) => proj.id === id);
                    if (p) setEditingProject(p);
                  }}
                  onArchive={handleArchiveProject}
                  onDelete={setDeletingProjectId}
                  onTogglePin={handleTogglePin}
                />
              ))}
            </div>
          )}

          <CreateProjectDialog
            open={showCreateProject}
            onOpenChange={setShowCreateProject}
            onSubmit={handleCreateProject}
          />

          {editingProject && (
            <EditProjectDialog
              open={!!editingProject}
              onOpenChange={(open) => {
                if (!open) setEditingProject(null);
              }}
              project={editingProject}
              agents={agents}
              onSubmit={handleEditProject}
            />
          )}

          <ConfirmDialog
            open={!!deletingProjectId}
            onOpenChange={(open) => {
              if (!open) setDeletingProjectId(null);
            }}
            title="Delete project"
            description="This will permanently delete this project and unlink all associated tasks. This action cannot be undone."
            confirmLabel="Delete"
            onConfirm={handleDeleteProject}
          />
        </div>
      )}

      {view === 'goals' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Long-term objectives → milestones → tasks, across every project
            </p>
            <Tip content="Create a new objective">
              <Button size="sm" onClick={() => setShowCreateGoal(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Objective
              </Button>
            </Tip>
          </div>

          {loadingGoals || loadingTasks ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <GoalCardSkeleton />
              <GoalCardSkeleton />
            </div>
          ) : goalsError ? (
            <ErrorState message={goalsError} onRetry={refetchGoals} />
          ) : goalGroups.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No objectives yet"
              description="Set long-term objectives and break them into milestones to track your progress."
              actionLabel="Create an objective"
              onAction={() => setShowCreateGoal(true)}
            />
          ) : (
            goalGroups.map((group) => (
              <div key={group.projectId ?? '__no_project__'} className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.projectName ?? 'No project'}
                </h2>
                <div className="space-y-3">
                  {group.goals.map((goal) => {
                    const goalMilestones = milestones.filter((m) => m.parentGoalId === goal.id);
                    return (
                      <div key={goal.id} className="space-y-2">
                        <GoalCard
                          goal={goal}
                          tasks={tasks}
                          projects={projects}
                          milestones={milestones}
                          onEdit={setEditingGoal}
                          onDelete={setDeletingGoalId}
                        />
                        {goalMilestones.length > 0 && (
                          <div className="space-y-2">
                            {goalMilestones.map((m) => (
                              <MilestoneCard key={m.id} milestone={m} tasks={tasks} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <CreateGoalDialog
            open={showCreateGoal}
            onOpenChange={setShowCreateGoal}
            projects={projects}
            goals={goals}
            onSubmit={handleCreateGoal}
          />

          {editingGoal && (
            <EditGoalDialog
              open={!!editingGoal}
              onOpenChange={(open) => {
                if (!open) setEditingGoal(null);
              }}
              goal={editingGoal}
              projects={projects}
              goals={goals}
              onSubmit={handleEditGoal}
            />
          )}

          <ConfirmDialog
            open={!!deletingGoalId}
            onOpenChange={(open) => {
              if (!open) setDeletingGoalId(null);
            }}
            title="Delete objective"
            description="This will permanently delete this objective and its milestones. Linked tasks will not be deleted. This action cannot be undone."
            confirmLabel="Delete"
            onConfirm={handleDeleteGoal}
          />
        </div>
      )}

      {view === 'tasks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={taskSort} onValueChange={(v) => setTaskSort(v as TaskSortKey)}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tip content="Create a new task">
              <Button size="sm" onClick={() => setShowCreateTask(true)} className="gap-1.5 h-8">
                <Plus className="h-3.5 w-3.5" /> Task
              </Button>
            </Tip>
          </div>

          {loadingTasks ? (
            <KanbanSkeleton />
          ) : tasksError ? (
            <ErrorState title="Couldn't load tasks" detail={tasksError} onRetry={refetchTasks} />
          ) : sortedTasks.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No tasks yet"
              description="Tasks appear here once any project has some."
              actionLabel="Create a task"
              onAction={() => setShowCreateTask(true)}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Verification</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleTasks.map((task) => {
                    const project = projects.find((p) => p.id === task.projectId);
                    const verification = taskVerificationPill(task);
                    return (
                      <tr
                        key={task.id}
                        className={`cursor-pointer hover:bg-muted/30 ${selection.selected.has(task.id) ? 'bg-primary/5' : ''}`}
                        onClick={() => setSelectedTask(task)}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selection.selected.has(task.id)}
                            onChange={() => selection.toggle(task.id)}
                            aria-label={`Select ${task.title}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{task.title}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {project ? (
                            <span style={{ color: project.color }}>{project.name}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${kanbanDot[task.kanban]}`} />
                            {kanbanLabels[task.kanban]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {verification && (
                            <VerificationPill
                              status={verification.status}
                              verdictHref={verification.verdictHref}
                              tip={verification.tip}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                          {new Date(task.updatedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!showAllTasks && sortedTasks.length > TASKS_TABLE_LIMIT && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full rounded-none border-t text-xs text-muted-foreground"
                  onClick={() => setShowAllTasks(true)}
                >
                  Show all {sortedTasks.length} ({sortedTasks.length - TASKS_TABLE_LIMIT} more)
                </Button>
              )}
              {showAllTasks && sortedTasks.length > TASKS_TABLE_LIMIT && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full rounded-none border-t text-xs text-muted-foreground"
                  onClick={() => setShowAllTasks(false)}
                >
                  Show recent {TASKS_TABLE_LIMIT}
                </Button>
              )}
            </div>
          )}

          <BulkActionBar
            count={selection.count}
            onMarkDone={async () => {
              await bulkUpdate(selection.ids, { kanban: 'done' } as Partial<Task>);
              selection.clear();
            }}
            onDelete={async () => {
              await bulkRemove(selection.ids);
              selection.clear();
            }}
            onClear={selection.clear}
          />

          <BoardPanels
            tasks={tasks}
            projects={projects}
            goals={goals}
            selectedTask={selectedTask}
            showCreateTask={showCreateTask}
            onUpdate={handleUpdateTask}
            onDelete={handleDeleteTask}
            onCloseDetail={() => setSelectedTask(null)}
            onCloseCreate={setShowCreateTask}
            onSubmitCreate={handleCreateTask}
            updateTaskFields={updateTask}
          />
        </div>
      )}
    </div>
  );
}
