import { needsAttention } from '@ligma/api';
import { NextResponse } from '../../http';
import { getAgents, getDecisions, getInbox, getTasks } from '../../store/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [tasksData, inboxData, decisionsData, agentsData] = await Promise.all([
    getTasks(),
    getInbox(),
    getDecisions(),
    getAgents(),
  ]);

  const tasks = tasksData.tasks.filter((t) => !t.deletedAt);
  const unreadInbox = inboxData.messages.filter((m) => m.status === 'unread').length;
  // Actionable cards plus any deferred-but-still-blocking one — a halted task
  // must never be invisible just because its decision was snoozed for a week.
  const pendingDecisions = decisionsData.decisions.filter((d) => needsAttention(d)).length;
  const agents = agentsData.agents;

  return NextResponse.json(
    { tasks, unreadInbox, pendingDecisions, agents },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}
