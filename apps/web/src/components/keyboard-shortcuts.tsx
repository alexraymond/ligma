'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/**
 * One entry per shortcut, and the same map drives both the handler and the help
 * dialog — the previous split let "N" keep advertising an action nothing was
 * wired to. Destinations follow the new IA (UX-REDESIGN §3, lib/nav.ts).
 *
 * Phase 3 retirements: the Deck and the Inbox merged into the needs-you tray,
 * and Objectives, the Board and the Priority Matrix retired into the portfolio.
 * Their chords are gone rather than pointed at a redirect — a shortcut to a
 * route that only bounces is a shortcut that lies about where you are going.
 */
const shortcuts: { key: string; label: string; href: string }[] = [
  { key: 'G H', label: 'Go to Home', href: '/' },
  { key: 'G N', label: 'Go to Needs you', href: '/needs-you' },
  { key: 'G P', label: 'Go to Projects', href: '/projects' },
  { key: 'G L', label: 'Go to Library', href: '/library' },
  { key: 'G C', label: 'Go to Crew', href: '/crew' },
  { key: 'G S', label: 'Go to Settings', href: '/settings' },
  { key: 'G R', label: 'Go to Runs', href: '/runs' },
  { key: 'G B', label: 'Go to Capture', href: '/brain-dump' },
];

const GO_TO = new Map(shortcuts.map((s) => [s.key.split(' ')[1].toLowerCase(), s.href]));

/**
 * Modifier shortcuts owned by other components — the palette (search-dialog),
 * the project switcher (project-switcher) and Talk (talk/talk-drawer). Listed
 * here because the `?` sheet is the one keyboard map, and a binding the user
 * can press but cannot find is the same bug from the other side. They are not
 * in `shortcuts` because this file does not handle them; nothing here can
 * advertise a chord it fails to route.
 */
const MODIFIERS: { key: string; label: string }[] = [
  { key: '⌘ K', label: 'Command palette — projects, stages, verbs' },
  { key: '⌘ P', label: 'Switch project' },
  { key: '⌘ J', label: 'Talk to the project' },
  { key: '?', label: 'This sheet' },
];

function Row({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between px-1 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.split(' ').map((k) => (
          <kbd
            key={k}
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const router = useRouter();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea/select
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Handle "G" prefix for navigation
      if (gPressed) {
        setGPressed(false);
        const href = GO_TO.get(e.key.toLowerCase());
        if (href) router.push(href);
        return;
      }

      // Single-key shortcuts
      switch (e.key) {
        case '?':
          setHelpOpen(true);
          break;
        case 'g':
          setGPressed(true);
          // Reset after 1 second if no follow-up
          setTimeout(() => setGPressed(false), 1000);
          break;
      }
    },
    [gPressed, router],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {shortcuts.map((s) => (
            <Row key={s.key} label={s.label} keys={s.key} />
          ))}
        </div>
        <div className="space-y-1 border-t pt-2">
          {MODIFIERS.map((m) => (
            <Row key={m.key} label={m.label} keys={m.key} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
