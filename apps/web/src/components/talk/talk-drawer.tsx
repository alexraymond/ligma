'use client';

/**
 * Talk — the one human→system channel (UX spec §10), as a right-hand drawer
 * available in every stage of a project and toggled with ⌘J.
 *
 * The rule the spec states: forms for structure, conversation for everything
 * else, and every conversation outcome must land in a structured object. So the
 * drawer does exactly two things beyond showing the thread — it addresses a
 * message (`@researcher …`, matched against the real registry) and it offers
 * "Remember this" on the human's own messages, which writes the note into
 * `.ligma/project.md` → Quirks, the store planning actually injects. The button
 * says where it lands, because a promise with an invisible destination is how
 * people stop trusting a feature.
 *
 * The reply is not awaited: POST returns the human's message, the respond pass
 * appends its own turn, and the poll below picks it up. A governor deny arrives
 * as a system message saying why — never as silence.
 */

import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAgents } from '@/hooks/use-data';
import { apiFetch } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useCollection } from '@/providers/collections-provider';
import { AGENT_ROLES, type TalkMessage, talkChipHref } from '@ligma/api';
import { MessageSquare, Send, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { addressLabel, parseTalkAddress, talkRoleIds } from './talk-address';

/** Fast enough that a reply feels like an answer, slow enough to be a drawer, not a socket. */
const POLL_MS = 4_000;

function authorLabel(author: string): string {
  if (author === 'you') return 'You';
  if (author === 'system') return 'Ligma';
  return author;
}

function TalkChips({ message, projectId }: { message: TalkMessage; projectId: string }) {
  if (!message.chips || message.chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.chips.map((chip) => (
        <Link key={`${chip.kind}:${chip.id}`} href={talkChipHref(chip, projectId)}>
          <Badge variant="outline" className="cursor-pointer text-xs font-normal hover:bg-accent">
            <span className="mr-1 uppercase tracking-wide opacity-60">{chip.kind}</span>
            <span className="truncate max-w-[16rem]">{chip.label ?? chip.id}</span>
          </Badge>
        </Link>
      ))}
    </div>
  );
}

export function TalkDrawer({
  projectId,
  open,
  onClose,
}: { projectId: string; open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** Shown immediately so typing feels answered; replaced by the server's copy on the next read. */
  const [pending, setPending] = useState<TalkMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const url = `/api/projects/${encodeURIComponent(projectId)}/talk`;
  const fetcher = useCallback(async (): Promise<TalkMessage[]> => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`Failed to load the thread (${res.status})`);
    return ((await res.json()) as { messages?: TalkMessage[] }).messages ?? [];
  }, [url]);

  // Only polls while the drawer is open — a closed drawer is not a subscription.
  const { data, loading, error, refetch } = useCollection<TalkMessage[]>(
    url,
    fetcher,
    open ? POLL_MS : undefined,
  );
  const messages = data ?? [];

  const { agents } = useAgents();
  const roleIds = talkRoleIds(AGENT_ROLES, agents);
  const address = parseTalkAddress(draft, roleIds);

  const serverIds = new Set(messages.map((m) => m.id));
  const thread = [...messages, ...pending.filter((m) => !serverIds.has(m.id))];

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread.length]);

  async function send() {
    if (address.body.trim() === '' || sending) return;
    const optimistic: TalkMessage = {
      id: `pending_${Date.now()}`,
      author: 'you',
      body: address.body,
      createdAt: new Date().toISOString(),
    };
    setPending((p) => [...p, optimistic]);
    setDraft('');
    setSending(true);
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: address.body, to: address.to }),
      });
      if (!res.ok) {
        throw new Error(
          ((await res.json().catch(() => ({}))) as { error?: string }).error ??
            `Send failed (${res.status})`,
        );
      }
      setPending((p) => p.filter((m) => m.id !== optimistic.id));
      await refetch();
    } catch (err) {
      setPending((p) => p.filter((m) => m.id !== optimistic.id));
      setDraft(draft);
      toast.error(err instanceof Error ? err.message : "Couldn't send that message");
    } finally {
      setSending(false);
    }
  }

  async function remember(message: TalkMessage) {
    try {
      const res = await apiFetch(`${url}/remember`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: message.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Couldn't remember that (${res.status})`);
      toast.success('Saved to .ligma/project.md → Quirks');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remember that");
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 cursor-pointer bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Talk"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-full flex-col border-l bg-card shadow-2xl outline-none animate-in slide-in-from-right duration-200 md:max-w-md"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Talk</h2>
            <Badge variant="outline" className="text-[10px] font-normal">
              ⌘J
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close Talk">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {error ? (
            <ErrorState
              title="Couldn't load this conversation"
              detail={error}
              onRetry={refetch}
              variant="compact"
            />
          ) : loading && thread.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading the thread…</p>
          ) : thread.length === 0 ? (
            // Honest, not blank: an empty thread is a real state with a real
            // explanation, and the two things this channel can do are the copy.
            <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nothing said yet.</p>
              <p>
                This is where you talk to this project. Ask what a run did, say what changed your
                mind, or point at something that looks wrong — answers come back citing the tasks,
                runs, verdicts and designs they are about, and each one is a link.
              </p>
              <p>
                Start with <code className="rounded bg-muted px-1">@</code> to address a crew member
                directly; without one, the system answers.
              </p>
            </div>
          ) : (
            thread.map((message) => (
              <div key={message.id} className="group space-y-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      message.author === 'you' ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {authorLabel(message.author)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(message.createdAt)}
                  </span>
                  {message.author === 'you' && !message.id.startsWith('pending_') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 gap-1 px-2 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      title="Save this to .ligma/project.md → Quirks, where planning reads it"
                      onClick={() => remember(message)}
                    >
                      <Sparkles className="h-3 w-3" />
                      Remember this
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                <TalkChips message={message} projectId={projectId} />
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="space-y-2 border-t px-4 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask, or say what changed. @role to address someone."
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              Goes to{' '}
              <span className="font-medium text-foreground">{addressLabel(address.to)}</span> ·
              Enter sends
            </span>
            <Button
              size="sm"
              disabled={sending || address.body.trim() === ''}
              onClick={() => void send()}
            >
              <Send className="mr-1 h-3 w-3" />
              Send
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * The ⌘J listener and the button that opens the drawer, mounted once per
 * project layout. Same shape as `search-dialog.tsx`'s ⌘K and
 * `project-switcher.tsx`'s ⌘P — each shortcut owns its own listener — with one
 * addition those two want too: a chord typed into a text field is text, not a
 * command, so focus in an input/textarea/contenteditable is left alone.
 */
export function TalkLauncher({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // `?talk=1` opens the drawer on arrival (W15) — the palette's "Talk —
  // <project>" command used to just navigate to the project, landing the user
  // on the page with no drawer open and a second ⌘J still required.
  useEffect(() => {
    if (searchParams.get('talk') !== '1') return;
    setOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('talk');
    const qs = next.toString();
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    // Only on arrival — re-running this on every searchParams change would
    // re-open a drawer the user just closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function isEditing(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el?.tagName) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !isEditing(e.target)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        title="Talk about this project (⌘J)"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Talk
      </Button>
      <TalkDrawer projectId={projectId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
