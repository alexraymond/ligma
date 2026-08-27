'use client';

import { AppSidebar } from '@/components/app-sidebar';
import { CommandBar } from '@/components/command-bar';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { OnboardingHint } from '@/components/onboarding';
import { SearchDialog } from '@/components/search-dialog';
import { SectionTabs } from '@/components/section-tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useConnection } from '@/hooks/use-connection';
import { useTasks } from '@/hooks/use-data';
import { apiFetch } from '@/lib/api-client';
import { isStudioRoute, recordHref } from '@/lib/nav';
import { classifyTray } from '@/lib/needs-you';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ActiveRunsProvider } from '@/providers/active-runs-provider';
import { useDeckQueue } from '@/providers/deck-queue-provider';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface LayoutShellProps {
  children: React.ReactNode;
}

export function LayoutShell({ children }: LayoutShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  // `useTasks()`, not a dedicated `/api/sidebar` poll (W18/W19): the sidebar
  // hook fetched `agents`/`unreadInbox`/`pendingDecisions` alongside `tasks`
  // on its own 10s interval, and this was the only caller — `tasks` was the
  // only field ever read, so the other three (and the whole second polling
  // mechanism) were pure waste. `useTasks()` is the shared collection-store
  // hook every other task list in the app already reads, so this also drops
  // a duplicate fetch of the same data.
  const { tasks } = useTasks();
  // Not /api/sidebar's `pendingDecisions`: that counts decisions only, and the
  // needs-you tray holds three more kinds of blocking card, plus the machine
  // itself (UX-REBUILD-BRIEF §Phase 1). Inbox messages are FYI, never
  // blocking, so the rail badge classifies with an empty inbox list rather
  // than pulling `useInbox()` a second time just to ignore its result.
  const { cards: deckCards } = useDeckQueue();
  const { online } = useConnection();
  const { blocking: needsYouBlocking } = classifyTray(deckCards, [], !online);

  // Detect mobile viewport and auto-close sidebar
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [pathname, isMobile]);

  const handleCapture = useCallback(async (content: string) => {
    try {
      const res = await apiFetch('/api/brain-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          capturedAt: new Date().toISOString(),
          processed: false,
          convertedTo: null,
          tags: [],
        }),
      });
      if (!res.ok) throw new Error('Failed to capture');
      showSuccess('Entry created');
    } catch {
      showError('Failed to capture entry');
    }
  }, []);

  // The Studio workspace is the whole viewport (spec
  // 2026-08-26-studio-fullscreen-workspace-design): no rail, no command bar, no
  // page padding. Same providers, so nothing below has to know it lost its
  // chrome — only the visible shell stands down. The two invisible listeners
  // stay: ⌘K and the shortcut sheet are not chrome, and a workspace that
  // silently dropped them would be a second, quieter bug.
  if (isStudioRoute(pathname)) {
    return (
      <TooltipProvider delayDuration={300}>
        <KeyboardShortcuts />
        <SearchDialog />
        <ActiveRunsProvider>{children}</ActiveRunsProvider>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-background">
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <KeyboardShortcuts />
        <SearchDialog />
        <CommandBar
          onCapture={handleCapture}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isMobile={isMobile}
          tasks={tasks}
          onTaskClick={(task) => {
            // Open the record, not the list it lives in: the portfolio's task
            // view reads ?task= and pops the task detail panel.
            router.push(recordHref('task', task.id));
          }}
        />

        {/* Mobile sidebar backdrop */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* The rail reads its own projects, runs and recents; `tasks` is passed
          because the shell already holds the full list (/api/sidebar) and the
          rail only needs it to pick each avatar's default stage. */}
        <AppSidebar
          collapsed={!sidebarOpen}
          needsYouBlocking={needsYouBlocking.length}
          tasks={tasks}
          isMobile={isMobile}
          onClose={() => setSidebarOpen(false)}
        />
        <main
          id="main-content"
          className={cn(
            'min-h-[calc(100vh-3.5rem)] transition-all duration-200 p-4 md:p-6',
            isMobile ? 'ml-0' : sidebarOpen ? 'ml-56' : 'ml-14',
          )}
        >
          {!online && (
            <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs text-center py-2 px-3 flex items-center justify-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
              Connection lost — changes may not save. Retrying automatically...
            </div>
          )}
          <OnboardingHint
            id="first-visit"
            title="Welcome to Ligma"
            body="The rail on the left is always here — the mark takes you home, then Needs you, then one avatar per project. Library, Crew and Settings sit at the bottom."
            className="mb-4"
          />
          <SectionTabs />
          <ActiveRunsProvider>{children}</ActiveRunsProvider>
        </main>
      </div>
    </TooltipProvider>
  );
}
