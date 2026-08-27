import type { ExecutionState } from '@/components/status-pill';
/**
 * The Build stage's Plan view: goal → milestone → task, grouped.
 *
 * This is where the retired Objectives page's job lands (UX-REDESIGN §11/§12:
 * "Goals/milestones are panels of Build's Plan view, not a global Objectives
 * page"). Kept pure and out of `page.tsx` so it can be tested in the node
 * environment vitest runs in — same split as `board-view.tsx`.
 *
 * Two facts about the data model this has to survive:
 *  - a task links to a goal *either* by the goal's `tasks` array *or* by its
 *    own `milestoneId` (task-form writes the latter), so both count;
 *  - a milestone whose parent goal is not in this project's goals would
 *    otherwise take its tasks with it into nothing — it is promoted to a
 *    top-level group instead of being dropped.
 */
import { type Goal, type GoalStatus, type Task, deriveGoalStatus } from '@ligma/api';

export interface PlanMilestone {
  goal: Goal;
  /** Derived from the linked tasks, never the stored `status` (M3). */
  status: GoalStatus;
  tasks: Task[];
}

export interface PlanGoal extends PlanMilestone {
  milestones: PlanMilestone[];
}

export interface Plan {
  goals: PlanGoal[];
  /** Tasks no goal or milestone claims — the "No goal" bucket. */
  ungrouped: Task[];
}

/** The one paint mapping for goal status: status-pill's vocabulary, no second palette. */
export const GOAL_PILL_STATE: Record<GoalStatus, ExecutionState> = {
  'not-started': 'queued',
  'in-progress': 'running',
  completed: 'done',
};

function linkedTasks(goal: Goal, tasks: Task[]): Task[] {
  return tasks.filter((t) => goal.tasks.includes(t.id) || t.milestoneId === goal.id);
}

/**
 * Group one project's goals and tasks into the Plan view's shape.
 *
 * @param goals This project's goals (already filtered by `projectId`).
 * @param tasks This project's tasks.
 */
export function groupPlan(goals: Goal[], tasks: Task[]): Plan {
  const byId = new Set(goals.map((g) => g.id));
  const isChild = (g: Goal) =>
    g.type === 'medium-term' && g.parentGoalId !== null && byId.has(g.parentGoalId);

  const claimed = new Set<string>();
  const group = (goal: Goal, own: Task[]): PlanMilestone => {
    own.forEach((t) => claimed.add(t.id));
    return { goal, status: deriveGoalStatus(own, goal.status), tasks: own };
  };

  const planGoals = goals
    .filter((g) => !isChild(g))
    .map((parent) => {
      const milestones = goals
        .filter((g) => isChild(g) && g.parentGoalId === parent.id)
        .map((m) => group(m, linkedTasks(m, tasks)));
      const nested = new Set(milestones.flatMap((m) => m.tasks.map((t) => t.id)));
      const own = linkedTasks(parent, tasks).filter((t) => !nested.has(t.id));
      const goal = group(parent, own);
      return {
        ...goal,
        // The parent's own pill answers for everything beneath it, milestones included.
        status: deriveGoalStatus([...own, ...milestones.flatMap((m) => m.tasks)], parent.status),
        milestones,
      };
    });

  return { goals: planGoals, ungrouped: tasks.filter((t) => !claimed.has(t.id)) };
}
