'use client';

import { EmptyState } from '@/components/empty-state';
import { Markdown } from '@/components/library/markdown';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ActivityEvent, EventType, Task } from '@ligma/api';
import { AGENT_ROLES } from '@ligma/api';
import { Activity, BarChart3, Bot, ChevronDown, Code, Megaphone, Search, User } from 'lucide-react';
/**
 * The Activity timeline, split out of `activity/page.tsx` so the /needs-you
 * tray's "Activity" tab can mount the exact same rendering (props-driven, no
 * page-level data fetching in here — the caller's own `useActivityLog` /
 * `useTasks` hooks own the fetch, this only draws what they returned).
 */
import { useState } from 'react';
import { joinTaskTitle, summarizeDetails } from './activity-summary';

const agentIcons: Record<string, typeof User> = {
  me: User,
  researcher: Search,
  developer: Code,
  marketer: Megaphone,
  'business-analyst': BarChart3,
  system: Bot,
};

const eventTypeLabels: Record<EventType, string> = {
  task_created: 'Task Created',
  task_updated: 'Task Updated',
  task_completed: 'Task Completed',
  task_delegated: 'Task Delegated',
  message_sent: 'Message Sent',
  decision_requested: 'Decision Requested',
  decision_answered: 'Decision Answered',
  brain_dump_triaged: 'Brain Dump Processed',
  milestone_completed: 'Milestone Completed',
  agent_checkin: 'Agent Check-in',
  run: 'Run',
  verdict: 'Verdict',
  promote: 'Promoted to Build',
  design_turn: 'Design Turn',
};

const eventTypeColors: Record<EventType, string> = {
  task_created: 'bg-blue-500/20 text-blue-400',
  task_updated: 'bg-purple-500/20 text-purple-400',
  task_completed: 'bg-green-500/20 text-green-400',
  task_delegated: 'bg-orange-500/20 text-orange-400',
  message_sent: 'bg-cyan-500/20 text-cyan-400',
  decision_requested: 'bg-yellow-500/20 text-yellow-400',
  decision_answered: 'bg-emerald-500/20 text-emerald-400',
  brain_dump_triaged: 'bg-pink-500/20 text-pink-400',
  milestone_completed: 'bg-green-500/20 text-green-400',
  agent_checkin: 'bg-indigo-500/20 text-indigo-400',
  // Phase 2 kinds. Colour by what the row MEANS, reusing the table's existing
  // vocabulary rather than inventing a second one: a verdict is the same fact a
  // task_completed is (green), a promotion moves work forward like a delegation
  // (orange), a run is machine work (slate), a design turn is creative (violet).
  run: 'bg-slate-500/20 text-slate-400',
  verdict: 'bg-green-500/20 text-green-400',
  promote: 'bg-orange-500/20 text-orange-400',
  design_turn: 'bg-violet-500/20 text-violet-400',
};

function groupByDate(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const event of events) {
    const dateStr = new Date(event.timestamp).toDateString();
    let label: string;
    if (dateStr === today) label = 'Today';
    else if (dateStr === yesterday) label = 'Yesterday';
    else {
      const eventDate = new Date(event.timestamp);
      // Walkthrough: headers jumped MON, AUG 10 -> FRI, FEB 27 with no year to
      // tell them apart — add one once the header crosses a year boundary.
      const sameYear = eventDate.getFullYear() === new Date().getFullYear();
      label = eventDate.toLocaleDateString(
        'en-US',
        sameYear
          ? { weekday: 'short', month: 'short', day: 'numeric' }
          : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
      );
    }

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(event);
  }
  return groups;
}

/** Short details render inline; long ones (M7's 4,019px transcript) collapse
 * behind a disclosure with the full text — rendered as markdown since an
 * agent's own report is usually written in it (M6's unrendered `**bold**`). */
function EventDetails({ details }: { details: string }) {
  const [open, setOpen] = useState(false);
  const view = summarizeDetails(details);
  if (!view) return null;

  if (!view.long) {
    return <p className="text-xs text-muted-foreground mt-0.5 break-words">{view.preview}</p>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-0.5">
      <p className="text-xs text-muted-foreground break-words line-clamp-3">{view.preview}</p>
      <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        {view.markdown ? 'Show full report' : 'Show raw event'}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 max-w-full overflow-x-auto rounded-md border bg-muted/30 p-2">
        {view.markdown ? (
          <Markdown source={view.full} />
        ) : (
          <pre className="whitespace-pre-wrap break-words text-[11px]">{view.full}</pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActivityList({ events, tasks }: { events: ActivityEvent[]; tasks: Task[] }) {
  const [filterActor, setFilterActor] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const titleById = new Map(tasks.map((t) => [t.id, t.title]));

  let filtered = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (filterActor !== 'all') {
    filtered = filtered.filter((e) => e.actor === filterActor);
  }
  if (filterType !== 'all') {
    filtered = filtered.filter((e) => e.type === filterType);
  }

  const grouped = groupByDate(filtered);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={filterActor} onValueChange={setFilterActor}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="All actors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {AGENT_ROLES.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(eventTypeLabels) as EventType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {eventTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Timeline */}
      {Array.from(grouped.entries()).map(([dateLabel, dateEvents]) => (
        <section key={dateLabel} className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {dateLabel}
          </h2>
          <div className="space-y-1.5">
            {dateEvents.map((evt) => {
              const ActorIcon = agentIcons[evt.actor] ?? User;
              const actorLabel =
                evt.actor === 'system'
                  ? 'System'
                  : (AGENT_ROLES.find((r) => r.id === evt.actor)?.label ?? evt.actor);
              return (
                <Card key={evt.id} className="bg-card/50">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <ActorIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs px-1.5 ${eventTypeColors[evt.type]}`}>
                          {eventTypeLabels[evt.type]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{actorLabel}</span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {new Date(evt.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm mt-1 break-words">{joinTaskTitle(evt, titleById)}</p>
                      {evt.details && <EventDetails details={evt.details} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Actions taken by you and your AI agents will be logged here."
        />
      )}
    </div>
  );
}
