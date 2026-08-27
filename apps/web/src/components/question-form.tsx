'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  type DiscoveryAnswers,
  type DiscoveryForm,
  type DiscoveryQuestion,
  YOU_DECIDE,
  isAnswered,
  missingRequired,
} from '@ligma/api';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useState } from 'react';

/**
 * Discovery rendered as a **form in the thread** (UX spec F1 step 2), which is
 * the whole point: a chat interrogation asks one thing at a time and loses the
 * answers in scrollback, while a form shows the shape of what is being asked and
 * lets the human answer out of order.
 *
 * Ported from open-design's `QuestionForm` down to the thirteen control types a
 * product question actually needs (D7 OD-033/OD-036): radios, a dropdown for
 * long choice lists, checkboxes, one-line and prose text, a number, and seven
 * low-cost native inputs — a slider, a date, a time, a url/email/tel and a
 * yes/no switch. `file`, `color` and `direction-cards` stay unported — each
 * needs a subsystem ligma doesn't have. Required gating names the missing
 * fields before submit, same rule as the composer.
 *
 * `previous`, when given, backs the ported step-back affordance (OD-036) — but
 * only as a **review**, not a re-answer: `applyAnswers` in
 * apps/daemon/src/engine/discovery.ts only accepts answers for the currently
 * open form (it throws "That form is no longer the open one" otherwise), so
 * there is no server-side path to edit a prior turn from *inside* the open
 * form. The "Back" control here just re-shows that turn's answers, read-only,
 * via the same `AnsweredTurn` the brief page renders for every past turn — the
 * brief page's own copy of `AnsweredTurn` is the one with `editable` turned on,
 * because editing an answered turn goes through `/brief/amend` instead
 * (build brief §16 Phase 2), a different route with a different consequence.
 */
export function QuestionFormCard({
  form,
  busy,
  onSubmit,
  previous,
}: {
  form: DiscoveryForm;
  busy: boolean;
  onSubmit: (answers: DiscoveryAnswers) => void;
  /** The most recently answered turn, if any — shown read-only behind "Back". */
  previous?: { form: DiscoveryForm; answers: DiscoveryAnswers };
}) {
  const [answers, setAnswers] = useState<DiscoveryAnswers>(() =>
    // A switch or a slider never has an "unanswered" state the way text does —
    // unchecked and mid-range are themselves real answers — so a required one
    // must not sit in `missingRequired` until touched. Seed it here instead.
    Object.fromEntries(
      form.questions
        .filter((q) => q.type === 'switch' || q.type === 'range')
        .map((q) => [q.id, q.type === 'switch' ? 'false' : '50']),
    ),
  );
  const [reviewingPrevious, setReviewingPrevious] = useState(false);
  const missing = missingRequired(form, answers);
  const requiredCount = form.questions.filter((q) => q.required).length;

  const set = (id: string, value: string | string[]) => setAnswers((a) => ({ ...a, [id]: value }));

  return (
    <form
      aria-label={form.title}
      className="rounded-lg border bg-card p-4 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        // Re-checked here because Enter can submit past a disabled button.
        if (missing.length > 0 || busy) return;
        onSubmit(answers);
      }}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{form.title}</h3>
        {form.description && <p className="text-xs text-muted-foreground">{form.description}</p>}
        {/* Persistent header while the form is open (UX spec §16 Phase 2) —
            not just a submit-time gate, so the thread always says how much of
            this exchange is still open. */}
        <p className="text-xs font-medium text-muted-foreground" role="status" aria-live="polite">
          {requiredCount > 0
            ? `Still needed: ${missing.length} of ${requiredCount}`
            : 'Ready to send.'}
        </p>
      </div>

      {previous && (
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setReviewingPrevious((v) => !v)}
          >
            {reviewingPrevious ? 'Hide previous answers' : '← Back — review previous answers'}
          </button>
          {reviewingPrevious && <AnsweredTurn form={previous.form} answers={previous.answers} />}
        </div>
      )}

      {form.questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label id={`q-${q.id}-label`} htmlFor={`q-${q.id}`}>
              {q.label}
              {q.required && (
                <span className="text-destructive ml-1" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <div className="flex items-center gap-2 shrink-0">
              {/* Leaving an optional field blank already "skips" it (missingRequired
                  only checks required ones) — this button just makes that discoverable
                  and clears a field the human started, then changed their mind on. A
                  switch/range always carries a real value, so neither gets one. */}
              {!q.required && q.type !== 'switch' && q.type !== 'range' && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => set(q.id, q.type === 'multi' ? [] : '')}
                >
                  Skip
                </button>
              )}
              {/* The other disposal, sitting beside Skip rather than replacing it:
                  Skip leaves an optional field blank, "You decide" delegates the
                  call to whoever builds this — including a *required* field a
                  human doesn't want to be the one to answer (build brief §16). */}
              {q.type !== 'switch' && q.type !== 'range' && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => set(q.id, q.type === 'multi' ? [YOU_DECIDE] : YOU_DECIDE)}
                >
                  You decide
                </button>
              )}
            </div>
          </div>
          {q.help && <p className="text-xs text-muted-foreground">{q.help}</p>}

          <QuestionInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
        </div>
      ))}

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={missing.length > 0 || busy} className="gap-1.5 shrink-0">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Answer
        </Button>
      </div>
    </form>
  );
}

