'use client';

import { Heartbeat } from '@/components/machine/heartbeat';
import { ProjectSwitcher } from '@/components/project-switcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tip';
import { kanbanDot, kanbanLabels } from '@/lib/kanban';
import { cn } from '@/lib/utils';
import { SKILLS } from '@ligma/api';
import type { Task } from '@ligma/api';
import {
  Bot,
  Lightbulb,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Search,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UseEverywhereModal } from './use-everywhere/UseEverywhereModal';

interface CommandBarProps {
  onCapture: (content: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  isMobile?: boolean;
  tasks?: Task[];
  onTaskClick?: (task: Task) => void;
}

export function CommandBar({
  onCapture,
  sidebarOpen,
  onToggleSidebar,
  isMobile = false,
  tasks = [],
  onTaskClick,
}: CommandBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [slashNotification, setSlashNotification] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [useEverywhereOpen, setUseEverywhereOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute matching skills when typing "/"
  const matchingSkills = useMemo(() => {
    if (!value.startsWith('/')) return [];
    const query = value.trim().toLowerCase();
    return SKILLS.filter((s) => s.command.startsWith(query));
  }, [value]);

  // Compute matching tasks for search (when typing "?" prefix or 3+ chars)
  const matchingTasks = useMemo(() => {
    const query = value.startsWith('?') ? value.slice(1).trim() : value.trim();
    if (query.length < 2 || value.startsWith('/')) return [];
    const lower = query.toLowerCase();
    return tasks
      .filter(
        (t) => t.title.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower),
      )
      .slice(0, 8);
  }, [value, tasks]);

  const showTaskResults = focused && matchingTasks.length > 0 && !value.startsWith('/');

  // Show/hide suggestions
  useEffect(() => {
    setShowSuggestions(value.startsWith('/') && matchingSkills.length > 0 && focused);
  }, [value, matchingSkills.length, focused]);

  // Global keyboard shortcut: "/" to focus
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Intercept slash commands
    if (trimmed.startsWith('/')) {
      const matchedSkill = SKILLS.find(
        (s) => s.command === trimmed || trimmed.startsWith(`${s.command} `),
      );
      if (matchedSkill) {
        setSlashNotification(matchedSkill.command);
        setValue('');
        setShowSuggestions(false);
        setTimeout(() => setSlashNotification(null), 5000);
        return;
      }
    }

    onCapture(trimmed);
    setValue('');
  }, [value, onCapture]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/80 backdrop-blur-md px-4">
      <ProjectSwitcher />

      {/* Sidebar toggle */}
      <Tip content="Toggle sidebar">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Toggle sidebar"
        >
          {isMobile ? (
            <Menu className="h-5 w-5" />
          ) : sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeft className="h-5 w-5" />
          )}
        </Button>
      </Tip>

      <Tip content="Use ligma everywhere">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setUseEverywhereOpen(true)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Use ligma everywhere"
        >
          <Terminal className="h-5 w-5" />
        </Button>
      </Tip>

      {/* Quick capture input */}
      <div
        className={cn(
          'relative flex flex-1 items-center gap-2 rounded-lg border bg-card px-3 transition-all',
          focused ? 'border-primary ring-1 ring-primary/30' : 'border-border',
        )}
      >
        <Tip content="Capture a brain dump">
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            className="shrink-0 text-muted-foreground hover:text-amber-500 transition-colors"
          >
            <Lightbulb className="h-4 w-4" />
          </button>
        </Tip>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay to allow click on suggestions
            setTimeout(() => {
              setFocused(false);
              setShowSuggestions(false);
            }, 150);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Brain dump — capture anything"
          className="h-9 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
        />
        {value.trim() && (
          <Button size="sm" onClick={handleSubmit} className="h-7 gap-1.5 px-2.5 text-xs">
            <Zap className="h-3 w-3" />
            Capture
          </Button>
        )}
        {!value && (
          <Tip content="Search everything (Ctrl+K)">
            <button
              type="button"
              className="hidden sm:inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted px-2 text-xs text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => {
                document.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
                );
              }}
            >
              <Search className="h-3 w-3" />
              <span className="hidden md:inline">Search</span>
            </button>
          </Tip>
        )}

        {/* Slash command autocomplete dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border bg-popover shadow-lg z-50">
            <p className="px-3 py-1.5 text-xs text-muted-foreground border-b">
              AI Skills — run in Claude Code or Cowork
            </p>
            {matchingSkills.map((skill) => (
              <button
                key={skill.command}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(skill.command);
                  setShowSuggestions(false);
                }}
              >
                <code className="text-xs font-mono text-primary">{skill.command}</code>
                <span className="text-xs text-muted-foreground">{skill.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Task search results dropdown */}
        {showTaskResults && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border bg-popover shadow-lg z-50">
            <p className="px-3 py-1.5 text-xs text-muted-foreground border-b flex items-center gap-1.5">
              <Search className="h-3 w-3" />
              Tasks matching &ldquo;{value.startsWith('?') ? value.slice(1).trim() : value.trim()}
              &rdquo;
            </p>
            {matchingTasks.map((task) => (
              <button
                key={task.id}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onTaskClick?.(task);
                  setValue('');
                }}
              >
                <div className={cn('h-2 w-2 rounded-full shrink-0', kanbanDot[task.kanban])} />
                <span className="text-sm truncate flex-1">{task.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {kanbanLabels[task.kanban]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Slash command notification */}
        {slashNotification && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50">
            <div className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-lg">
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs text-popover-foreground">
                <code className="font-mono text-primary">{slashNotification}</code> is a Claude Code
                command. Open Claude Code and type it there.
              </p>
              <button
                onClick={() => setSlashNotification(null)}
                className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The machine heartbeat — rightmost in the bar (UX-REDESIGN §16). */}
      <Heartbeat />

      <UseEverywhereModal open={useEverywhereOpen} onOpenChange={setUseEverywhereOpen} />
    </header>
  );
}
