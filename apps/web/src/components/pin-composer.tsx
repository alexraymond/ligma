'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { type PinDisposition, compilePinInstructions } from '@ligma/api';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';

/**
 * Where the pin points. An image pin has coordinates; a record pin has a line or
 * a field, or neither when the whole record is the thing being pointed at.
 */
export type PinLocation =
  | { kind: 'image'; x: number; y: number }
  | { kind: 'record'; line: number | null; field: string | null };

/**
 * The half of a pin that is the same whatever was pointed at: the comment, what
 * it becomes, and **the preview of the exact instruction block the builder will
 * receive** — the ligma-classic defect this merger exists to fix, kept in one
 * place so the screenshot pinner and the record pinner cannot drift into
 * previewing different things.
 */
export function PinComposer({
  projectId,
  runId,
  evidencePath,
  taskId,
  location,
  onSaved,
  onCancel,
}: {
  projectId: string;
  runId: string;
  evidencePath: string;
  /** The task a `feedback` pin attaches to. Null on a journey run — no task to fix. */
  taskId: string | null;
  location: PinLocation;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  const [disposition, setDisposition] = useState<PinDisposition>(taskId ? 'feedback' : 'new-task');
  const [busy, setBusy] = useState(false);

  const trimmed = comment.trim();

  // Byte-for-byte the payload, not a resemblance: the same compile function the
  // daemon hands to the prompt builder.
  const preview = trimmed
    ? compilePinInstructions([
        {
          id: 'preview',
          projectId,
          runId,
          evidencePath,
          comment: trimmed,
          disposition,
          taskId,
          createdAt: '',
          ...location,
        },
      ])
    : '';

  async function save() {
    if (trimmed === '') return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/evidence-pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          evidencePath,
          ...location,
          comment: trimmed,
          disposition,
          ...(disposition === 'feedback' && taskId ? { taskId } : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'The pin could not be saved');
      showSuccess(
        disposition === 'feedback'
          ? "Pinned — it rides along on the fix task's next builder prompt"
          : 'Pinned — a task was created from it',
      );
      setComment('');
      onSaved();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <MessageSquarePlus className="h-3 w-3" /> What is wrong here?
      </p>
      <Textarea rows={2} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        <DispositionChip
          active={disposition === 'feedback'}
          disabled={!taskId}
          onClick={() => setDisposition('feedback')}
        >
          {taskId ? 'Feedback on the fix task' : 'Feedback (no task on this run)'}
        </DispositionChip>
        <DispositionChip
          active={disposition === 'new-task'}
          onClick={() => setDisposition('new-task')}
        >
          New task
        </DispositionChip>
      </div>
      {preview && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px]">
          {preview}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={busy || trimmed === ''}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Pin it
        </Button>
      </div>
    </div>
  );
}

function DispositionChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
