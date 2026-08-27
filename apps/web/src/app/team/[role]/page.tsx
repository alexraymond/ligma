'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { TaskCardSkeleton } from '@/components/skeletons';
import { TaskCard } from '@/components/task-card';
import { TaskDetailPanel } from '@/components/task-detail-panel';
import type { TaskFormData } from '@/components/task-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import {
  useActivityLog,
  useAgents,
  useGoals,
  useInbox,
  useProjects,
  useSkills,
  useTasks,
} from '@/hooks/use-data';
import { useFastTaskPoll } from '@/hooks/use-fast-task-poll';
import { formatRelativeTime } from '@/lib/time';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import type { Task } from '@ligma/api';
import {
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Code,
  Globe,
  HeartPulse,
  Megaphone,
  Palette,
  Plus,
  Save,
  Search,
  Send,
  Shield,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

const iconMap: Record<string, typeof User> = {
  User,
  Search,
  Code,
  Megaphone,
  BarChart3,
  Bot,
  Zap,
  Shield,
  Wrench,
  BookOpen,
  Globe,
  Brain,
  Palette,
  HeartPulse,
};

function getAgentIcon(iconName: string) {
  return iconMap[iconName] ?? Bot;
}

export default function TeamMemberPage() {
  const params = useParams();
  const roleId = params.role as string;
  const {
    tasks,
    loading,
    update: updateTask,
    remove: deleteTask,
    refetch: refetchTasks,
  } = useTasks();
  const { goals } = useGoals();
  const { projects } = useProjects();
  const { messages } = useInbox();
  const { events } = useActivityLog();
  const { agents, update: updateAgent, error: agentsError, refetch } = useAgents();
  const { skills: allSkills } = useSkills();
  const { runningTaskIds, isTaskRunning, runTask } = useActiveRuns();
  useFastTaskPoll(runningTaskIds.size > 0, refetchTasks);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Profile editing state
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState('');
  const [capInput, setCapInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const agent = agents.find((a) => a.id === roleId);

  if (loading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Crew', href: '/crew' }, { label: roleId }]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </div>
      </div>
    );
  }

  if (agentsError) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Crew', href: '/crew' }, { label: roleId }]} />
        <ErrorState message={agentsError} onRetry={refetch} />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Crew', href: '/crew' }, { label: 'Not Found' }]} />
        <p className="text-muted-foreground">Agent &ldquo;{roleId}&rdquo; not found.</p>
      </div>
    );
  }

  const Icon = getAgentIcon(agent.icon);
  const agentTasks = tasks.filter(
    (t) => t.assignedTo === agent.id || t.collaborators?.includes(agent.id),
  );
  const inProgress = agentTasks.filter((t) => t.kanban === 'in-progress');
  const todo = agentTasks.filter((t) => t.kanban === 'not-started');
  const completed = agentTasks.filter((t) => t.kanban === 'done');
  const agentMessages = messages
    .filter((m) => m.from === agent.id || m.to === agent.id)
    .slice(0, 5);
  const agentEvents = events.filter((e) => e.actor === agent.id).slice(0, 5);
  const linkedSkills = allSkills.filter((s) => agent.skillIds.includes(s.id));

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

  const handleDeleteTask = async () => {
    if (!selectedTask) return;
    await deleteTask(selectedTask.id);
    setSelectedTask(null);
  };

  const getProject = (id: string | null) => projects.find((p) => p.id === id) ?? null;

  const handleSaveInstructions = async () => {
    setSavingProfile(true);
    try {
      await updateAgent(agent.id, { instructions: instructionsText });
      setEditingInstructions(false);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveDescription = async () => {
    setSavingProfile(true);
    try {
      await updateAgent(agent.id, { description: descriptionText });
      setEditingDescription(false);
    } finally {
      setSavingProfile(false);
    }
  };

  const addCapability = async (cap: string) => {
    if (!cap.trim() || agent.capabilities.includes(cap.trim())) return;
    await updateAgent(agent.id, { capabilities: [...agent.capabilities, cap.trim()] });
    setCapInput('');
  };

  const removeCapability = async (cap: string) => {
    await updateAgent(agent.id, { capabilities: agent.capabilities.filter((c) => c !== cap) });
  };

  const addSkill = async (skillId: string) => {
    if (agent.skillIds.includes(skillId)) return;
    await updateAgent(agent.id, { skillIds: [...agent.skillIds, skillId] });
  };

  const removeSkill = async (skillId: string) => {
    await updateAgent(agent.id, { skillIds: agent.skillIds.filter((s) => s !== skillId) });
  };

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Crew', href: '/crew' }, { label: agent.name }]} />

      {/* Agent Profile Header */}
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{agent.name}</h1>
            <Badge
              variant={agent.status === 'active' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {agent.status}
            </Badge>
          </div>
          {editingDescription ? (
            <div className="flex items-center gap-2 mt-1">
              <Input
                value={descriptionText}
                onChange={(e) => setDescriptionText(e.target.value)}
                className="text-sm h-8"
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSaveDescription}
                disabled={savingProfile}
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingDescription(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors mt-0.5"
              onClick={() => {
                setDescriptionText(agent.description);
                setEditingDescription(true);
              }}
              title="Click to edit"
            >
              {agent.description || 'Click to add a description...'}
            </p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold tabular-nums">{agentTasks.length}</p>
            <p className="text-xs text-muted-foreground">Total Tasks</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold tabular-nums text-status-in-progress">
              {inProgress.length}
            </p>
            <p className="text-xs text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold tabular-nums text-status-done">{completed.length}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
      </div>

      {/* Instructions Section */}
      <section className="rounded-xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Instructions (System Prompt)</h2>
          {!editingInstructions && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setInstructionsText(agent.instructions);
                setEditingInstructions(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>
        {editingInstructions ? (
          <div className="space-y-2">
            <Textarea
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {instructionsText.length.toLocaleString()} characters
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingInstructions(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveInstructions}
                  disabled={savingProfile}
                  className="gap-1"
                >
                  <Save className="h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted rounded-lg p-3 max-h-48 overflow-y-auto">
            {agent.instructions || 'No instructions set. Click Edit to add a system prompt.'}
          </pre>
        )}
      </section>

      {/* Capabilities Section */}
      <section className="rounded-xl border bg-card/50 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Capabilities</h2>
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities.map((cap) => (
            <Badge key={cap} variant="secondary" className="gap-1 pr-1">
              {cap}
              <Tip content={`Remove ${cap}`}>
                <button
                  onClick={() => removeCapability(cap)}
                  aria-label={`Remove ${cap}`}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Tip>
            </Badge>
          ))}
          {agent.capabilities.length === 0 && (
            <p className="text-xs text-muted-foreground">No capabilities defined.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add capability..."
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCapability(capInput);
              }
            }}
            className="h-8 text-sm"
          />
          <Tip content="Add capability">
            <Button
              size="sm"
              variant="outline"
              aria-label="Add capability"
              onClick={() => addCapability(capInput)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Tip>
        </div>
      </section>

      {/* Skills Section */}
      <section className="rounded-xl border bg-card/50 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Assigned Skills</h2>
        {linkedSkills.length > 0 ? (
          <div className="space-y-2">
            {linkedSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg border p-2.5"
              >
                <div className="min-w-0">
                  {/* No dead ends (seam rule §8.3): the skill an agent carries links
                      to the skill itself, not just its name in a list. */}
                  <Link
                    href={`/library/${skill.id}`}
                    className="text-sm font-medium hover:underline underline-offset-2"
                  >
                    {skill.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{skill.description}</p>
                </div>
                <Tip content={`Remove ${skill.name}`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${skill.name}`}
                    onClick={() => removeSkill(skill.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No skills assigned.</p>
        )}
        {/* Available skills to add */}
        {allSkills.filter((s) => !agent.skillIds.includes(s.id)).length > 0 && (
          <div className="pt-2 border-t space-y-1">
            <p className="text-xs text-muted-foreground">Available skills:</p>
            <div className="flex flex-wrap gap-1.5">
              {allSkills
                .filter((s) => !agent.skillIds.includes(s.id))
                .map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => addSkill(skill.id)}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs hover:bg-primary/10 hover:border-primary/30 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {skill.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Task Sections */}
      {inProgress.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-status-in-progress" />
            In Progress ({inProgress.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {inProgress.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={getProject(task.projectId)}
                onClick={() => setSelectedTask(task)}
                isRunning={isTaskRunning(task.id)}
                onRun={runTask}
              />
            ))}
          </div>
        </section>
      )}

      {todo.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-status-not-started" />
            To Do ({todo.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {todo.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={getProject(task.projectId)}
                onClick={() => setSelectedTask(task)}
                isRunning={isTaskRunning(task.id)}
                onRun={runTask}
              />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-status-done" />
            Completed ({completed.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {completed.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={getProject(task.projectId)}
                onClick={() => setSelectedTask(task)}
                className="opacity-60"
                isRunning={isTaskRunning(task.id)}
                onRun={runTask}
              />
            ))}
          </div>
        </section>
      )}

      {agentTasks.length === 0 && (
        <EmptyState
          icon={Bot}
          title="No tasks assigned"
          description={`Assign tasks to ${agent.name} from the Eisenhower or Kanban views.`}
        />
      )}

      {/* Recent Messages */}
      {agentMessages.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Send className="h-3.5 w-3.5" />
            Recent Messages
          </h2>
          <div className="space-y-2">
            {agentMessages.map((msg) => (
              <Card key={msg.id} className="bg-card/50">
                <CardContent className="p-3 flex items-center gap-3">
                  <Badge
                    variant={msg.status === 'unread' ? 'default' : 'secondary'}
                    className="text-xs shrink-0"
                  >
                    {msg.type}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{msg.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {msg.from} → {msg.to}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(msg.createdAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      {agentEvents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">Recent Activity</h2>
          <div className="space-y-1">
            {agentEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-muted-foreground"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-primary/50 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{evt.summary}</span>
                <span className="text-xs shrink-0">{formatRelativeTime(evt.timestamp)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          goals={goals}
          allTasks={tasks}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
          onClose={() => setSelectedTask(null)}
          updateTaskFields={updateTask}
        />
      )}
    </div>
  );
}
