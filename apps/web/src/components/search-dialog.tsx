'use client';

import { currentProjectIdFromPathname } from '@/components/project-switcher';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useActiveRuns } from '@/hooks/use-active-runs';
import { useConnection } from '@/hooks/use-connection';
import { useDaemon } from '@/hooks/use-daemon';
import { useBrainDump, useGoals, useProjects, useTasks } from '@/hooks/use-data';
import { type RecordKind, recordHref } from '@/lib/nav';
import { RING_WORD, defaultStagePath, railRingState, stagesFor } from '@/lib/rail';
import { cn } from '@/lib/utils';
import { useDeckQueue } from '@/providers/deck-queue-provider';
import { deriveGoalStatus } from '@ligma/api';
import type { Project, Task } from '@ligma/api';
import {
  ArrowRight,
  CheckSquare,
  Crosshair,
  HelpCircle,
  Layers,
  Lightbulb,
  MessageSquare,
  OctagonX,
  PauseCircle,
  Play,
  Rocket,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const QUADRANT_LABELS: Record<string, { label: string; className: string }> = {
  do: { label: 'DO', className: 'bg-red-500/20 text-red-400' },
  schedule: { label: 'SCHEDULE', className: 'bg-blue-500/20 text-blue-400' },
  delegate: { label: 'DELEGATE', className: 'bg-amber-500/20 text-amber-400' },
  eliminate: { label: 'ELIMINATE', className: 'bg-zinc-500/20 text-zinc-400' },
};

const KANBAN_LABELS: Record<string, { label: string; className: string }> = {
  'not-started': { label: 'Todo', className: 'bg-zinc-500/20 text-zinc-400' },
  'in-progress': { label: 'Active', className: 'bg-blue-500/20 text-blue-400' },
  'awaiting-verification': { label: 'Verify', className: 'bg-amber-500/20 text-amber-400' },
  done: { label: 'Done', className: 'bg-emerald-500/20 text-emerald-400' },
};

function getQuadrantKey(task: Task): string {
  if (task.importance === 'important' && task.urgency === 'urgent') return 'do';
  if (task.importance === 'important' && task.urgency === 'not-urgent') return 'schedule';
  if (task.importance === 'not-important' && task.urgency === 'urgent') return 'delegate';
  return 'eliminate';
}

const MAX_RESULTS = 5;

/**
 * ⌘K, grown from a record search into the command palette (UX-REDESIGN §16):
 * project → stage → verb, plus the record search it already did.
 *
 * The verbs are the ones the spec names, in the spec's vocabulary — never the
 * word "Pause" alone: *Stop starting new work* is the per-project dispatcher
 * gate, *Stop everything now* is the global one. The global stop confirms
 * inside the palette rather than routing to the machine overlay: the overlay
 * has no URL to route to (it opens from the heartbeat's own state), so a second
 * palette step is the honest shape rather than a link that cannot be followed.
 * The overlay keeps its own stop with the aftermath panel — this is a second
 * door to `stopEngine()`, not a second implementation of it.
 */
export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmingStop, setConfirmingStop] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { tasks } = useTasks();
  const { goals } = useGoals();
  const { projects, update: updateProject } = useProjects();
  const { entries: brainDumpEntries } = useBrainDump();
  const { stop: stopEverything } = useDaemon();
  const { runningProjectIds } = useActiveRuns();
  const { needsYou } = useDeckQueue();
  const { online } = useConnection();

  // Listen for Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sort by most recent first
  const sortedTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, MAX_RESULTS),
    [tasks],
  );

  const sortedGoals = useMemo(
    () =>
      [...goals]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_RESULTS),
    [goals],
  );

  const sortedBrainDump = useMemo(
    () =>
      [...brainDumpEntries]
        .filter((e) => !e.processed)
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
        .slice(0, MAX_RESULTS),
    [brainDumpEntries],
  );

  /**
   * The projects the palette offers verbs for: the one you are in first, then
   * the newest. Capped like every other group — cmdk narrows the rest as you
   * type, since each item carries its project's name in its value.
   */
  const currentProjectId = currentProjectIdFromPathname(pathname);
  const shortlist = useMemo(() => {
    const live = projects.filter((p) => p.status !== 'archived' && !p.deletedAt);
    const ordered = [...live].sort((a, b) => {
      if (a.id === currentProjectId) return -1;
      if (b.id === currentProjectId) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return ordered.slice(0, MAX_RESULTS);
  }, [projects, currentProjectId]);

  const projectHasTasks = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.projectId).filter((id): id is string => Boolean(id)));
    return (id: string) => ids.has(id);
  }, [tasks]);

  function stateWord(project: Project): string {
    return RING_WORD[
      railRingState(project.id, {
        runningProjectIds,
        blockingByProject: needsYou,
        reachable: online,
      })
    ];
  }

  function close() {
    setOpen(false);
    setQuery('');
    setConfirmingStop(false);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  /**
   * Open the record, never just the list that contains it (D7 DC-3). Tasks and
   * goals now open inside the portfolio's views; `recordHref` owns the mapping
   * so both search surfaces agree.
   */
  function handleSelect(kind: RecordKind, id: string) {
    go(recordHref(kind, id));
  }

  async function setProjectStatus(project: Project, status: Project['status']) {
    close();
    await updateProject(project.id, { status }).catch(() => {});
  }

  // Stage items would flood an empty palette with four rows per project, so
  // they appear once something is typed — "atlas studio" is what they are for.
  const showStages = query.trim().length >= 2;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) close();
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search records, or type a project, stage or command..."
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* The one confirm step: while it is up, it is the only thing offered. */}
        {confirmingStop ? (
          <CommandGroup heading="Stop everything now">
            <CommandItem
              value="confirm stop everything now"
              onSelect={() => {
                close();
                void stopEverything();
              }}
              className="flex items-center gap-2 text-destructive"
            >
              <OctagonX className="h-4 w-4 shrink-0" />
              <span className="flex-1">Yes — stop the engine and every agent it is running</span>
            </CommandItem>
            <CommandItem
              value="cancel keep running"
              onSelect={() => setConfirmingStop(false)}
              className="flex items-center gap-2"
            >
              <span className="flex-1 text-muted-foreground">
                Cancel — leave everything running
              </span>
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            {/* Projects — "Open <name>", with the ring state as a word (spec §16). */}
            {shortlist.length > 0 && (
              <CommandGroup heading="Projects">
                {shortlist.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`open project ${project.name} ${project.description}`}
                    onSelect={() => go(defaultStagePath(project, projectHasTasks(project.id)))}
                    className="flex items-center gap-2"
                  >
                    <Rocket className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">Open {project.name}</span>
                    <span className="text-xs text-muted-foreground">{stateWord(project)}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showStages && shortlist.length > 0 && <CommandSeparator />}

            {/* Stages — "<name> studio" jumps straight into a stage. */}
            {showStages && shortlist.length > 0 && (
              <CommandGroup heading="Stages">
                {shortlist.flatMap((project) =>
                  stagesFor(project).map((stage) => (
                    <CommandItem
                      key={`${project.id}:${stage.key}`}
                      value={`${project.name} ${stage.label} stage`}
                      onSelect={() =>
                        go(`/projects/${encodeURIComponent(project.id)}/${stage.segment}`)
                      }
                      className="flex items-center gap-2"
                    >
                      <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {project.name} — {stage.label}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                    </CommandItem>
                  )),
                )}
              </CommandGroup>
            )}

            <CommandSeparator />

            {/* Verbs (spec §16 "Verbs for starting and stopping"). */}
            <CommandGroup heading="Commands">
              <CommandItem
                value="needs you tray blocking decisions"
                onSelect={() => go('/needs-you')}
                className="flex items-center gap-2"
              >
                <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">Needs you</span>
              </CommandItem>

              {shortlist.map((project) =>
                project.status === 'paused' ? (
                  <CommandItem
                    key={`resume:${project.id}`}
                    value={`resume ${project.name}`}
                    onSelect={() => void setProjectStatus(project, 'active')}
                    className="flex items-center gap-2"
                  >
                    <Play className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">Resume — {project.name}</span>
                  </CommandItem>
                ) : (
                  <CommandItem
                    key={`gate:${project.id}`}
                    value={`stop starting new work ${project.name}`}
                    onSelect={() => void setProjectStatus(project, 'paused')}
                    className="flex items-center gap-2"
                  >
                    <PauseCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">Stop starting new work — {project.name}</span>
                  </CommandItem>
                ),
              )}

              {shortlist.map((project) => (
                <CommandItem
                  key={`talk:${project.id}`}
                  value={`talk ${project.name}`}
                  // `?talk=1`: TalkLauncher (talk-drawer.tsx) opens the drawer on
                  // arrival instead of just landing on the project page with a
                  // second ⌘J still required (W15).
                  onSelect={() =>
                    go(`${defaultStagePath(project, projectHasTasks(project.id))}?talk=1`)
                  }
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">Talk — {project.name}</span>
                </CommandItem>
              ))}

              <CommandItem
                value="stop everything now kill all agents"
                onSelect={() => setConfirmingStop(true)}
                className="flex items-center gap-2 text-destructive"
              >
                <OctagonX className="h-4 w-4 shrink-0" />
                <span className="flex-1">Stop everything now</span>
                <span className="text-xs text-muted-foreground">asks first</span>
              </CommandItem>
            </CommandGroup>

            {sortedTasks.length > 0 && <CommandSeparator />}

            {/* Tasks */}
            {sortedTasks.length > 0 && (
              <CommandGroup heading="Tasks">
                {sortedTasks.map((task) => {
                  const quad = QUADRANT_LABELS[getQuadrantKey(task)];
                  const kanban = KANBAN_LABELS[task.kanban];
                  return (
                    <CommandItem
                      key={task.id}
                      value={`task ${task.title} ${task.description}`}
                      onSelect={() => handleSelect('task', task.id)}
                      className="flex items-center gap-2"
                    >
                      <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{task.title}</span>
                      {quad && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            quad.className,
                          )}
                        >
                          {quad.label}
                        </span>
                      )}
                      {kanban && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                            kanban.className,
                          )}
                        >
                          {kanban.label}
                        </span>
                      )}
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {sortedTasks.length > 0 && sortedGoals.length > 0 && <CommandSeparator />}

            {/* Objectives (Goals) */}
            {sortedGoals.length > 0 && (
              <CommandGroup heading="Objectives">
                {sortedGoals.map((goal) => {
                  // Same source as the portfolio's goals view: derived from linked
                  // tasks once any exist, not the stored (unsynced) `status` field.
                  const status = deriveGoalStatus(
                    tasks.filter((t) => goal.tasks.includes(t.id)),
                    goal.status,
                  );
                  return (
                    <CommandItem
                      key={goal.id}
                      value={`objective goal ${goal.title} ${goal.type} ${goal.timeframe}`}
                      onSelect={() => handleSelect('goal', goal.id)}
                      className="flex items-center gap-2"
                    >
                      <Crosshair className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{goal.title}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          goal.type === 'long-term'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-cyan-500/20 text-cyan-400',
                        )}
                      >
                        {goal.type === 'long-term' ? 'Long-term' : 'Milestone'}
                      </span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : status === 'in-progress'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-zinc-500/20 text-zinc-400',
                        )}
                      >
                        {status}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {sortedGoals.length > 0 && sortedBrainDump.length > 0 && <CommandSeparator />}

            {/* Brain Dump */}
            {sortedBrainDump.length > 0 && (
              <CommandGroup heading="Brain Dump">
                {sortedBrainDump.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`braindump idea ${entry.content}`}
                    onSelect={() => handleSelect('braindump', entry.id)}
                    className="flex items-center gap-2"
                  >
                    <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{entry.content}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400">
                      unprocessed
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
