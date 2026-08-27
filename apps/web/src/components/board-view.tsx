'use client';

import { CreateTaskDialog } from '@/components/create-task-dialog';
import { EmptyState } from '@/components/empty-state';
import { TaskCard } from '@/components/task-card';
import { TaskDetailPanel } from '@/components/task-detail-panel';
import type { TaskFormData } from '@/components/task-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Goal, Project, Task } from '@ligma/api';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Shared types ───────────────────────────────────────────────────────────

export interface ColumnConfig {
  id: string;
  label: string;
  subtitle?: string;
  dotColor: string;
  borderColor: string;
  textColor?: string;
}

// ─── Done-column collapse (walkthrough M4: 200 cards, 36,900px page) ────────

/** The recent handful a collapsed column shows before "show all". */
export const DONE_COLLAPSE_LIMIT = 20;

/** Newest-completed first, so the collapsed handful is the *recent* work, not whatever order the API happened to return. */
export function sortByCompletedRecency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) =>
    (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt),
  );
}

/** Pure so the collapse/expand branch has a test that doesn't need a DOM. */
export function visibleColumnTasks(
  tasks: Task[],
  limit: number | undefined,
  showAll: boolean,
): Task[] {
  if (!limit || showAll || tasks.length <= limit) return tasks;
  return tasks.slice(0, limit);
}

// ─── Shared draggable card ──────────────────────────────────────────────────

export function DraggableTaskCard({
  task,
  project,
  onClick,
  isSelected,
  onToggleSelect,
  isRunning,
  onRun,
}: {
  task: Task;
  project?: Project | null;
  onClick: () => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  isRunning?: boolean;
  onRun?: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Merge our pointer tracking with dnd-kit's onPointerDown
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      // Forward to dnd-kit so drag detection still works
      const dndListeners = listeners as Record<string, (e: React.PointerEvent) => void> | undefined;
      dndListeners?.onPointerDown?.(e);
    },
    [listeners],
  );

  // Detect click (pointer barely moved) vs drag (pointer moved significantly)
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (!start) return;
      // If pointer moved more than 5px, it was a drag — don't treat as click
      if ((e.clientX - start.x) ** 2 + (e.clientY - start.y) ** 2 > 25) return;
      // Don't intercept clicks on interactive children (RunButton, etc.)
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input')) return;
      // Multi-select with Ctrl/Cmd
      if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
        e.stopPropagation();
        e.preventDefault();
        onToggleSelect(task.id);
      } else {
        onClick();
      }
    },
    [onClick, onToggleSelect, task.id],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(isSelected && 'ring-2 ring-primary rounded-lg')}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <TaskCard
        task={task}
        project={project}
        isDragging={isDragging}
        isRunning={isRunning}
        onRun={onRun}
        className="cursor-pointer"
      />
    </div>
  );
}

// ─── Shared drop zone / column ──────────────────────────────────────────────

