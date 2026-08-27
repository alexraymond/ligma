'use client';

import { RunButton } from '@/components/run-button';
import { VerificationPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { healthPill } from '@/lib/health';
import { cn } from '@/lib/utils';
import type { Goal, Project, ProjectHealth, Task } from '@ligma/api';
import { getQuadrant } from '@ligma/api';
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { Inbox } from 'lucide-react';
import Link from 'next/link';

interface ProjectCardLargeProps {
  project: Project;
  tasks: Task[];
  goals: Goal[];
  /** Verified-ness, joined daemon-side. Absent means "not served", not zero. */
  health?: ProjectHealth;
  /** How many Deck cards are waiting on this project (§5 F3). */
  needsYou?: number;
  isRunning?: boolean;
  onRun?: (projectId: string) => void;
  onEdit?: (projectId: string) => void;
  onArchive?: (projectId: string) => void;
  onDelete?: (projectId: string) => void;
  /** Flips `project.pinned` (rail §16: pinned projects list first, then recents). */
  onTogglePin?: (projectId: string) => void;
}

export function ProjectCardLarge({
  project,
  tasks,
  goals,
  health,
  needsYou,
  isRunning,
  onRun,
  onEdit,
  onArchive,
  onDelete,
  onTogglePin,
}: ProjectCardLargeProps) {
  const pill = healthPill(health);
  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const notStarted = projectTasks.filter((t) => t.kanban === 'not-started').length;
  const inProgress = projectTasks.filter((t) => t.kanban === 'in-progress').length;
  const done = projectTasks.filter((t) => t.kanban === 'done').length;
  const total = projectTasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Eisenhower mini counts
  const qCounts = { do: 0, schedule: 0, delegate: 0, eliminate: 0 };
  projectTasks
    .filter((t) => t.kanban !== 'done')
    .forEach((t) => {
      qCounts[getQuadrant(t)]++;
    });

  const activeMilestone = goals.find(
    (g) => g.projectId === project.id && g.type === 'medium-term' && g.status === 'in-progress',
  );

  // Check if project has tasks eligible to run (not done, has AI agent)
  const hasEligibleTasks = projectTasks.some(
    (t) => t.kanban !== 'done' && t.assignedTo && t.assignedTo !== 'me',
  );

  return (
    <Link href={`/projects/${project.id}`}>
      <Card
        className={cn(
          'group cursor-pointer transition-all hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 animate-fade-in-up',
          isRunning && 'ring-2 ring-green-500/50 border-green-500/30 shadow-green-500/10 shadow-md',
        )}
      >
        <CardHeader className={cn('pb-3', isRunning && 'bg-green-500/5 rounded-t-lg')}>
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <CardTitle className="truncate text-base" title={project.name}>
                {project.name}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Run button — runs all eligible project tasks */}
              {onRun && hasEligibleTasks && (
                <RunButton
                  isRunning={isRunning ?? false}
                  onClick={() => onRun(project.id)}
                  size="md"
                  title={isRunning ? 'Project tasks launching...' : 'Launch all project tasks'}
                />
              )}
              <Badge variant="outline" className="text-xs capitalize">
                {project.status}
              </Badge>
              {/* More actions dropdown */}
              {(onEdit || onArchive || onDelete || onTogglePin) && (
                <DropdownMenu>
                  <Tip content="Project actions">
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        aria-label="Project actions"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {onTogglePin && (
                      <DropdownMenuItem onClick={() => onTogglePin(project.id)}>
                        {project.pinned ? (
                          <>
                            <PinOff className="h-3.5 w-3.5 mr-2" />
                            Unpin
                          </>
                        ) : (
                          <>
                            <Pin className="h-3.5 w-3.5 mr-2" />
                            Pin to rail
                          </>
                        )}
                      </DropdownMenuItem>
                    )}
                    {onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(project.id)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {onArchive && project.status !== 'archived' && (
                      <DropdownMenuItem onClick={() => onArchive(project.id)}>
                        <Archive className="h-3.5 w-3.5 mr-2" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    {onArchive && project.status === 'archived' && (
                      <DropdownMenuItem onClick={() => onArchive(project.id)}>
                        <Archive className="h-3.5 w-3.5 mr-2" />
                        Unarchive
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(project.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{project.description}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Health and needs-you: the two numbers F3's five-minute morning is
              scanned for. Health is never green — a percentage is an aggregate
              over many verdicts with no single one to link (§8.8). */}
          {(pill || (needsYou ?? 0) > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {pill && <VerificationPill status={pill.status} label={pill.label} tip={pill.tip} />}
              {(needsYou ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-yellow-500/50 text-xs text-yellow-600"
                >
                  <Inbox className="h-3 w-3" />
                  {needsYou} needs you
                </Badge>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Task counts */}
          <div className="flex gap-3 text-xs">
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{notStarted}</span> todo
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-status-in-progress">{inProgress}</span> active
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-status-done">{done}</span> done
            </span>
          </div>

          {/* Eisenhower mini heat */}
          <div className="grid grid-cols-4 gap-1">
            {[
              { key: 'do' as const, label: 'DO', color: 'bg-quadrant-do' },
              { key: 'schedule' as const, label: 'SCH', color: 'bg-quadrant-schedule' },
              { key: 'delegate' as const, label: 'DEL', color: 'bg-quadrant-delegate' },
              { key: 'eliminate' as const, label: 'ELM', color: 'bg-quadrant-eliminate' },
            ].map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className={`h-2 w-2 rounded-full ${color}`} />
                <span>{qCounts[key]}</span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>

          {/* Active milestone */}
          {activeMilestone && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              <span className="text-primary">▸</span> {activeMilestone.title}
            </div>
          )}

          {/* Tags */}
          {project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
