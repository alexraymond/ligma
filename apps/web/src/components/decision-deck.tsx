'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UndoToast } from '@/components/undo-toast';
import { type DeckCard, RUN_BLOCKED_CAUSE_LABELS, deckCardLabel } from '@/hooks/use-deck-sources';
import { type SwipeDirection, useSwipe } from '@/hooks/use-swipe';
import { applyCardOption, navigationFor } from '@/lib/deck-actions';
import { showError } from '@/lib/toast';
import { patchDecision, undoDecision } from '@/lib/undo';
import { AGENT_ROLES, type Task } from '@ligma/api';
import { BATCH_THRESHOLD, type DeckAction, UNDO_WINDOW_MS } from '@ligma/api';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock,
  ListChecks,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

/**
 * The Deck: one attention queue for everything that needs the human (UX spec
 * §6, F3).
 *
 * It used to hold decisions alone. It now holds decisions, design approvals,
 * stale briefs, adoption reviews and verdict spot-checks — one stack, one set of
 * gestures, one undo. Widening it rather than growing a second queue is the
 * whole point: "what needs me?" has to keep having a single answer.
 *
 * **The card is the context** (§8.4): every kind carries its evidence inline, so
 * answering does not navigate. The one exception is marked `opensSheet` — an
 * adoption review is a real multi-field form, and pretending a card could carry
 * it would be a worse lie than a link.
 */
interface DecisionDeckProps {
  /** The whole queue; the deck filters what this session already disposed of. */
  cards: DeckCard[];
  tasks: Task[];
  /** Refetch, so the rest of the page agrees with the server. */
  onApplied: () => Promise<void> | void;
  /**
   * The undo deadline the server just granted, reported up so the Answered list
   * offers the same window as the toast. Answering here and taking it back over
   * there is one journey, not two, and the two views must not disagree about how
   * long is left.
   */
  onUndoWindow?: (decisionId: string, expiresAt: number | null) => void;
  /** Switch the page to list mode (batch review). */
  onOpenList: () => void;
  /** Resolves a card's project for the attribution badge — "Workspace" for null. */
  projectName: (id: string | null) => string;
}

const SWIPE_ACTIONS: Partial<Record<SwipeDirection, DeckAction>> = {
  left: 'dismiss',
  up: 'urgent',
  down: 'defer',
};

const ACTION_LABELS: Record<DeckAction, string> = {
  answer: 'Answered',
  dismiss: 'Dismissed',
  urgent: 'Flagged urgent',
  defer: 'Deferred 7 days',
};

const EXIT_TRANSFORMS: Record<DeckAction, string> = {
  answer: 'scale(0.96)',
  dismiss: 'translateX(-40%) rotate(-8deg)',
  urgent: 'translateY(-25%) scale(1.02)',
  defer: 'translateY(25%) scale(0.96)',
};

const HINTS: Record<SwipeDirection, string> = {
  left: 'DISMISS',
  right: 'TAP AN OPTION TO ANSWER',
  up: 'URGENT',
  down: 'DEFER 7 DAYS',
};

function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown age';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m old`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.round(hours / 24)}d old`;
}

/** Nothing in the app deep-links a single task, so point at the board that shows it. */
function taskHref(task: Task): string {
  if (task.projectId) return `/projects/${task.projectId}`;
  if (task.assignedTo) return `/team/${task.assignedTo}`;
  return '/board/matrix';
}

