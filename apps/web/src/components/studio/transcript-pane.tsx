'use client';

/**
 * The turn transcript — the conversation half of the composer column.
 *
 * Before this the studio session iterated the agent stream and kept only
 * `turn_done` (`apps/daemon/src/studio/session.ts`): the designer's prose, its
 * thinking and every tool call were discarded, so the user typed a prompt into
 * a void and watched files appear with no account of why. This renders what
 * the daemon now records — prose, collapsed thinking, compact tool cards, and
 * the files a turn produced, each of which focuses that screen on the canvas.
 *
 * Newest at the bottom, and the scroll sticks there *unless the user has
 * scrolled up* — reading back through an earlier turn must not be yanked away
 * by the next chunk of streaming text.
 */

import { Button } from '@/components/ui/button';
import { showError } from '@/lib/toast';
import type {
  DesignTranscriptEntry,
  DesignTranscriptMessage,
  DesignTranscriptToolPart,
} from '@ligma/api';
import {
  Brain,
  Check,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  RotateCcw,
  Search,
  Sliders,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  filesProduced,
  foldTranscript,
  messageCopyText,
  toolParts,
  userPromptFor,
} from './transcript';

/** How close to the bottom still counts as "at the bottom" (px). */
const STICK_SLACK = 48;

const TOOL_ICON: Record<string, typeof FileText> = {
  write_file: FileText,
  read_file: Search,
  list_files: FolderOpen,
  declare_tweak_schema: Sliders,
};

function ToolCard({ part }: { part: DesignTranscriptToolPart }) {
  const Icon = TOOL_ICON[part.toolName] ?? FileText;
  return (
    <li className="flex items-center gap-1.5 rounded border bg-muted/40 px-1.5 py-1 font-mono text-[10px]">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-muted-foreground">{part.toolName}</span>
      {part.summary ? (
        <span className="truncate" title={part.summary}>
          {part.summary}
        </span>
      ) : null}
      <span className="ml-auto shrink-0">
        {part.status === 'running' ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="running" />
        ) : part.status === 'ok' ? (
          <Check className="h-3 w-3 text-green-600" aria-label="ok" />
        ) : (
          <X className="h-3 w-3 text-destructive" aria-label="failed" />
        )}
      </span>
    </li>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-dashed">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-1.5 py-1 text-left text-[10px] text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <Brain className="h-3 w-3" aria-hidden />
        Thinking
      </button>
      {open ? (
        <p className="whitespace-pre-wrap px-2 pb-1.5 text-[11px] text-muted-foreground">{text}</p>
      ) : null}
    </div>
  );
}

function Message({
  message,
  streaming,
  onOpenFile,
  onRetry,
}: {
  message: DesignTranscriptMessage;
  /** This is the tail of an in-flight turn — the caret belongs on its last block. */
  streaming: boolean;
  onOpenFile: (path: string) => void;
  onRetry: (() => void) | null;
}) {
  const [copied, setCopied] = useState(false);
  const files = filesProduced(message);
  const tools = toolParts(message);
  const lastProse = message.parts.map((p) => p.kind).lastIndexOf('text');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(messageCopyText(message));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not copy this message');
    }
  };

  return (
    <div
      className={`group space-y-1.5 rounded-md p-2 ${message.role === 'user' ? 'bg-muted/60' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {message.role === 'user' ? 'You' : 'Designer'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Copy message"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
        </Button>
      </div>

      {message.parts.map((part, i) => {
        if (part.kind === 'text') {
          return (
            <p key={i} className="whitespace-pre-wrap text-xs leading-relaxed">
              {part.text}
              {part.truncated ? <span className="text-muted-foreground"> (truncated)</span> : null}
              {streaming && i === lastProse ? (
                <span
                  className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground align-middle"
                  aria-hidden
                />
              ) : null}
            </p>
          );
        }
        if (part.kind === 'thinking') return <Thinking key={i} text={part.text} />;
        // The reference images that came with this prompt, by name. The bytes
        // are not re-rendered here — the composer showed them while you
        // composed, and the transcript is a log, not a gallery.
        if (part.kind === 'attachments') {
          return (
            <p key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{part.names.join(', ')}</span>
            </p>
          );
        }
        return null;
      })}

      {tools.length > 0 ? (
        <ul className="space-y-0.5">
          {tools.map((part) => (
            <ToolCard key={part.toolUseId} part={part} />
          ))}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <div className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground">
            {files.length} file{files.length === 1 ? '' : 's'} produced
          </p>
          {files.map((path) => (
            <button
              key={path}
              type="button"
              className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] underline underline-offset-2 hover:bg-muted"
              title={`Open ${path} on the canvas`}
              onClick={() => onOpenFile(path)}
            >
              {path}
            </button>
          ))}
        </div>
      ) : null}

      {/* A failed turn is a harness malfunction, never a verdict on the design
          — it says what broke and offers the one action that helps. */}
      {message.stopReason === 'error' ? (
        <div className="space-y-1 rounded border border-destructive/40 bg-destructive/5 p-1.5">
          <p className="text-[11px] text-destructive">{message.error ?? 'The turn errored'}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={onRetry}>
              <RotateCcw className="mr-1 h-3 w-3" aria-hidden />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {message.stopReason === 'aborted' ? (
        <p className="text-[11px] text-muted-foreground">Stopped.</p>
      ) : null}
    </div>
  );
}

export interface TranscriptPaneProps {
  entries: DesignTranscriptEntry[];
  /** A turn is running — the tail message gets the caret. */
  busy: boolean;
  /** Clicking a produced file focuses that screen on the canvas. */
  onOpenFile: (path: string) => void;
  /** Re-sends a failed turn's prompt through the normal turn path. */
  onRetry: (prompt: string) => void;
}

export function TranscriptPane({ entries, busy, onOpenFile, onRetry }: TranscriptPaneProps) {
  const messages = foldTranscript(entries);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  // Before paint, so a streaming chunk never shows the old scroll position for
  // a frame. `useLayoutEffect` is safe here: this component only renders client
  // side (the whole studio surface is "use client" and data-driven).
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stuck.current) node.scrollTop = node.scrollHeight;
  }, [entries]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onScroll = (): void => {
      stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_SLACK;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 py-2"
      aria-label="Turn transcript"
    >
      {messages.map((message, i) => (
        <Message
          key={`${message.turnId}:${message.role}`}
          message={message}
          streaming={busy && i === messages.length - 1 && message.role === 'designer'}
          onOpenFile={onOpenFile}
          onRetry={
            message.stopReason === 'error' && userPromptFor(messages, message.turnId) !== null
              ? () => onRetry(userPromptFor(messages, message.turnId)!)
              : null
          }
        />
      ))}
      {/* A turn accepted but not yet speaking: the user's message is on screen
          and nothing has come back, so say which state that is. */}
      {busy && messages.at(-1)?.role === 'user' ? (
        <p className="px-2 text-[11px] text-muted-foreground">Designing…</p>
      ) : null}
    </div>
  );
}
