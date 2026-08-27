'use client';

import {
  DONE_COLLAPSE_LIMIT,
  DroppableZone,
  sortByCompletedRecency,
  useBoardSensors,
  visibleColumnTasks,
} from '@/components/board-view';
import { CreateTaskDialog } from '@/components/create-task-dialog';
import { StagePanelHost } from '@/components/stage-panels';
import { ExecutionPill } from '@/components/status-pill';
import { TaskCard } from '@/components/task-card';
import { TaskDetailPanel } from '@/components/task-detail-panel';
import type { TaskFormData } from '@/components/task-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGoals, useProjects, useTasks } from '@/hooks/use-data';
import { useFastTaskPoll } from '@/hooks/use-fast-task-poll';
import { kanbanDot } from '@/lib/kanban';
import { cn } from '@/lib/utils';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  closestCenter,
} from '@dnd-kit/core';
import type { EisenhowerQuadrant, KanbanStatus, Task } from '@ligma/api';
import { getQuadrant, valuesFromQuadrant } from '@ligma/api';
import { Play, Plus, Square } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { GOAL_PILL_STATE, type PlanMilestone, groupPlan } from './plan-view';

// F1 verb (§16): never the bare word Pause alone — states the true dispatch-gate
// semantic (5e607ec): pausing only stops new dispatch, running agents finish.
const PAUSED_EXPLAINER = 'Paused — nothing new starts; running agents finish.';

function PlanTasks({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  if (tasks.length === 0)
    return <p className="text-xs text-muted-foreground/60">No tasks under this one yet.</p>;
  return (
    <div className="space-y-0.5">
      {tasks.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTaskClick(t)}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
        >
          <span className={t.kanban === 'done' ? 'text-status-done' : 'text-muted-foreground'}>
            {t.kanban === 'done' ? '✓' : '○'}
          </span>
          <span
            className={cn('truncate', t.kanban === 'done' && 'text-muted-foreground line-through')}
          >
            {t.title}
          </span>
          {t.kanban === 'in-progress' && (
            <Badge variant="secondary" className="ml-auto h-4 px-1 text-[10px]">
              active
            </Badge>
          )}
        </button>
      ))}
    </div>
  );
}

/** One goal or milestone in the Plan view: derived status pill, its tasks under it. */
function PlanRow({ group, onTaskClick }: { group: PlanMilestone; onTaskClick: (t: Task) => void }) {
  const done = group.tasks.filter((t) => t.kanban === 'done').length;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{group.goal.title}</span>
        {/* The derived status, never the stored one (M3) — status-pill paints it. */}
        <ExecutionPill
          state={GOAL_PILL_STATE[group.status]}
          label={group.status.replace('-', ' ')}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {done}/{group.tasks.length} done
        </span>
        {group.goal.timeframe && (
          <span className="text-xs text-muted-foreground">· {group.goal.timeframe}</span>
        )}
      </div>
      <PlanTasks tasks={group.tasks} onTaskClick={onTaskClick} />
    </div>
  );
}

