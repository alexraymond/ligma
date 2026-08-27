'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tip } from '@/components/ui/tip';
import { deriveGoalStatus } from '@ligma/api';
import type { Goal, Project, Task } from '@ligma/api';
import { Pencil, Trash2 } from 'lucide-react';

const MILESTONE_STATUS_COLORS: Record<string, string> = {
  'not-started': 'text-muted-foreground',
  'in-progress': 'text-status-in-progress',
  completed: 'text-status-done',
};

function MilestoneProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/** A single milestone under a long-term goal — nested progress, linked tasks. Shared between the objectives-turned-goals view and any goal detail surface (moved here so neither has to redefine it). */
export function MilestoneCard({ milestone, tasks }: { milestone: Goal; tasks: Task[] }) {
  const linkedTasks = tasks.filter((t) => milestone.tasks.includes(t.id));
  const completedCount = linkedTasks.filter((t) => t.kanban === 'done').length;
  const progress = linkedTasks.length > 0 ? (completedCount / linkedTasks.length) * 100 : 0;
  // Derived from the same linkedTasks the progress bar below reads, not from
  // the stored `status` field (M3: "Not Started" over a 7/7-complete list).
  const status = deriveGoalStatus(linkedTasks, milestone.status);

  return (
    <div className="ml-4 rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">{milestone.title}</h4>
        <Badge
          variant="outline"
          className={`text-xs capitalize ${MILESTONE_STATUS_COLORS[status] ?? ''}`}
        >
          {status.replace('-', ' ')}
        </Badge>
      </div>
      {milestone.timeframe && (
        <p className="text-xs text-muted-foreground">Target: {milestone.timeframe}</p>
      )}
      <div className="flex items-center gap-3">
        <MilestoneProgressBar value={progress} />
        <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {completedCount}/{linkedTasks.length}
        </span>
      </div>
      {linkedTasks.length > 0 && (
        <div className="space-y-0.5 pt-1">
          {linkedTasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <span
                className={task.kanban === 'done' ? 'text-status-done' : 'text-muted-foreground'}
              >
                {task.kanban === 'done' ? '✓' : '○'}
              </span>
              <span className={task.kanban === 'done' ? 'line-through text-muted-foreground' : ''}>
                {task.title}
              </span>
              {task.kanban === 'in-progress' && (
                <Badge variant="secondary" className="ml-auto text-xs h-4 px-1">
                  active
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface GoalCardProps {
  goal: Goal;
  tasks: Task[];
  projects: Project[];
  milestones: Goal[];
  /** Optional so read-only surfaces (home page's mini list) keep rendering unchanged. */
  onEdit?: (goal: Goal) => void;
  onDelete?: (goalId: string) => void;
}

export function GoalCard({ goal, tasks, projects, milestones, onEdit, onDelete }: GoalCardProps) {
  const project = projects.find((p) => p.id === goal.projectId);
  const goalMilestones = milestones.filter((m) => m.parentGoalId === goal.id);
  // A milestone counts as complete when its own tasks say so, not when its
  // stored `status` says so (M3: `0/4 milestones` over `78/78 tasks`, both
  // meant to describe the same completeness).
  const completedMilestones = goalMilestones.filter(
    (m) =>
      deriveGoalStatus(
        tasks.filter((t) => m.tasks.includes(t.id)),
        m.status,
      ) === 'completed',
  ).length;

  // Task progress across all milestones
  const linkedTaskIds = new Set([...goal.tasks, ...goalMilestones.flatMap((m) => m.tasks)]);
  const linkedTasks = tasks.filter((t) => linkedTaskIds.has(t.id));
  const doneTasks = linkedTasks.filter((t) => t.kanban === 'done').length;
  const totalTasks = linkedTasks.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const effectiveStatus = deriveGoalStatus(linkedTasks, goal.status);

  const statusColors: Record<string, string> = {
    'not-started': 'text-muted-foreground',
    'in-progress': 'text-status-in-progress',
    completed: 'text-status-done',
  };

  return (
    <Card className="transition-all hover:shadow-md animate-fade-in-up">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="font-medium text-sm truncate">{goal.title}</h3>
              {onEdit && (
                <Tip content="Edit objective">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(goal)}
                    aria-label="Edit objective"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </Tip>
              )}
              {onDelete && (
                <Tip content="Delete objective">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(goal.id)}
                    aria-label="Delete objective"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </Tip>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {project && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0"
                  style={{ borderColor: project.color, color: project.color }}
                >
                  {project.name}
                </Badge>
              )}
              {goal.timeframe && (
                <span className="text-xs text-muted-foreground">{goal.timeframe}</span>
              )}
            </div>
          </div>
          <Badge
            variant="outline"
            className={`text-xs capitalize shrink-0 ${statusColors[effectiveStatus] ?? ''}`}
          >
            {effectiveStatus.replace('-', ' ')}
          </Badge>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {goalMilestones.length > 0
                ? `${completedMilestones}/${goalMilestones.length} milestones`
                : 'No milestones'}
            </span>
            <span>
              {doneTasks}/{totalTasks} tasks
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
