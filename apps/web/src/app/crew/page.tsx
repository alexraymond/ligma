'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { AgentCardSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { useAgents, useTasks } from '@/hooks/use-data';
import { cn } from '@/lib/utils';
import type { AgentDefinition } from '@ligma/api';
import {
  BarChart3,
  Bot,
  CircleDot,
  Code,
  Megaphone,
  Plus,
  Search,
  User,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Map Lucide icon names to components
const iconMap: Record<string, typeof User> = {
  User,
  Search,
  Code,
  Megaphone,
  BarChart3,
  Bot,
  Zap,
};

function getAgentIcon(iconName: string) {
  return iconMap[iconName] ?? Bot;
}

function AgentCard({
  agent,
  taskCount,
}: {
  agent: AgentDefinition;
  taskCount: number;
}) {
  const Icon = getAgentIcon(agent.icon);
  const isInactive = agent.status === 'inactive';

  return (
    <Link href={`/team/${agent.id}`}>
      <div
        className={cn(
          'group rounded-xl border bg-card p-5 transition-all hover:shadow-md hover:border-primary/30',
          isInactive && 'opacity-60',
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
                {agent.name}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {agent.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <CircleDot
              className={cn(
                'h-3 w-3',
                agent.status === 'active' ? 'text-green-500' : 'text-muted-foreground',
              )}
            />
          </div>
        </div>

        {/* Capabilities preview */}
        {agent.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {agent.capabilities.slice(0, 3).map((cap) => (
              <Badge key={cap} variant="secondary" className="text-[10px] px-1.5 py-0">
                {cap}
              </Badge>
            ))}
            {agent.capabilities.length > 3 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{agent.capabilities.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Footer stats */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t">
          <span className="text-xs text-muted-foreground">
            {taskCount} active task{taskCount !== 1 ? 's' : ''}
          </span>
          {agent.skillIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {agent.skillIds.length} skill{agent.skillIds.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function CrewPage() {
  const { agents, loading, error: agentsError, refetch } = useAgents();
  const { tasks } = useTasks();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const filteredAgents = filter === 'all' ? agents : agents.filter((a) => a.status === filter);

  // Count active (non-done) tasks per agent
  const taskCountByAgent = (agentId: string) =>
    tasks.filter(
      (t) =>
        t.kanban !== 'done' && (t.assignedTo === agentId || t.collaborators?.includes(agentId)),
    ).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Crew' }]} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AgentCardSkeleton />
          <AgentCardSkeleton />
          <AgentCardSkeleton />
        </div>
      </div>
    );
  }

  if (agentsError) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Crew' }]} />
        <ErrorState message={agentsError} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Crew' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Crew</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <Tip content="Create a custom AI agent">
          <Button size="sm" asChild className="gap-1.5">
            <Link href="/crew/new">
              <Plus className="h-3.5 w-3.5" /> New Agent
            </Link>
          </Button>
        </Tip>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'ghost'}
            size="sm"
            className="text-xs capitalize"
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {filteredAgents.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No agents found"
          description={
            filter === 'all' ? 'Create your first agent to get started.' : `No ${filter} agents.`
          }
          actionLabel="Create an agent"
          onAction={() => router.push('/crew/new')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} taskCount={taskCountByAgent(agent.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