export function BoardColumn({
  config,
  tasks,
  projects,
  onTaskClick,
  minHeight = 'min-h-[280px]',
  maxHeight,
  selected,
  onToggleSelect,
  runningTaskIds,
  onRunTask,
  collapseAfter,
  onCreateTask,
}: {
  config: ColumnConfig;
  tasks: Task[];
  projects: Project[];
  onTaskClick: (task: Task) => void;
  minHeight?: string;
  maxHeight?: string;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  runningTaskIds?: Set<string>;
  onRunTask?: (taskId: string) => void;
  /** Past this many cards, show only the first `collapseAfter` (caller sorts for recency) behind a "show all" toggle — e.g. Done, which alone has run past 200 cards / 36,900px (walkthrough M4). */
  collapseAfter?: number;
  /** An empty column is a dead end without a source to drag from (walkthrough m1) — offer the same task-create action the page header does. */
  onCreateTask?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: config.id });
  const [showAll, setShowAll] = useState(false);
  const visibleTasks = visibleColumnTasks(tasks, collapseAfter, showAll);
  const hiddenCount = tasks.length - visibleTasks.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border bg-card/50 transition-all',
        minHeight,
        config.borderColor,
        isOver && 'ring-2 ring-primary/40 bg-primary/5 scale-[1.01]',
      )}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-inherit">
        <div className="flex items-center gap-2">
          <div className={cn('h-2.5 w-2.5 rounded-full', config.dotColor)} />
          {config.subtitle ? (
            <div>
              <h2 className={cn('text-xs font-bold tracking-wider', config.textColor)}>
                {config.label}
              </h2>
              <p className="text-xs text-muted-foreground">{config.subtitle}</p>
            </div>
          ) : (
            <h2 className="text-sm font-semibold">{config.label}</h2>
          )}
        </div>
        <Badge
          variant="secondary"
          className="text-xs tabular-nums h-5 min-w-[1.5rem] justify-center"
        >
          {tasks.length}
        </Badge>
      </div>
      <div className={cn('flex-1 space-y-2 p-2.5 overflow-y-auto', maxHeight)}>
        {tasks.length === 0 && (
          <EmptyState
            icon={Plus}
            title="Empty"
            description="Drag tasks here, or create one directly"
            actionLabel={onCreateTask ? 'New task' : undefined}
            onAction={onCreateTask}
            compact
          />
        )}
        {visibleTasks.map((task) => (
          <DraggableTaskCard
            key={task.id}
            task={task}
            project={projects.find((p) => p.id === task.projectId)}
            onClick={() => onTaskClick(task)}
            isSelected={selected?.has(task.id)}
            onToggleSelect={onToggleSelect}
            isRunning={runningTaskIds?.has(task.id)}
            onRun={onRunTask}
          />
        ))}
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowAll(true)}
          >
            Show all {tasks.length} ({hiddenCount} more)
          </Button>
        )}
        {showAll && collapseAfter !== undefined && tasks.length > collapseAfter && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowAll(false)}
          >
            Show recent {collapseAfter}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Shared task CRUD helpers ───────────────────────────────────────────────

export function useTaskHandlers(
  tasks: Task[],
  updateTask: (id: string, updates: Partial<Task>) => Promise<Task>,
  createTask: (item: Partial<Task>) => Promise<Task>,
  deleteTask: (id: string) => Promise<void>,
) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);

  // Deep link: `/board?task=<id>` opens the record itself, so search surfaces
  // can hand the user the task instead of the list containing it (D7 DC-3).
  const requestedTaskId = useSearchParams().get('task');
  useEffect(() => {
    if (!requestedTaskId) return;
    const match = tasks.find((t) => t.id === requestedTaskId);
    if (match) setSelectedTask(match);
  }, [requestedTaskId, tasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  function handleDragEnd() {
    setActiveTask(null);
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
    });
  };

  const handleDeleteTask = async () => {
    if (!selectedTask) return;
    await deleteTask(selectedTask.id);
    setSelectedTask(null);
  };

  return {
    activeTask,
    setActiveTask,
    selectedTask,
    setSelectedTask,
    showCreateTask,
    setShowCreateTask,
    handleDragStart,
    handleDragEnd,
    handleUpdateTask,
    handleCreateTask,
    handleDeleteTask,
  };
}

// ─── Multi-select hook ──────────────────────────────────────────────────────

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const ids = Array.from(selected);

  // Clear selection on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selected.size > 0) {
        clear();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selected, clear]);

  return { selected, ids, toggle, clear, count: selected.size };
}

// ─── Shared panels (detail + create) ────────────────────────────────────────

export function BoardPanels({
  tasks,
  projects,
  goals,
  selectedTask,
  showCreateTask,
  onUpdate,
  onDelete,
  onCloseDetail,
  onCloseCreate,
  onSubmitCreate,
  updateTaskFields,
}: {
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  selectedTask: Task | null;
  showCreateTask: boolean;
  onUpdate: (data: TaskFormData) => void;
  onDelete: () => void;
  onCloseDetail: () => void;
  onCloseCreate: (open: boolean) => void;
  onSubmitCreate: (data: TaskFormData) => void;
  updateTaskFields: (id: string, updates: Partial<Task>) => Promise<Task>;
}) {
  return (
    <>
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          goals={goals}
          allTasks={tasks}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={onCloseDetail}
          updateTaskFields={updateTaskFields}
        />
      )}
      <CreateTaskDialog
        open={showCreateTask}
        onOpenChange={onCloseCreate}
        projects={projects}
        goals={goals}
        onSubmit={onSubmitCreate}
      />
    </>
  );
}

