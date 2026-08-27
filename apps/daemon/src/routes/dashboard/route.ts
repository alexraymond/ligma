import { deriveGoalStatus } from '@ligma/api';
import { projectHealthAll } from '../../harness/health-board';
import { NextResponse } from '../../http';
import {
  getActivityLog,
  getBrainDump,
  getDecisions,
  getGoals,
  getInbox,
  getProjects,
  getTasks,
} from '../../store/data';

export const dynamic = 'force-dynamic';

// The web face's connectivity probe (use-connection.ts) pings this route with
// HEAD; reachability is the whole answer, so no body and no store reads.
export function HEAD() {
  return new Response(null, { status: 200 });
}

export async function GET() {
  // Read all data files in parallel (reads are safe, no locking needed)
  const [
    tasksData,
    goalsData,
    projectsData,
    brainDumpData,
    inboxData,
    decisionsData,
    activityData,
  ] = await Promise.all([
    getTasks(),
    getGoals(),
    getProjects(),
    getBrainDump(),
    getInbox(),
    getDecisions(),
    getActivityLog(),
  ]);

  // Filter soft-deleted
  const tasks = tasksData.tasks.filter((t) => !t.deletedAt);
  const goals = goalsData.goals.filter((g) => !g.deletedAt);
  const projects = projectsData.projects.filter((p) => !p.deletedAt);
  const entries = brainDumpData.entries;
  const messages = inboxData.messages;
  const decisions = decisionsData.decisions;
  const events = activityData.events;

  // Stats
  const doneTasks = tasks.filter((t) => t.kanban === 'done');
  const inProgressTasks = tasks.filter((t) => t.kanban === 'in-progress');
  // Actively being verified is work in flight (the harness is spending quota
  // on it right now) but it isn't "in progress" in the builder sense either —
  // counted and labelled separately rather than folded into inProgressTasks.
  const awaitingVerificationTasks = tasks.filter((t) => t.kanban === 'awaiting-verification');
  const unprocessedEntries = entries.filter((e) => !e.processed);
  const longTermGoals = goals.filter((g) => g.type === 'long-term');
  const milestones = goals.filter((g) => g.type === 'medium-term');
  const activeProjects = projects.filter((p) => p.status === 'active');

  // Comms
  const unreadMessages = messages.filter((m) => m.status === 'unread');
  const pendingDecisions = decisions.filter((d) => d.status === 'pending');
  const recentEvents = [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  // Eisenhower counts
  const eisenhowerCounts = {
    do: tasks.filter(
      (t) => t.importance === 'important' && t.urgency === 'urgent' && t.kanban !== 'done',
    ).length,
    schedule: tasks.filter(
      (t) => t.importance === 'important' && t.urgency === 'not-urgent' && t.kanban !== 'done',
    ).length,
    delegate: tasks.filter(
      (t) => t.importance === 'not-important' && t.urgency === 'urgent' && t.kanban !== 'done',
    ).length,
    eliminate: tasks.filter(
      (t) => t.importance === 'not-important' && t.urgency === 'not-urgent' && t.kanban !== 'done',
    ).length,
  };

  // Attention items
  const doQuadrantMyTasks = tasks.filter(
    (t) =>
      t.importance === 'important' &&
      t.urgency === 'urgent' &&
      t.assignedTo === 'me' &&
      t.kanban === 'not-started',
  );
  const unreadReports = messages.filter((m) => m.status === 'unread' && m.type === 'report');

  return NextResponse.json(
    {
      stats: {
        totalTasks: tasks.length,
        inProgressTasks: inProgressTasks.length,
        awaitingVerificationTasks: awaitingVerificationTasks.length,
        doneTasks: doneTasks.length,
        totalGoals: longTermGoals.length,
        // Same rule as the objectives page and its cards (M3: `0/4 milestones`
        // over `78/78 tasks`) — derived from each milestone's own linked
        // tasks, not the stored `status` field the store never rewrites.
        completedMilestones: milestones.filter(
          (m) =>
            deriveGoalStatus(
              tasks.filter((t) => m.tasks.includes(t.id)),
              m.status,
            ) === 'completed',
        ).length,
        totalMilestones: milestones.length,
        activeProjects: activeProjects.length,
        unprocessedBrainDump: unprocessedEntries.length,
      },
      attention: {
        pendingDecisions: pendingDecisions.length,
        unreadReports: unreadReports.length,
        doQuadrantNotStarted: doQuadrantMyTasks.length,
      },
      eisenhowerCounts,
      unreadMessages: unreadMessages.slice(0, 5),
      pendingDecisionsList: pendingDecisions.slice(0, 5),
      recentActivity: recentEvents,
      tasks,
      goals,
      projects,
      // How much of each project is actually proven (§5 F3) — computed here
      // rather than on the card, because deriving it needs the verdict locker
      // and a card cannot open fifty run directories to draw a percentage.
      projectHealth: projectHealthAll(
        projects.map((p) => p.id),
        tasks,
      ),
      entries: unprocessedEntries.slice(0, 5),
      messages: unreadMessages,
      decisions: pendingDecisions,
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}
