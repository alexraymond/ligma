'use client';

/**
 * Staged pins as chips above the composer, and the apply-preview that fixes
 * ligma-classic's opacity.
 *
 * Ported from `CommentChipBar.tsx` (studio map §2) — same row of chips, same
 * "Apply (N)" batch, same click-a-chip-to-edit and ×-to-drop. One thing is
 * deliberately different, and it is the entire point of UX spec F4:
 *
 *   > comment "Apply" is an invisible batch re-generation with no preview of
 *   > what's being sent  (§2, ligma-classic's weaknesses)
 *   > **"Apply (N)" shows a preview of the compiled instruction block before
 *   > sending**  (F4)
 *
 * So Apply opens a dialog first. The text in it is not a rendering of the
 * payload — the daemon compiles it with the very function the turn calls
 * (`buildInstructionPreview` / `compilePinInstruction`), so what the user reads
 * is byte-for-byte what goes on the wire. A preview that merely resembles the
 * payload would reproduce the defect it exists to fix.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CompiledInstructionPreview, DesignPin, DesignSnapshotSummary } from '@ligma/api';
import { MessageSquareText, Send, X } from 'lucide-react';
import { useState } from 'react';
import { pinAppliedIn, stagedPins } from './api';

export interface PinChipsProps {
  pins: DesignPin[];
  snapshots: DesignSnapshotSummary[];
  disabled?: boolean;
  onEditPin: (pin: DesignPin) => void;
  onRemovePin: (pin: DesignPin) => void;
  /** Fetches the compiled instruction the apply-turn would send. */
  onRequestPreview: () => Promise<CompiledInstructionPreview>;
  onApply: () => void;
}

export function PinChips({
  pins,
  snapshots,
  disabled,
  onEditPin,
  onRemovePin,
  onRequestPreview,
  onApply,
}: PinChipsProps) {
  const [preview, setPreview] = useState<CompiledInstructionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const staged = stagedPins(pins);
  const applied = pins.filter((pin) => pin.status === 'applied');

  const openPreview = async (): Promise<void> => {
    setOpen(true);
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await onRequestPreview());
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-1.5">
      {staged.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ul aria-label="Staged pins" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {staged.map((pin) => (
              <li
                key={pin.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/60 bg-background py-0.5 pl-2 pr-1 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onEditPin(pin)}
                  title={pin.text}
                  className="inline-flex min-w-0 items-center gap-1"
                >
                  <MessageSquareText className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                  <span className="max-w-[180px] truncate">{pin.text}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemovePin(pin)}
                  aria-label={`Remove pin: ${pin.text}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" disabled={disabled} onClick={() => void openPreview()}>
            <Send className="mr-1.5 h-3 w-3" aria-hidden />
            Apply ({staged.length})
          </Button>
        </div>
      ) : null}

      {applied.length > 0 ? (
        <ul aria-label="Applied pins" className="flex flex-wrap gap-1.5">
          {applied.map((pin) => {
            const version = pinAppliedIn(pin, snapshots);
            return (
              <li
                key={pin.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed py-0.5 pl-2 pr-2 text-[11px] text-muted-foreground"
                title={pin.text}
              >
                <span className="max-w-[160px] truncate line-through">{pin.text}</span>
                {/* No dead ends (principle 3): an applied pin names the turn that applied it. */}
                <span className="font-mono">{version ? `v${version.n}` : 'applied'}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>This is what will be sent</DialogTitle>
            <DialogDescription>
              The exact instruction the apply-turn transmits — compiled by the daemon with the same
              function the turn calls, not a summary of it.
            </DialogDescription>
          </DialogHeader>

          {previewError ? (
            <p className="text-sm text-destructive">
              Could not compile the preview: {previewError}
            </p>
          ) : preview === null ? (
            <p className="text-sm text-muted-foreground">Compiling…</p>
          ) : (
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {preview.instruction}
            </pre>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={preview === null || disabled}
              onClick={() => {
                setOpen(false);
                onApply();
              }}
            >
              Send {staged.length} edit{staged.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
