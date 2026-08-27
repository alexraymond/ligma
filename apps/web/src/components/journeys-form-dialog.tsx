'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Journey } from '@ligma/api';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type JourneyFormState,
  type JourneyPayload,
  addStep,
  buildJourneyPayload,
  emptyJourneyForm,
  isJourneyFormValid,
  removeStep,
} from './journeys-form';

function formFromJourney(journey: Journey): JourneyFormState {
  return {
    title: journey.title,
    goal: journey.goal,
    steps: journey.steps,
    tags: journey.tags.join(', '),
  };
}

interface JourneyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  journey?: Journey;
  /** The target repo's checkout path, so the file destination is honest, not guessed. */
  repoPath: string | null;
  onSubmit: (payload: JourneyPayload) => void;
}

/**
 * Create/edit dialog for one `.ligma/journeys/*.json` file.
 *
 * Origin is deliberately not a field here: the PATCH route only changes it
 * when the request body includes it, and this dialog never sends one, so
 * editing a discovery-proposed journey's title or steps leaves its origin
 * exactly as it was on disk.
 */
export function JourneyFormDialog({
  open,
  onOpenChange,
  journey,
  repoPath,
  onSubmit,
}: JourneyFormDialogProps) {
  const [form, setForm] = useState<JourneyFormState>(
    journey ? formFromJourney(journey) : emptyJourneyForm(),
  );
  const [stepDraft, setStepDraft] = useState('');

  useEffect(() => {
    if (open) {
      setForm(journey ? formFromJourney(journey) : emptyJourneyForm());
      setStepDraft('');
    }
  }, [open, journey]);

  const filePath = repoPath
    ? journey
      ? `${repoPath}/.ligma/journeys/${journey.id}.json`
      : `${repoPath}/.ligma/journeys/`
    : null;

  const commitStep = () => {
    setForm((prev) => ({ ...prev, steps: addStep(prev.steps, stepDraft) }));
    setStepDraft('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isJourneyFormValid(form)) return;
    onSubmit(buildJourneyPayload(form));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{journey ? 'Edit journey' : 'New journey'}</DialogTitle>
          <DialogDescription>
            {filePath ? (
              <>
                Saved to <code className="text-[11px]">{filePath}</code>
              </>
            ) : (
              'Adopt a repo first — journeys live in its .ligma/journeys/ directory.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="journey-title">Title</Label>
            <Input
              id="journey-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Guest checkout"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="journey-goal">Goal</Label>
            <Textarea
              id="journey-goal"
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="What is the persona trying to achieve? e.g. buy one item without creating an account"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              A journey is a goal a persona optimizes for, not a click script — the steps below are
              hints for how they might get there, but the goal is the contract a run is judged
              against.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Steps</Label>
            {form.steps.length > 0 && (
              <div className="space-y-1 rounded-lg border bg-muted/30 p-2">
                {form.steps.map((step, i) => (
                  <div key={`${i}-${step}`} className="flex items-center gap-2 group">
                    <span className="flex-1 text-xs">{step}</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, steps: removeStep(form.steps, i) })}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      aria-label={`Remove step ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={stepDraft}
                onChange={(e) => setStepDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitStep();
                  }
                }}
                placeholder="Add a step hint..."
                className="flex-1 h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={commitStep}
                disabled={!stepDraft.trim()}
                className="h-8 px-2"
                aria-label="Add step"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="journey-tags">Tags (comma-separated)</Label>
            <Input
              id="journey-tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="checkout, growth..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isJourneyFormValid(form)}>
              {journey ? 'Save changes' : 'Create journey'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