export function DecisionDeck({
  cards,
  tasks,
  onApplied,
  onOpenList,
  onUndoWindow,
  projectName,
}: DecisionDeckProps) {
  const router = useRouter();
  // Cards this session has disposed of. Kept locally so the head swaps the
  // instant the server confirms, without waiting for the refetch to land.
  const [acted, setActed] = useState<ReadonlySet<string>>(new Set());
  const [exiting, setExiting] = useState<DeckAction | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lastAction, setLastAction] = useState<{
    id: string;
    label: string;
    question: string;
    undo: (() => Promise<void>) | null;
    /** Epoch ms. For a decision this is the server's deadline, verbatim. */
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Synchronous twin of `busy`: state updates are async, and a held arrow key
  // would otherwise fire several times before the first render.
  const busyRef = useRef(false);
  const deckRef = useRef<HTMLDivElement>(null);

  const deck = useMemo(() => cards.filter((c) => !acted.has(c.id)), [cards, acted]);
  const card = deck[0];

  const finish = (
    id: string,
    label: string,
    question: string,
    undo: (() => Promise<void>) | null,
    expiresAt: number,
  ) => {
    setActed((prev) => new Set(prev).add(id));
    setExpanded(false);
    setLastAction({ id, label, question, undo, expiresAt });
  };

  /** The four dispositions — decisions only; they are what the deck journal knows. */
  const apply = async (action: DeckAction, answer?: string) => {
    if (busyRef.current || !card || card.decision === null) return;
    const decision = card.decision;
    busyRef.current = true;
    setBusy(true);
    setLastAction(null);
    setExiting(action);
    try {
      const { undoExpiresAt } = await patchDecision({ id: decision.id, action, answer });
      onUndoWindow?.(decision.id, undoExpiresAt);
      // Only now does the card leave the deck. A failed call throws and the same
      // card stays put. No server window means no undo offer, rather than a
      // button the server would refuse.
      finish(
        card.id,
        ACTION_LABELS[action],
        decision.question,
        undoExpiresAt === null ? null : () => takeBack(decision.id, card.id),
        undoExpiresAt ?? 0,
      );
      await onApplied();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save that decision');
    } finally {
      setExiting(null);
      busyRef.current = false;
      setBusy(false);
      deckRef.current?.focus();
    }
  };

  const takeBack = async (decisionId: string, cardId: string) => {
    await undoDecision(decisionId);
    unact(cardId);
  };

  const unact = (cardId: string) => {
    setActed((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  };

  /**
   * The widened kinds. Each answer hits the endpoint that already owns the
   * thing — no new "deck actions" table, because a design approval *is* an
   * approval and a stale acknowledgement *is* a brief edit.
   */
  const answerCard = async (option: string) => {
    if (busyRef.current || !card || card.kind === 'decision') return;
    // The one card whose answer is a destination — see `navigationFor`.
    const destination = navigationFor(card, option);
    if (destination) {
      router.push(destination);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setLastAction(null);
    setExiting('answer');
    try {
      const outcome = await applyCardOption(card, option);
      // These undos are local or endpoint-specific and open no server journal, so
      // the toast's own life *is* their window — same length, honestly stated.
      if (outcome) {
        const reverse = outcome.undo;
        finish(
          card.id,
          outcome.label,
          card.title,
          reverse === null
            ? null
            : async () => {
                await reverse();
                unact(card.id);
              },
          Date.now() + UNDO_WINDOW_MS,
        );
      }
      await onApplied();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not apply that');
    } finally {
      setExiting(null);
      busyRef.current = false;
      setBusy(false);
      deckRef.current?.focus();
    }
  };

  /** Move past a card without answering it. Local only — it returns on reload. */
  const skip = () => {
    if (!card || busyRef.current) return;
    setActed((prev) => new Set(prev).add(card.id));
    setLastAction({
      id: card.id,
      label: 'Skipped',
      question: card.title,
      undo: async () => unact(card.id),
      expiresAt: Date.now() + UNDO_WINDOW_MS,
    });
  };

  const { offsetX, offsetY, direction, handlers } = useSwipe({
    disabled: busy,
    onSwipe: (dir) => {
      const action = SWIPE_ACTIONS[dir];
      if (!action) return;
      if (card?.kind === 'decision') void apply(action);
      else if (action === 'dismiss') skip();
    },
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    // e.repeat: a held arrow must dispose of one card, not the whole deck.
    if (e.repeat || busyRef.current) return;
    const action =
      e.key === 'ArrowLeft'
        ? 'dismiss'
        : e.key === 'ArrowUp'
          ? 'urgent'
          : e.key === 'ArrowDown'
            ? 'defer'
            : null;
    if (!action) return; // Enter on a focused option button answers natively.
    e.preventDefault();
    if (card?.kind === 'decision') void apply(action);
    else if (action === 'dismiss') skip();
  };

  const cardStyle: React.CSSProperties = exiting
    ? {
        transform: EXIT_TRANSFORMS[exiting],
        opacity: 0.35,
        transition: 'transform 150ms ease-out, opacity 150ms ease-out',
      }
    : offsetX !== 0 || offsetY !== 0
      ? {
          transform: `translate(${offsetX}px, ${offsetY}px) rotate(${offsetX * 0.04}deg)`,
          transition: 'none',
        }
      : { transition: 'transform 200ms ease-out' };

  const decision = card?.decision ?? null;
  const requestor = decision
    ? decision.requestedBy === 'system'
      ? 'System'
      : (AGENT_ROLES.find((r) => r.id === decision.requestedBy)?.label ?? decision.requestedBy)
    : 'Ligma';
  const RequestorIcon = !decision || decision.requestedBy === 'system' ? Bot : User;
  const linkedTask = decision?.taskId ? tasks.find((t) => t.id === decision.taskId) : undefined;

  return (
    <div
      ref={deckRef}
      onKeyDown={onKeyDown}
      data-testid="decision-deck"
      className="space-y-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {deck.length >= BATCH_THRESHOLD && (
        <div
          data-testid="batch-banner"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <p className="flex-1 text-sm">
            <span className="font-semibold">{deck.length} cards</span> are waiting. One at a time
            will take a while — review the decisions together instead.
          </p>
          <Button size="sm" onClick={onOpenList}>
            Batch review
          </Button>
        </div>
      )}

      {!card ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-400" />
          <p className="text-sm font-semibold">Deck clear</p>
          <p className="text-xs text-muted-foreground">Nothing is waiting on you right now.</p>
          <Button size="sm" variant="outline" onClick={onOpenList}>
            Open list view
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{deck.length} to review</span>
            <span className="hidden sm:inline">
              {card.kind === 'decision'
                ? '← Dismiss · ↑ Urgent · ↓ Defer · Tab + Enter to answer'
                : '← Skip · Tab + Enter to answer'}
            </span>
          </div>

          <div className="relative select-none touch-none" {...handlers}>
            {/* Stack hint — no content bleed, just depth. */}
            {deck[1] && (
              <div className="absolute inset-x-2 -bottom-2 top-3 rounded-xl border border-border bg-card opacity-40" />
            )}
            {deck[2] && (
              <div className="absolute inset-x-4 -bottom-4 top-5 rounded-xl border border-border bg-card opacity-20" />
            )}

            <Card className="relative border-yellow-500/30 bg-yellow-500/5" style={cardStyle}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/20">
                    <RequestorIcon className="h-4 w-4 text-yellow-400" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p
                      className="line-clamp-2 break-words text-base font-semibold leading-snug"
                      title={card.title}
                    >
                      {card.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">
                        {projectName(card.projectId)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {deckCardLabel(card)}
                      </Badge>
                      {card.kind === 'run-blocked' && card.causeKind && (
                        // Amber, not destructive — the "error ≠ failed" rule
                        // (failure/classify.ts): env/backend blockage is
                        // harness trouble, not a verdict on the work.
                        <Badge
                          variant="outline"
                          className="border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-500"
                        >
                          {RUN_BLOCKED_CAUSE_LABELS[card.causeKind]}
                        </Badge>
                      )}
                      {decision && <span>Asked by {requestor}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatAge(card.createdAt)}
                      </span>
                      {decision && (
                        <Badge
                          variant={decision.blocksTask === true ? 'destructive' : 'outline'}
                          className="text-[10px]"
                        >
                          {decision.blocksTask === false ? 'Non-blocking' : 'Blocks task'}
                        </Badge>
                      )}
                      {(decision?.deferCount ?? 0) > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          Deferred ×{decision?.deferCount}
                        </Badge>
                      )}
                    </div>
                    {linkedTask && (
                      <p className="text-xs text-muted-foreground">
                        Task:{' '}
                        <Link
                          href={taskHref(linkedTask)}
                          className="text-foreground underline underline-offset-2"
                        >
                          {linkedTask.title}
                        </Link>
                      </p>
                    )}
                  </div>
                </div>

                {card.context && (
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p
                      className={`text-xs text-muted-foreground ${expanded ? '' : 'line-clamp-3'}`}
                    >
                      {card.context}
                    </p>
                    {card.context.length > 220 && (
                      <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="mt-1 text-xs font-medium text-primary hover:underline"
                      >
                        {expanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                )}

                {/* The evidence, inline — this is what makes navigating optional. */}
                {card.evidence?.criterion && (
                  <blockquote className="rounded-md border-l-2 border-primary/50 bg-background/60 px-3 py-2 text-xs">
                    {card.kind === 'verdict-spot-check' && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Criterion under review
                      </p>
                    )}
                    <p>{card.evidence.criterion}</p>
                    {card.evidence.ruling && (
                      <p className="mt-2 border-t border-border/60 pt-2 text-muted-foreground">
                        <span className="font-semibold text-foreground">The judge said</span> —{' '}
                        {card.evidence.ruling}
                      </p>
                    )}
                  </blockquote>
                )}
                {card.evidence?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.evidence.imageUrl}
                    alt={`Inline evidence for: ${card.title}`}
                    className="max-h-64 w-full rounded-md border object-contain bg-muted"
                  />
                )}
                {card.evidence?.facts && card.evidence.facts.length > 0 && (
                  <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[minmax(0,9rem)_1fr]">
                    {card.evidence.facts.map((fact) => (
                      <div key={fact.label} className="contents">
                        <dt className="text-muted-foreground">{fact.label}</dt>
                        <dd className="truncate">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {card.options.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {card.options.map((opt) => (
                      <Button
                        key={opt}
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          card.kind === 'decision'
                            ? void apply('answer', opt)
                            : void answerCard(opt)
                        }
                        className="h-auto max-w-full justify-start whitespace-normal break-words py-2 text-left text-xs"
                      >
                        {opt}
                      </Button>
                    ))}
                  </div>
                )}

                <Link
                  href={card.href}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {card.opensSheet ? 'Open the review sheet' : 'See where this came from'}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>

            {direction && (
              <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 text-sm font-bold tracking-wide text-foreground">
                {HINTS[direction]}
              </div>
            )}
          </div>

          {/* Same dispositions, for pointers that would rather click. */}
          <div className="flex flex-wrap justify-center gap-2">
            {card.kind === 'decision' ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void apply('dismiss')}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void apply('urgent')}
                >
                  <ArrowUp className="mr-1 h-3.5 w-3.5" />
                  Urgent
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void apply('defer')}
                >
                  <ArrowDown className="mr-1 h-3.5 w-3.5" />
                  Defer 7d
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={skip}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Skip for now
              </Button>
            )}
          </div>
        </>
      )}

      {lastAction?.undo && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <UndoToast
            key={lastAction.id}
            label={lastAction.label}
            question={lastAction.question}
            expiresAt={lastAction.expiresAt}
            onUndo={async () => {
              try {
                await lastAction.undo?.();
                await onApplied();
              } catch (err) {
                showError(err instanceof Error ? err.message : 'Undo failed');
              }
            }}
            onExpire={() => setLastAction(null)}
          />
        </div>
      )}
    </div>
  );
}
