'use client';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { CheckCircle2, Trash2, X } from 'lucide-react';
import { useState } from 'react';

interface BulkActionBarProps {
  count: number;
  onMarkDone: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onMarkDone, onDelete, onClear }: BulkActionBarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
        <span className="text-sm font-medium tabular-nums">{count} selected</span>
        <div className="h-4 w-px bg-border" />
        <Tip content="Mark selected tasks as done">
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={onMarkDone}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark Done
          </Button>
        </Tip>
        <Tip content="Delete selected tasks">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-destructive hover:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </Tip>
        <div className="h-4 w-px bg-border" />
        <Tip content="Clear selection">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={`Delete ${count} task${count > 1 ? 's' : ''}?`}
        description="This action cannot be undone."
        confirmLabel="Delete All"
        variant="destructive"
        onConfirm={onDelete}
      />
    </>
  );
}