/** The project's Board tab: the same two views the global Board offers, scoped. */
export default function ProjectBoardPage() {
  const projectId = useParams<{ id: string }>().id;

  const { tasks, update: updateTask, create: createTask, remove: deleteTask, refetch } = useTasks();
  const { goals } = useGoals();
  const { projects, update: updateProject } = useProjects();
  const { runs, runningTaskIds, isTaskRunning, runTask } = useActiveRuns();
  useFastTaskPoll(runningTaskIds.size > 0, refetch);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const sensors = useBoardSensors();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);

  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const project = projects.find((p) => p.id === projectId);
  const plan = groupPlan(
    goals.filter((g) => g.projectId === projectId),
    projectTasks,
  );

  // Header verbs (§11): what the machine is doing for *this* project. `running`
  // and `deferred` are run rows the daemon reports; `queued` is the not-started
  // tasks its dispatcher picks up next (dispatcher.ts: "Dispatch builder
  // sessions for not-started tasks") — there is no queued *run*, so the count
  // is of the work waiting, not of rows that exist.
  const projectRuns = runs.filter((r) => r.projectId === projectId);
  const stageCounts = [
    {
      state: 'running' as const,
      value: projectRuns.filter((r) => r.status === 'running').length,
      tip: 'Agent sessions running now.',
    },
    {
      state: 'queued' as const,
      value: projectTasks.filter((t) => t.kanban === 'not-started').length,
      tip: 'Not-started tasks the dispatcher picks up next.',
    },
    {
      state: 'deferred' as const,
      value: projectRuns.filter((r) => r.status === 'deferred').length,
      tip: 'Runs the governor held back — they go again on their own.',
    },
  ].filter((c) => c.value > 0);

  // Eisenhower groups (exclude done)
  const eGrouped: Record<EisenhowerQuadrant, Task[]> = {
    do: [],
    schedule: [],
    delegate: [],
    eliminate: [],
  };
  projectTasks
    .filter((t) => t.kanban !== 'done')
    .forEach((t) => {
      eGrouped[getQuadrant(t)].push(t);
    });

  // Kanban groups
  const kGrouped: Record<KanbanStatus, Task[]> = {
    'not-started': [],
    'in-progress': [],
    'awaiting-verification': [],
    done: [],
  };
  projectTasks.forEach((t) => {
    kGrouped[t.kanban]?.push(t);
  });

  // Done can run past hundreds of cards (walkthrough M4) — same collapse the
  // global board uses, recent-first behind a "show all" toggle.
  const sortedDone = sortByCompletedRecency(kGrouped.done);
  const visibleDone = visibleColumnTasks(sortedDone, DONE_COLLAPSE_LIMIT, showAllDone);
  const hiddenDoneCount = sortedDone.length - visibleDone.length;

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  async function handleEisenhowerDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const targetQ = over.id as EisenhowerQuadrant;
    if (getQuadrant(task) === targetQ) return;
    const { importance, urgency } = valuesFromQuadrant(targetQ);
    await updateTask(task.id, { importance, urgency });
  }

  async function handleKanbanDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const targetStatus = over.id as KanbanStatus;
    if (task.kanban === targetStatus) return;
    await updateTask(task.id, { kanban: targetStatus });
  }

  const handleUpdateTask = async (data: TaskFormData) => {
    if (!selectedTask) return;
    await updateTask(selectedTask.id, {
      ...data,
      tags: data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      acceptanceCriteria: data.acceptanceCriteria
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setSelectedTask(null);
  };

  const handleCreateTask = async (data: TaskFormData) => {
    // No client-generated id (W25): the daemon always assigns its own
    // (`generateId("task")`, apps/daemon/src/routes/tasks/route.ts).
    await createTask({
      ...data,
      dailyActions: [],
      tags: data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      acceptanceCriteria: data.acceptanceCriteria
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header row (§11): the stage's state, then its verbs. */}
      <div className="flex flex-wrap items-center gap-2">
        {stageCounts.length > 0 ? (
          stageCounts.map((c) => (
            <ExecutionPill
              key={c.state}
              state={c.state}
              label={`${c.value} ${c.state}`}
              tip={c.tip}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing running, queued or deferred for this project.
          </p>
        )}

        {/* Stop/start verbs (F1, §16): the per-project dispatch gate — distinct
            from "Stop everything now" (the heartbeat's global stop). */}
        {project?.status === 'paused' ? (
          <>
            <span className="text-xs text-muted-foreground">{PAUSED_EXPLAINER}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateProject(project.id, { status: 'active' })}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
            </Button>
          </>
        ) : project?.status === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateProject(project.id, { status: 'paused' })}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" /> Stop starting new work
          </Button>
        ) : null}

        <Button size="sm" onClick={() => setShowCreateTask(true)} className="ml-auto gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Task
        </Button>
      </div>

      <Tabs defaultValue="flow" className="space-y-4">
        <TabsList>
          <TabsTrigger value="flow">Flow</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
        </TabsList>

        {/* Flow — the board, with the Priority Matrix demoted to a lens on it
            (§12) rather than a view of its own. */}
        <TabsContent value="flow" className="space-y-3">
          <Tabs defaultValue="status-board" className="space-y-3">
            <TabsList>
              <TabsTrigger value="status-board">Columns</TabsTrigger>
              <TabsTrigger value="priority-matrix">Priority</TabsTrigger>
            </TabsList>

            <TabsContent value="status-board">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleKanbanDragEnd}
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <DroppableZone
                    id="not-started"
                    label="Not Started"
                    dotColor="bg-status-not-started"
                    tasks={kGrouped['not-started']}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="in-progress"
                    label="In Progress"
                    dotColor="bg-status-in-progress"
                    tasks={kGrouped['in-progress']}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="awaiting-verification"
                    label="Awaiting Verification"
                    dotColor={kanbanDot['awaiting-verification']}
                    tasks={kGrouped['awaiting-verification']}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="done"
                    label="Done"
                    dotColor="bg-status-done"
                    tasks={sortedDone}
                    visibleTasks={visibleDone}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                  >
                    {hiddenDoneCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground"
                        onClick={() => setShowAllDone(true)}
                      >
                        Show all {sortedDone.length} ({hiddenDoneCount} more)
                      </Button>
                    )}
                    {showAllDone && sortedDone.length > DONE_COLLAPSE_LIMIT && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground"
                        onClick={() => setShowAllDone(false)}
                      >
                        Show recent {DONE_COLLAPSE_LIMIT}
                      </Button>
                    )}
                  </DroppableZone>
                </div>
                <DragOverlay>
                  {activeTask ? <TaskCard task={activeTask} className="shadow-xl" /> : null}
                </DragOverlay>
              </DndContext>
            </TabsContent>

            <TabsContent value="priority-matrix">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleEisenhowerDragEnd}
              >
                <div className="grid grid-cols-2 gap-3">
                  <DroppableZone
                    id="do"
                    label="DO"
                    dotColor="bg-quadrant-do"
                    tasks={eGrouped.do}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="schedule"
                    label="SCHEDULE"
                    dotColor="bg-quadrant-schedule"
                    tasks={eGrouped.schedule}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="delegate"
                    label="DELEGATE"
                    dotColor="bg-quadrant-delegate"
                    tasks={eGrouped.delegate}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                  <DroppableZone
                    id="eliminate"
                    label="ELIMINATE"
                    dotColor="bg-quadrant-eliminate"
                    tasks={eGrouped.eliminate}
                    onTaskClick={setSelectedTask}
                    isTaskRunning={isTaskRunning}
                    onRunTask={runTask}
                    onCreateTask={() => setShowCreateTask(true)}
                  />
                </div>
                <DragOverlay>
                  {activeTask ? <TaskCard task={activeTask} className="shadow-xl" /> : null}
                </DragOverlay>
              </DndContext>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Plan — goal → milestone → task, the retired Objectives page's job
            (§12), scoped to this project. */}
        <TabsContent value="plan" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            We don&apos;t estimate dates — the machine reports what happened, it does not promise
            what will.
          </p>

          {plan.goals.length === 0 && plan.ungrouped.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No goals and no tasks in this project yet.
            </div>
          ) : (
            <>
              {plan.goals.map((g) => (
                <div key={g.goal.id} className="space-y-3 rounded-xl border p-3">
                  <PlanRow group={g} onTaskClick={setSelectedTask} />
                  {g.milestones.length > 0 && (
                    <div className="ml-3 space-y-3 border-l pl-3">
                      {g.milestones.map((m) => (
                        <PlanRow key={m.goal.id} group={m} onTaskClick={setSelectedTask} />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {plan.ungrouped.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-dashed p-3">
                  <p className="text-sm font-medium">No goal</p>
                  <PlanTasks tasks={plan.ungrouped} onTaskClick={setSelectedTask} />
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Build's drawers (§11): activity feed, terminal, runs — `?panel=` deep links. */}
      <StagePanelHost projectId={projectId} panels={['notes', 'terminal', 'runs']} />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          goals={goals}
          allTasks={tasks}
          onUpdate={handleUpdateTask}
          onDelete={async () => {
            await deleteTask(selectedTask.id);
            setSelectedTask(null);
          }}
          onClose={() => setSelectedTask(null)}
          updateTaskFields={updateTask}
        />
      )}

      <CreateTaskDialog
        open={showCreateTask}
        onOpenChange={setShowCreateTask}
        projects={projects}
        goals={goals}
        onSubmit={handleCreateTask}
        defaultValues={{ projectId }}
      />
    </div>
  );
}