function asText(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One question's control, factored out of `QuestionFormCard` so the exact same
 * markup renders both the open form and an answered turn's inline edit widget
 * (`AnsweredTurn` below) — the ten native/choice types share one implementation
 * either place they appear.
 */
function QuestionInput({
  question: q,
  value,
  onChange,
}: {
  question: DiscoveryQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const toggle = (option: string) => {
    const list = Array.isArray(value) ? value : [];
    onChange(list.includes(option) ? list.filter((o) => o !== option) : [...list, option]);
  };

  if (q.type === 'text') {
    return (
      <Input id={`q-${q.id}`} value={asText(value)} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (q.type === 'textarea') {
    return (
      <Textarea
        id={`q-${q.id}`}
        rows={3}
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === 'number') {
    // Native number input: the platform already owns steppers, the numeric
    // keyboard on touch and locale-correct parsing.
    return (
      <Input
        id={`q-${q.id}`}
        type="number"
        inputMode="decimal"
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (
    q.type === 'date' ||
    q.type === 'time' ||
    q.type === 'url' ||
    q.type === 'email' ||
    q.type === 'tel'
  ) {
    // Same reasoning as "number": the platform already validates the shape and
    // picks the right keyboard/picker for each of these.
    return (
      <Input
        id={`q-${q.id}`}
        type={q.type}
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (q.type === 'range') {
    return (
      <div className="flex items-center gap-3">
        <input
          id={`q-${q.id}`}
          type="range"
          className="w-full accent-primary"
          value={asText(value) || '50'}
          onChange={(e) => onChange(e.target.value)}
        />
        <output
          htmlFor={`q-${q.id}`}
          className="text-xs text-muted-foreground w-8 shrink-0 text-right"
        >
          {asText(value) || '50'}
        </output>
      </div>
    );
  }
  if (q.type === 'switch') {
    return (
      <Switch
        id={`q-${q.id}`}
        checked={value === 'true'}
        onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
      />
    );
  }
  if (q.type === 'select') {
    // The same answer shape as `single` — a dropdown is what a long option
    // list should look like, not a different kind of question.
    return (
      <Select value={asText(value)} onValueChange={onChange}>
        <SelectTrigger id={`q-${q.id}`} aria-labelledby={`q-${q.id}-label`} className="w-full">
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent>
          {q.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // `htmlFor` only names labelable elements, so a div-based group needs the
  // association spelled out or it reaches assistive tech unnamed.
  return (
    <div
      id={`q-${q.id}`}
      role={q.type === 'single' ? 'radiogroup' : 'group'}
      aria-labelledby={`q-${q.id}-label`}
      className="flex flex-wrap gap-1.5"
    >
      {q.options.map((option) => {
        const selected =
          q.type === 'single' ? value === option : Array.isArray(value) && value.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={q.type === 'single' ? 'radio' : 'checkbox'}
            aria-checked={selected}
            onClick={() => (q.type === 'single' ? onChange(option) : toggle(option))}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs text-left transition-colors',
              selected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The read-only rendering of a turn already answered — the thread's history.
 *
 * `editable` (with `onAmend`) turns each question into an edit affordance that
 * POSTs `/api/projects/:id/brief/amend` — the amend route, not `applyAnswers`,
 * because this turn is no longer the open form (build brief §16 Phase 2). The
 * brief page passes both; `QuestionFormCard`'s own read-only "Back" review
 * above does not, which is what keeps that one a review instead of a second
 * edit path into the same answer.
 */
export function AnsweredTurn({
  form,
  answers,
  editable = false,
  onAmend,
}: {
  form: DiscoveryForm;
  answers: DiscoveryAnswers;
  editable?: boolean;
  onAmend?: (
    questionId: string,
    answer: string | string[],
  ) => Promise<{ staleFlagged: boolean } | null>;
}) {
  const [liveAnswers, setLiveAnswers] = useState(answers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | string[]>('');
  const [busy, setBusy] = useState(false);
  // Session-local feedback only — the brief's turns carry no per-question
  // amendment history (this is a re-presentation, not a data-model change), so
  // "changed 3m ago" is honest about what just happened here and says nothing
  // about an edit from a previous visit.
  const [amended, setAmended] = useState<Record<string, { at: number; staleFlagged: boolean }>>({});

  async function save(questionId: string) {
    if (!onAmend) return;
    setBusy(true);
    try {
      const result = await onAmend(questionId, draft);
      if (result) {
        setLiveAnswers((a) => ({ ...a, [questionId]: draft }));
        setAmended((a) => ({
          ...a,
          [questionId]: { at: Date.now(), staleFlagged: result.staleFlagged },
        }));
        setEditingId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{form.title}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
        {form.questions.map((q) => {
          const isEditing = editingId === q.id;
          const note = amended[q.id];
          return (
            <div key={q.id} className="contents">
              <dt className="flex items-start gap-1.5 text-muted-foreground">
                {q.label}
                {editable && !isEditing && (
                  <button
                    type="button"
                    className="text-xs underline hover:text-foreground shrink-0"
                    onClick={() => {
                      setEditingId(q.id);
                      setDraft(liveAnswers[q.id] ?? '');
                    }}
                  >
                    Edit
                  </button>
                )}
              </dt>
              <dd className="space-y-1.5">
                {isEditing ? (
                  <div className="space-y-2">
                    <QuestionInput question={q} value={draft} onChange={setDraft} />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void save(q.id)}
                      >
                        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isAnswered(liveAnswers[q.id]) ? (
                      render(liveAnswers[q.id])
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {note && (
                      <p className="text-xs text-muted-foreground">
                        changed {formatRelativeTime(new Date(note.at).toISOString())}
                        {note.staleFlagged && (
                          <>
                            {' · '}This brief was locked — it is now flagged for review.{' '}
                            <Link href="/deck" className="underline">
                              See the decision
                            </Link>
                            .
                          </>
                        )}
                      </p>
                    )}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function render(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
}
