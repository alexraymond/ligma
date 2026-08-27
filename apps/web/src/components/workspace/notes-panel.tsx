'use client';

/**
 * NotesPanel — the project's scratch-notes thread (OD-134, "side-chat" v1).
 *
 * Honest scope call: this repo has no conversational machinery a lightweight
 * per-project chat could sit on top of (grepped `inbox/respond` and every
 * chat-shaped route — `inbox` is task-delegation messaging between agents,
 * not free-form chat, and there is no LLM-backed conversation engine at all
 * to port `SideChatTab` onto). Building one just to back a side panel would
 * repeat the tab-registry mistake this wave's brief explicitly rejected:
 * infrastructure nobody asked for, load-bearing for one screen. So this is a
 * notes-with-thread-shape panel, not a chat: entries render as a vertical
 * thread (so it *reads* like the reference's chat pane), but every entry has
 * the same author and there is no reply, no streaming, no assistant turn — it
 * is a scratch pad that remembers order and timestamps, and says so in its
 * empty state.
 */

import { ErrorState } from '@/components/error-state';
import { WidgetSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { showError } from '@/lib/toast';
import { useCallback, useEffect, useState } from 'react';
import { type NoteMessage, addNote, listNotes } from './workspace-api';

/** `Intl` does the locale work; this just picks the one format the thread uses. */
export function formatNoteTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function NotesPanel({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<NoteMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await listNotes(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      setNotes(await addNote(projectId, body));
      setDraft('');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (notes === null) return <WidgetSkeleton rows={3} />;

  return (
    <div className="flex h-full min-h-[24rem] flex-col rounded-md border" data-testid="notes-panel">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        Scratch notes for this project — a running thread, not a conversation: nothing here answers
        back.
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing jotted down yet.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded-md bg-muted/50 p-2 text-sm">
              <p className="whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatNoteTimestamp(note.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Jot something down…"
          rows={2}
          disabled={busy}
          className="flex-1 resize-none text-sm"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