// ─── Shared DnD wrapper ─────────────────────────────────────────────────────

export function BoardDndWrapper({
  activeTask,
  projects,
  onDragStart,
  onDragEnd,
  children,
}: {
  activeTask: Task | null;
  projects: Project[];
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  children: React.ReactNode;
}) {
  const [announcement, setAnnouncement] = useState('');

  const sensors = useBoardSensors();

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      onDragStart(event);
      // Announce to screen readers -- we need to find the task title from the active ID
      setAnnouncement('Picked up task');
    },
    [onDragStart],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      onDragEnd(event);
      if (event.over) {
        setAnnouncement(`Dropped task into ${event.over.id}`);
      } else {
        setAnnouncement('Drop cancelled');
      }
    },
    [onDragEnd],
  );

  const handleDragCancel = useCallback(() => {
    setAnnouncement('Drag cancelled');
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            project={projects.find((p) => p.id === activeTask.projectId)}
            className="shadow-xl"
          />
        ) : null}
      </DragOverlay>
      <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </DndContext>
  );
}

// ─── DnD wrappers (moved from the project Build page — walkthrough m1) ───────

/**
 * Require 8px of movement before drag starts — a DndContext with no sensors
 * activates drag on pointer-down, which swallows every click on its cards.
 * Every board DndContext must use this, or clicks silently die.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );
}

export function DraggableTask({
  task,
  onClick,
  isRunning,
  onRun,
}: { task: Task; onClick: () => void; isRunning?: boolean; onRun?: (taskId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCard
        task={task}
        isDragging={isDragging}
        onClick={onClick}
        isRunning={isRunning}
        onRun={onRun}
      />
    </div>
  );
}

export function DroppableZone({
  id,
  label,
  dotColor,
  tasks,
  visibleTasks,
  onTaskClick,
  children,
  isTaskRunning,
  onRunTask,
  onCreateTask,
}: {
  id: string;
  label: string;
  dotColor: string;
  tasks: Task[];
  /** Cards to actually render, when the column collapses past a limit (e.g. Done) — defaults to `tasks`. The Badge count above still reflects the full `tasks.length`. */
  visibleTasks?: Task[];
  onTaskClick: (t: Task) => void;
  children?: React.ReactNode;
  isTaskRunning?: (taskId: string) => boolean;
  onRunTask?: (taskId: string) => void;
  /** An empty column is a dead end without a source to drag from (walkthrough m1). */
  onCreateTask?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const rendered = visibleTasks ?? tasks;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border bg-card/50 min-h-[200px] transition-all',
        isOver && 'ring-2 ring-primary/50',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <div className={cn('h-2 w-2 rounded-full', dotColor)} />
          <span className="text-xs font-semibold">{label}</span>
        </div>
        <Badge
          variant="secondary"
          className="text-xs tabular-nums h-5 min-w-[1.25rem] justify-center"
        >
          {tasks.length}
        </Badge>
      </div>
      <div className="flex-1 space-y-2 p-2 overflow-y-auto max-h-[60vh]">
        {tasks.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground/40">
            <p>Drop tasks here</p>
            {onCreateTask && (
              <button
                type="button"
                onClick={onCreateTask}
                className="mt-1 underline underline-offset-2 hover:text-muted-foreground"
              >
                or create one
              </button>
            )}
          </div>
        )}
        {rendered.map((t) => (
          <DraggableTask
            key={t.id}
            task={t}
            onClick={() => onTaskClick(t)}
            isRunning={isTaskRunning?.(t.id)}
            onRun={onRunTask}
          />
        ))}
        {children}
      </div>
    </div>
  );
}
