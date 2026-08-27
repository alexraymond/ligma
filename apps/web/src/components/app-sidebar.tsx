'use client';

import { KickoffComposerDialog } from '@/components/kickoff-composer';
import { currentProjectIdFromPathname } from '@/components/project-switcher';
import { EXECUTION, VERIFICATION } from '@/components/status-pill';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActiveRuns } from '@/hooks/use-active-runs';
import { useConnection } from '@/hooks/use-connection';
import { useProjects } from '@/hooks/use-data';
import { type RailKey, railKeyFor } from '@/lib/nav';
import {
  RING_WORD,
  type RailRingState,
  browserRailStorage,
  defaultStagePath,
  railOrder,
  railRingState,
  railTooltip,
  readRecentProjects,
} from '@/lib/rail';
import { cn } from '@/lib/utils';
import { useDeckQueue } from '@/providers/deck-queue-provider';
import type { Project, Task } from '@ligma/api';
import { BookOpen, HelpCircle, Plus, Settings, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

/**
 * The project rail (UX-REDESIGN §3 Zone 1): the mark, the one interrupt entry,
 * then one avatar per project — pinned first, then most-recently-visited, past
 * eight into a "+N" chip. Library, Crew and Settings drop to the housekeeping
 * cluster at the bottom.
 *
 * Every ring state is also a word (`RING_WORD`), in the tooltip and — expanded
 * — beside the name, because a status only a colour carries is not reachable
 * (spec §16). Ring colours are borrowed from status-pill.tsx's tables; this
 * file paints no status of its own (seam rule 1). The one exception is
 * `no-signal`, a desaturated neutral rather than a hue — the same treatment the
 * heartbeat uses when the daemon poll fails.
 */
const RING: Record<RailRingState, string> = {
  running: EXECUTION.running.className,
  // Amber: the app's "a human still has to say something" colour, taken from
  // status-pill's table rather than invented here.
  'needs-you': VERIFICATION.waived.className,
  quiet: EXECUTION.queued.className,
  'no-signal': 'border-muted-foreground/25 text-muted-foreground/50',
};

/** Housekeeping tier — the entries that used to be full rail rows. */
const BOTTOM: { key: RailKey; href: string; label: string; icon: typeof BookOpen }[] = [
  { key: 'library', href: '/library', label: 'Library', icon: BookOpen },
  { key: 'crew', href: '/crew', label: 'Crew', icon: Users },
  { key: 'settings', href: '/settings', label: 'Settings', icon: Settings },
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

interface AppSidebarProps {
  collapsed: boolean;
  /** Blocking items in the needs-you tray — never inflated by FYI or unread inbox counts. */
  needsYouBlocking?: number;
  /**
   * The workspace's tasks (the shell already holds them), used only to pick each
   * avatar's default stage: Build once a project has tasks.
   */
  tasks?: Task[];
  isMobile?: boolean;
  onClose?: () => void;
}

export function AppSidebar({
  collapsed,
  needsYouBlocking = 0,
  tasks = [],
  isMobile = false,
  onClose,
}: AppSidebarProps) {
  const pathname = usePathname();
  const activeKey = railKeyFor(pathname);
  const activeProjectId = currentProjectIdFromPathname(pathname);
  // Collapsed only applies to the desktop rail; the mobile drawer is always full width.
  const narrow = collapsed && !isMobile;

  const { projects } = useProjects();
  const { runningProjectIds } = useActiveRuns();
  const { needsYou } = useDeckQueue();
  const { online } = useConnection();
  const [composerOpen, setComposerOpen] = useState(false);

  // localStorage is read after mount (it does not exist during SSR) and again
  // whenever the route changes — the project layout records the visit, and this
  // is how the rail learns about it without a second store.
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    const storage = browserRailStorage();
    setRecents(storage ? readRecentProjects(storage) : []);
  }, [pathname]);

  const { visible, overflow } = useMemo(() => railOrder(projects, recents), [projects, recents]);
  const projectsWithTasks = useMemo(
    () => new Set(tasks.map((t) => t.projectId).filter((id): id is string => Boolean(id))),
    [tasks],
  );

  function ringFor(project: Project): RailRingState {
    return railRingState(project.id, {
      runningProjectIds,
      blockingByProject: needsYou,
      reachable: online,
    });
  }

  /** Tooltip on the narrow rail, plain content when the label is already visible. */
  function tipped(key: string, content: string, node: React.ReactNode) {
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{content}</TooltipContent>
      </Tooltip>
    );
  }

  const mark = (
    <Link
      href="/"
      onClick={isMobile ? onClose : undefined}
      aria-label="Ligma — home"
      aria-current={activeKey === 'home' ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent/50',
        narrow && 'justify-center px-0',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static local asset, no next/image usage elsewhere in the app */}
      <img src="/logo-mark.png" alt="" className="h-6 w-auto" />
      {!narrow && <span className="text-sm font-semibold">Ligma</span>}
    </Link>
  );

  const needsYouEntry = (
    <Link
      href="/needs-you"
      onClick={isMobile ? onClose : undefined}
      aria-current={activeKey === 'needs-you' ? 'page' : undefined}
      aria-label={needsYouBlocking > 0 ? `Needs you — ${needsYouBlocking} blocking` : 'Needs you'}
      className={cn(
        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        narrow && 'justify-center px-2',
        activeKey === 'needs-you'
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
      )}
    >
      <HelpCircle className="h-4 w-4 shrink-0" />
      {!narrow && <span className="flex-1">Needs you</span>}
      {needsYouBlocking > 0 &&
        (narrow ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
        ) : (
          <Badge
            variant="destructive"
            className="h-5 min-w-5 justify-center px-1.5 text-xs tabular-nums"
          >
            {needsYouBlocking}
          </Badge>
        ))}
    </Link>
  );

  const avatars = visible.map((project) => {
    const ring = ringFor(project);
    const label = railTooltip(project.name, ring);
    const isActive = project.id === activeProjectId;
    const link = (
      <Link
        href={defaultStagePath(project, projectsWithTasks.has(project.id))}
        onClick={isMobile ? onClose : undefined}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50',
          narrow && 'justify-center px-0',
          isActive && 'bg-sidebar-accent',
        )}
      >
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2',
            RING[ring],
            isActive && 'ring-2 ring-ring',
          )}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ backgroundColor: project.color }}
          >
            {initials(project.name)}
          </span>
        </span>
        {!narrow && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{project.name}</span>
            {/* The ring, in words — the same state the colour carries. */}
            <span className="block truncate text-[10px] text-muted-foreground">
              {RING_WORD[ring]}
            </span>
          </span>
        )}
      </Link>
    );
    return tipped(project.id, label, link);
  });

  const addButton = tipped(
    '__add__',
    'Start something new',
    <Button
      variant="ghost"
      onClick={() => setComposerOpen(true)}
      aria-label="Start something new"
      className={cn(
        'flex h-auto w-full items-center gap-2 rounded-lg px-2 py-1.5 font-normal',
        narrow ? 'justify-center px-0' : 'justify-start',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40">
        <Plus className="h-4 w-4" />
      </span>
      {!narrow && <span className="text-sm">New project</span>}
    </Button>,
  );

  const overflowChip =
    overflow > 0
      ? tipped(
          '__overflow__',
          `${overflow} more — open the portfolio`,
          <Link
            href="/projects"
            onClick={isMobile ? onClose : undefined}
            aria-label={`${overflow} more projects — open the portfolio`}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/50',
              narrow && 'justify-center px-0',
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold tabular-nums text-muted-foreground">
              +{overflow}
            </span>
            {!narrow && (
              <span className="truncate text-sm text-muted-foreground">All projects</span>
            )}
          </Link>,
        )
      : null;

  const nav = (
    <nav aria-label="Global navigation" className="flex-1 space-y-1 overflow-y-auto p-2">
      {mark}
      <Separator />
      {needsYouEntry}
      <Separator />
      <div className="space-y-1">
        {avatars}
        {overflowChip}
        {addButton}
      </div>
    </nav>
  );

  const footer = (
    <div className="space-y-2 border-t p-2">
      <div className={cn('flex items-center gap-1', narrow ? 'flex-col' : 'flex-wrap')}>
        {BOTTOM.map(({ key, href, label, icon: Icon }) =>
          tipped(
            href,
            label,
            <Link
              href={href}
              onClick={isMobile ? onClose : undefined}
              aria-label={label}
              aria-current={key === activeKey ? 'page' : undefined}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                key === activeKey
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
            </Link>,
          ),
        )}
        <ThemeToggle />
      </div>
    </div>
  );

  const composer = (
    <KickoffComposerDialog
      open={composerOpen}
      onOpenChange={(next) => {
        setComposerOpen(next);
        if (!next && isMobile) onClose?.();
      }}
    />
  );

  if (isMobile) {
    return (
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-sidebar-background shadow-2xl transition-transform duration-200',
          collapsed ? '-translate-x-full' : 'translate-x-0',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold">Projects</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="shrink-0"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close sidebar</TooltipContent>
          </Tooltip>
        </div>
        {nav}
        {footer}
        {composer}
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-14 z-30 flex h-[calc(100vh-3.5rem)] flex-col border-r bg-sidebar-background transition-all duration-200',
        narrow ? 'w-14' : 'w-56',
      )}
    >
      {nav}
      {footer}
      {composer}
    </aside>
  );
}
