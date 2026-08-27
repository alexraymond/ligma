'use client';

import { ActivityList } from '@/app/activity/activity-list';
import { RunsList } from '@/app/runs/runs-list';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { DecisionDeck } from '@/components/decision-deck';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { DecisionCardSkeleton, EventRowSkeleton } from '@/components/skeletons';
import { ExecutionPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConnection } from '@/hooks/use-connection';
import { useActivityLog, useInbox, useProjects, useTasks } from '@/hooks/use-data';
import { type DeckCard, RUN_BLOCKED_CAUSE_LABELS, deckCardLabel } from '@/hooks/use-deck-sources';
import { apiFetch } from '@/lib/api-client';
import { applyCardOption, navigationFor } from '@/lib/deck-actions';
import { recordHref } from '@/lib/nav';
import {
  type TrayItem,
  WORKSPACE_GROUP,
  classifyTray,
  groupByProject,
  markSeen,
  readLastSeen,
  splitByLastSeen,
  trayItemId,
  trayItemProjectId,
  trayMode,
} from '@/lib/needs-you';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { showError, showSuccess } from '@/lib/toast';
import { isUndoLive, patchDecision, undoDecision, undoSecondsLeft } from '@/lib/undo';
import { cn } from '@/lib/utils';
import { useActiveRunsContext } from '@/providers/active-runs-provider';
import { useDeckQueue } from '@/providers/deck-queue-provider';
import type { DecisionItem, InboxMessage, Task } from '@ligma/api';
import { AGENT_ROLES } from '@ligma/api';
import {
  BATCH_THRESHOLD,
  type DeckAction,
  UNDO_WINDOW_MS,
  deferredOrder,
  isUrgent,
} from '@ligma/api';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Code,
  HelpCircle,
  Mail,
  Megaphone,
  Search,
  Undo2,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
/**
 * /needs-you — the one interrupt surface (UX-REBUILD-BRIEF §Phase 1,
 * UX-REDESIGN §10/§16 "Tray v2"). Replaces the Deck and the Inbox: a decision,
 * a design approval, a frozen contract, an adoption review, and the daemon
 * being unreachable are all things that halt someone right now — they are
 * **blocking**. A stale brief, a spot-check, and an unread message are worth a
 * glance but halt nothing — they are **FYI**.
 *
 * Below `FOCUS_THRESHOLD` total items, Blocking renders as the Deck's existing
 * card-by-card swipe stack (`DecisionDeck`, reused wholesale). At or above it,
 * Blocking renders as the Deck's existing list/batch machinery, grouped by
 * project. FYI is always a flat list — nothing in it needs one-at-a-time
 * attention, so it never earns the swipe stack.
 *
 * ponytail: the "since you were last here" divider renders in every list
 * (FYI always, Blocking in list mode) but not inside the focus swipe stack —
 * a single-card-at-a-time UI has nowhere to put a divider line. Upgrade path
 * if that is ever wanted: order the stack fresh-first instead of a visual rule.
 */
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

const agentIcons: Record<string, typeof User> = {
  me: User,
  researcher: Search,
  developer: Code,
  marketer: Megaphone,
  'business-analyst': BarChart3,
  system: Bot,
};

/** `PATCH /api/decisions/bulk`'s response shape — one outcome per submitted id. */
interface BulkDecisionsResponse {
  results: Array<
    { id: string; ok: true; undoExpiresAt: string } | { id: string; ok: false; error: string }
  >;
  succeeded: number;
  failed: number;
}

function cardEntries(items: readonly TrayItem[]): DeckCard[] {
  return items
    .filter((i): i is Extract<TrayItem, { kind: 'card' }> => i.kind === 'card')
    .map((i) => i.card);
}

function MachineBanner() {
  return (
    // The pill carries the alarm — the card itself stays unpainted (seam rule).
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <ExecutionPill state="error" label="Unreachable" />
        <p className="flex-1 text-sm">
          The machine can&apos;t be reached — nothing new can be dispatched until it comes back.
        </p>
        <Link href="/runs" className="text-xs text-muted-foreground underline underline-offset-2">
          Open Runs
        </Link>
      </CardContent>
    </Card>
  );
}

function AgeLabel({ createdAt }: { createdAt: string | null }) {
  if (createdAt === null) return null;
  return (
    <span className="text-xs text-muted-foreground" title={formatDateTime(createdAt)}>
      {formatRelativeTime(createdAt)}
    </span>
  );
}

/** A divider between what's new since the last visit and everything else — only shown when both sides are non-empty. */
function LastSeenGroups<T>({
  fresh,
  earlier,
  renderItems,
}: {
  fresh: T[];
  earlier: T[];
  renderItems: (items: T[]) => ReactNode;
}) {
  if (fresh.length === 0) return <>{renderItems(earlier)}</>;
  if (earlier.length === 0) return <>{renderItems(fresh)}</>;
  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        New since your last visit
      </p>
      {renderItems(fresh)}
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Earlier
      </p>
      {renderItems(earlier)}
    </>
  );
}

export default function NeedsYouPage() {
  const router = useRouter();
  const {
    cards: deckCards,
    decisions,
    loading: deckLoading,
    error: deckError,
    refetch: refetchAll,
    refetchDecisions,
  } = useDeckQueue();
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const {
    messages: inboxMessages,
    loading: inboxLoading,
    error: inboxError,
    update: updateMessage,
  } = useInbox();
  const { online } = useConnection();
  const { runs, error: runsError, refetch: refetchRuns } = useActiveRunsContext();
  const {
    events,
    loading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useActivityLog();

  const machineUnreachable = !online;

  // Read once, before the mount effect below overwrites it — the divider has
  // to compare against where the human left off last time, not right now.
  const [lastSeenAt] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readLastSeen(window.localStorage),
  );
  useEffect(() => {
    if (typeof window !== 'undefined') markSeen(window.localStorage, new Date().toISOString());
  }, []);

  const { blocking, fyi } = useMemo(
    () => classifyTray(deckCards, inboxMessages, machineUnreachable),
    [deckCards, inboxMessages, machineUnreachable],
  );
  const mode = trayMode(blocking, fyi);
  const [forceList, setForceList] = useState(false);
  const effectiveMode = mode === 'list' || forceList ? 'list' : 'focus';

  const blockingDeckCards = useMemo(() => cardEntries(blocking), [blocking]);
  const machineItem = blocking.find((i) => i.kind === 'machine') ?? null;

  const projectName = useCallback(
    (id: string | null) =>
      id ? (projects.find((p) => p.id === id)?.name ?? WORKSPACE_GROUP) : WORKSPACE_GROUP,
    [projects],
  );
  // An inbox message carries a task, not a project directly (§ trayItemProjectId).
  const taskProjectId = useCallback(
    (taskId: string) => tasks.find((t) => t.id === taskId)?.projectId ?? null,
    [tasks],
  );

  // ── Decision + card answering — ported from the Deck's list mode verbatim ──
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkAnswer, setBulkAnswer] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [undoDeadlines, setUndoDeadlines] = useState<Record<string, number>>({});
  const [undoing, setUndoing] = useState<ReadonlySet<string>>(new Set());
  const [cardBusy, setCardBusy] = useState<string | null>(null);

  // Capped and most-recent-first (W17): every decision ever answered in the
  // workspace's history rendered here unbounded, and only the most recent one
  // can even show a live undo window (10s) — older rows are just growing
  // history clutter, not something this tray needs to hold onto forever.
  const ANSWERED_DISPLAY_LIMIT = 20;
  const answered = decisions
    .filter((d) => d.status === 'answered')
    .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''))
    .slice(0, ANSWERED_DISPLAY_LIMIT);
  const deferred = deferredOrder(decisions);

  const [now, setNow] = useState(() => Date.now());
  const lastDeadline = Object.values(undoDeadlines).reduce((max, at) => Math.max(max, at), 0);
  useEffect(() => {
    if (lastDeadline <= Date.now()) return;
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick > lastDeadline) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [lastDeadline]);

  const rememberUndo = (id: string, expiresAt: number | null) =>
    setUndoDeadlines((prev) => (expiresAt === null ? prev : { ...prev, [id]: expiresAt }));

  const handleAnswer = async (dec: DecisionItem, answer: string) => {
    try {
      const { undoExpiresAt } = await patchDecision({ id: dec.id, action: 'answer', answer });
      rememberUndo(dec.id, undoExpiresAt);
      await refetchDecisions();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save that answer');
    }
  };

  const undoAnswer = async (dec: DecisionItem) => {
    if (undoing.has(dec.id)) return;
    setUndoing((prev) => new Set(prev).add(dec.id));
    try {
      await undoDecision(dec.id);
      setUndoDeadlines((prev) => {
        const next = { ...prev };
        delete next[dec.id];
        return next;
      });
      showSuccess('Taken back — it is waiting on you again');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setUndoing((prev) => {
        const next = new Set(prev);
        next.delete(dec.id);
        return next;
      });
    }
    await refetchDecisions();
  };

  const answerOtherCard = async (card: DeckCard, option: string) => {
    if (cardBusy) return;
    const destination = navigationFor(card, option);
    if (destination) {
      router.push(destination);
      return;
    }
    setCardBusy(card.id);
    try {
      const outcome = await applyCardOption(card, option);
      if (outcome) showSuccess(outcome.label);
      await refetchAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not apply that');
    } finally {
      setCardBusy(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const bulkApply = async (action: DeckAction) => {
    if (bulkBusy || selected.size === 0) return;
    if (action === 'answer' && !bulkAnswer.trim()) return;
    setBulkBusy(true);
    const ids = [...selected];
    const total = ids.length;
    try {
      const res = await apiFetch('/api/decisions/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: ids.map((id) => ({
            id,
            action,
            answer: action === 'answer' ? bulkAnswer.trim() : undefined,
          })),
        }),
      });
      const body = (await res.json().catch(() => null)) as BulkDecisionsResponse | null;
      if (!res.ok || !body) throw new Error('Batch update failed');
      for (const r of body.results) {
        if (r.ok) rememberUndo(r.id, Date.parse(r.undoExpiresAt));
      }
      setSelected(new Set());
      setBulkAnswer('');
      await refetchDecisions();
      if (body.failed > 0) showError(`${body.failed} of ${total} failed — those are still pending`);
      else
        showSuccess(
          `${total} decision${total === 1 ? '' : 's'} updated — take any back from Answered within ${Math.round(UNDO_WINDOW_MS / 1000)}s`,
        );
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Batch update failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleInboxClick = async (msg: InboxMessage) => {
    try {
      await updateMessage(msg.id, { status: 'read' });
    } catch {
      // Non-fatal — the message just stays in the FYI list until the next poll.
    }
    if (msg.taskId) router.push(recordHref('task', msg.taskId));
  };

  const decisionCards = blockingDeckCards.filter(
    (c) => c.kind === 'decision' && c.decision !== null,
  );
  const blockingOtherCards = blockingDeckCards.filter((c) => c.kind !== 'decision');
  const totalBlocking = blocking.length;

  const trayLoading = deckLoading || inboxLoading;
  // A failed fetch must never render as "nothing needs you" — only a fetch
  // that actually returned an empty queue may say that.
  const trayError =
    deckError && deckCards.length === 0 && decisions.length === 0 ? deckError : null;

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Needs you' }]} />

      <Tabs defaultValue="tray">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <HelpCircle className="h-5 w-5" />
            Needs you
            {totalBlocking > 0 && (
              <Badge variant="destructive" className="ml-2">
                {totalBlocking} blocking
              </Badge>
            )}
          </h1>
          <TabsList>
            <TabsTrigger value="tray">Needs you</TabsTrigger>
            <TabsTrigger value="running">Running</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tray" className="space-y-6">
          {trayLoading ? (
            <div className="space-y-3">
              <DecisionCardSkeleton />
              <DecisionCardSkeleton />
            </div>
          ) : trayError ? (
            <ErrorState
              title="Couldn't load what needs you"
              detail={trayError}
              onRetry={() => void refetchAll()}
            />
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {/* ── Blocking ──────────────────────────────────────────── */}
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-yellow-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blocking {totalBlocking > 0 && `(${totalBlocking})`}
                </h2>

                {machineItem && <MachineBanner />}

                {effectiveMode === 'focus' ? (
                  <DecisionDeck
                    cards={blockingDeckCards}
                    tasks={tasks}
                    onApplied={refetchAll}
                    onUndoWindow={rememberUndo}
                    onOpenList={() => setForceList(true)}
                    projectName={projectName}
                  />
                ) : (
                  <BlockingListMode
                    decisionCards={decisionCards}
                    otherCards={blockingOtherCards}
                    tasks={tasks}
                    projectName={projectName}
                    selected={selected}
                    toggleSelected={toggleSelected}
                    setSelected={setSelected}
                    bulkAnswer={bulkAnswer}
                    setBulkAnswer={setBulkAnswer}
                    bulkBusy={bulkBusy}
                    bulkApply={bulkApply}
                    customAnswers={customAnswers}
                    setCustomAnswers={setCustomAnswers}
                    handleAnswer={handleAnswer}
                    cardBusy={cardBusy}
                    answerOtherCard={answerOtherCard}
                    answered={answered}
                    deferred={deferred}
                    undoDeadlines={undoDeadlines}
                    undoing={undoing}
                    undoAnswer={undoAnswer}
                    now={now}
                  />
                )}

                {!machineItem &&
                  decisionCards.length === 0 &&
                  blockingOtherCards.length === 0 &&
                  effectiveMode === 'list' && (
                    <EmptyState
                      icon={CheckCircle2}
                      title="Nothing is blocking you"
                      description="A decision, a design to approve, a contract to confirm, or an adoption review will appear here."
                    />
                  )}
              </section>

              {/* ── FYI ───────────────────────────────────────────────── */}
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  FYI {fyi.length > 0 && `(${fyi.length})`}
                </h2>
                {inboxError && (
                  <p className="text-xs text-muted-foreground">
                    Some inbox items may be missing: {inboxError}
                  </p>
                )}
                <FyiList
                  fyi={fyi}
                  lastSeenAt={lastSeenAt}
                  cardBusy={cardBusy}
                  onCardOption={answerOtherCard}
                  onInboxClick={handleInboxClick}
                  projectName={projectName}
                  taskProjectId={taskProjectId}
                />
                {fyi.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing else needs a look right now.
                  </p>
                )}
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="running">
          <RunsList
            runs={runs}
            tasks={tasks}
            runsError={runsError}
            onRefetch={() => void refetchRuns()}
          />
        </TabsContent>

        <TabsContent value="activity">
          {activityLoading ? (
            <div className="space-y-2">
              <EventRowSkeleton />
              <EventRowSkeleton />
              <EventRowSkeleton />
            </div>
          ) : activityError ? (
            <ErrorState message={activityError} onRetry={refetchActivity} />
          ) : (
            <ActivityList events={events} tasks={tasks} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Blocking, list mode — the Deck's list machinery, grouped by project ─────

interface BlockingListModeProps {
  decisionCards: DeckCard[];
  otherCards: DeckCard[];
  tasks: Task[];
  projectName: (id: string | null) => string;
  selected: ReadonlySet<string>;
  toggleSelected: (id: string) => void;
  setSelected: (next: ReadonlySet<string>) => void;
  bulkAnswer: string;
  setBulkAnswer: (v: string) => void;
  bulkBusy: boolean;
  bulkApply: (action: DeckAction) => Promise<void>;
  customAnswers: Record<string, string>;
  setCustomAnswers: Dispatch<SetStateAction<Record<string, string>>>;
  handleAnswer: (dec: DecisionItem, answer: string) => Promise<void>;
  cardBusy: string | null;
  answerOtherCard: (card: DeckCard, option: string) => Promise<void>;
  answered: DecisionItem[];
  deferred: DecisionItem[];
  undoDeadlines: Record<string, number>;
  undoing: ReadonlySet<string>;
  undoAnswer: (dec: DecisionItem) => Promise<void>;
  now: number;
}

function BlockingListMode({
  decisionCards,
  otherCards,
  tasks,
  projectName,
  selected,
  toggleSelected,
  setSelected,
  bulkAnswer,
  setBulkAnswer,
  bulkBusy,
  bulkApply,
  customAnswers,
  setCustomAnswers,
  handleAnswer,
  cardBusy,
  answerOtherCard,
  answered,
  deferred,
  undoDeadlines,
  undoing,
  undoAnswer,
  now,
}: BlockingListModeProps) {
  const decisions = decisionCards.map((c) => c.decision!);
  const groupedDecisions = groupByProject(decisionCards, (c) => c.projectId, projectName);
  const groupedOther = groupByProject(otherCards, (c) => c.projectId, projectName);

  return (
    <div className="space-y-4">
      {decisions.length >= BATCH_THRESHOLD && (
        <div
          data-testid="batch-banner-list"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <p className="flex-1 text-sm">
            <span className="font-semibold">{decisions.length} decisions</span> waiting — select
            several and act on them in one pass.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(decisions.map((d) => d.id)))}
          >
            Select all
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Input
            value={bulkAnswer}
            onChange={(e) => setBulkAnswer(e.target.value)}
            placeholder="Answer all selected with…"
            className="h-8 max-w-xs flex-1 text-xs"
          />
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={bulkBusy || !bulkAnswer.trim()}
            onClick={() => void bulkApply('answer')}
          >
            Answer
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={bulkBusy}
            onClick={() => void bulkApply('dismiss')}
          >
            Dismiss
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={bulkBusy}
            onClick={() => void bulkApply('defer')}
          >
            Defer 7d
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {decisions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="flex flex-1 items-center gap-2 text-sm font-semibold text-yellow-400">
              Needs your input ({decisions.length})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              data-testid="select-all-pending"
              onClick={() =>
                setSelected(
                  selected.size === decisions.length
                    ? new Set()
                    : new Set(decisions.map((d) => d.id)),
                )
              }
            >
              {selected.size === decisions.length ? 'Clear selection' : 'Select all pending'}
            </Button>
          </div>

          {groupedDecisions.map(([project, cards]) => (
            <div key={project} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {project} ({cards.length})
              </p>
              <div className="space-y-3">
                {cards.map((c) => {
                  const dec = c.decision!;
                  const RequestorIcon = agentIcons[dec.requestedBy] ?? User;
                  const requestorLabel =
                    dec.requestedBy === 'system'
                      ? 'System'
                      : (AGENT_ROLES.find((r) => r.id === dec.requestedBy)?.label ??
                        dec.requestedBy);
                  const linkedTask = dec.taskId ? tasks.find((t) => t.id === dec.taskId) : null;
                  return (
                    <Card key={dec.id} className="border-yellow-500/30 bg-yellow-500/5">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected.has(dec.id)}
                            onChange={() => toggleSelected(dec.id)}
                            aria-label={`Select decision: ${dec.question}`}
                            className="mt-1 h-4 w-4 shrink-0 accent-primary"
                          />
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/20">
                            <RequestorIcon className="h-4 w-4 text-yellow-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="line-clamp-2 break-words text-sm font-semibold"
                              title={dec.question}
                            >
                              {dec.question}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                Asked by {requestorLabel}
                              </span>
                              <AgeLabel createdAt={dec.createdAt} />
                              {isUrgent(dec) && (
                                <Badge variant="destructive" className="text-[10px]">
                                  Urgent
                                </Badge>
                              )}
                              {dec.blocksTask === true && (
                                <Badge variant="destructive" className="text-[10px]">
                                  Blocks task
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {dec.context && (
                          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            {dec.context}
                          </p>
                        )}

                        {linkedTask && (
                          <p className="text-xs text-muted-foreground">
                            Related: <span className="text-foreground">{linkedTask.title}</span>
                          </p>
                        )}

                        {dec.options.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {dec.options.map((opt, i) => (
                              <Button
                                key={i}
                                variant="outline"
                                size="sm"
                                className="h-auto max-w-full whitespace-normal break-words py-1.5 text-left text-xs"
                                onClick={() => void handleAnswer(dec, opt)}
                              >
                                {opt}
                              </Button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Input
                            value={customAnswers[dec.id] ?? ''}
                            onChange={(e) =>
                              setCustomAnswers((prev) => ({ ...prev, [dec.id]: e.target.value }))
                            }
                            placeholder="Or type a custom answer..."
                            className="h-8 flex-1 text-xs"
                          />
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            disabled={!customAnswers[dec.id]?.trim()}
                            onClick={() => {
                              void handleAnswer(dec, customAnswers[dec.id]!.trim());
                              setCustomAnswers((prev) => ({ ...prev, [dec.id]: '' }));
                            }}
                          >
                            Answer
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {otherCards.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Also blocking ({otherCards.length})
          </h3>
          {groupedOther.map(([project, cards]) => (
            <div key={project} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {project} ({cards.length})
              </p>
              <div className="space-y-2">
                {cards.map((card) => (
                  <Card key={card.id} className="bg-card/30">
                    <CardContent className="space-y-2 p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Badge variant="outline" className="text-[10px]">
                          {deckCardLabel(card)}
                        </Badge>
                        {card.kind === 'run-blocked' && card.causeKind && (
                          // Amber, not destructive — "error ≠ failed"
                          // (failure/classify.ts): harness trouble, not a
                          // verdict on the work.
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-500"
                          >
                            {RUN_BLOCKED_CAUSE_LABELS[card.causeKind]}
                          </Badge>
                        )}
                        <p
                          className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium"
                          title={card.title}
                        >
                          {card.title}
                        </p>
                        <AgeLabel createdAt={card.createdAt} />
                      </div>
                      <p className="text-xs text-muted-foreground">{card.context}</p>
                      {card.kind === 'run-blocked' && card.reason && (
                        <p className="text-xs italic text-muted-foreground">
                          &ldquo;{card.reason}&rdquo;
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {card.options.map((opt) => (
                          <Button
                            key={opt}
                            size="sm"
                            variant="outline"
                            className="h-auto max-w-full whitespace-normal break-words py-1.5 text-left text-xs"
                            disabled={cardBusy === card.id}
                            onClick={() => void answerOtherCard(card, opt)}
                          >
                            {opt}
                          </Button>
                        ))}
                        <Link
                          href={card.href}
                          className="text-xs text-muted-foreground underline underline-offset-2"
                        >
                          {card.opensSheet ? 'Open the review sheet' : 'See where this came from'}
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {answered.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Answered ({answered.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Each answer can be taken back for {Math.round(UNDO_WINDOW_MS / 1000)} seconds.
            </p>
          </div>
          <div className="space-y-2">
            {answered.map((dec) => {
              const requestorLabel =
                dec.requestedBy === 'system'
                  ? 'System'
                  : (AGENT_ROLES.find((r) => r.id === dec.requestedBy)?.label ?? dec.requestedBy);
              const expiresAt = undoDeadlines[dec.id] ?? null;
              const live = isUndoLive(expiresAt, now);
              return (
                <Card
                  key={dec.id}
                  className={cn('bg-card/30', live ? 'border-primary/40' : 'opacity-60')}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{dec.question}</p>
                        <p className="text-xs text-muted-foreground">
                          {requestorLabel} asked · Answered:{' '}
                          <span className="text-foreground">{dec.answer}</span>
                          {dec.answeredAt && ` · ${formatRelativeTime(dec.answeredAt)}`}
                        </p>
                      </div>
                      {live ? (
                        <>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {undoSecondsLeft(expiresAt, now)}s left
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="undo-answered"
                            className="h-7 shrink-0 text-xs"
                            disabled={undoing.has(dec.id)}
                            onClick={() => void undoAnswer(dec)}
                          >
                            <Undo2 className="mr-1 h-3.5 w-3.5" />
                            Undo
                          </Button>
                        </>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          Undo window closed
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {deferred.length > 0 && (
        <details
          data-testid="deferred-group"
          className="rounded-lg border border-border bg-card/30 px-4 py-3"
        >
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
            Deferred ({deferred.length})
          </summary>
          <div className="mt-3 space-y-2">
            {deferred.map((dec) => (
              <div
                key={dec.id}
                className="flex items-start gap-3 border-t border-border pt-2 first:border-0 first:pt-0"
              >
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{dec.question}</p>
                  <p className="text-xs text-muted-foreground">
                    Resurfaces {formatRelativeTime(dec.deferUntil!)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── FYI — always a flat list, never the swipe stack ─────────────────────────

function FyiList({
  fyi,
  lastSeenAt,
  cardBusy,
  onCardOption,
  onInboxClick,
  projectName,
  taskProjectId,
}: {
  fyi: TrayItem[];
  lastSeenAt: string | null;
  cardBusy: string | null;
  onCardOption: (card: DeckCard, option: string) => Promise<void>;
  onInboxClick: (msg: InboxMessage) => Promise<void>;
  projectName: (id: string | null) => string;
  taskProjectId: (taskId: string) => string | null;
}) {
  const { fresh, earlier } = splitByLastSeen(fyi, lastSeenAt);

  const renderItem = (item: TrayItem) => {
    if (item.kind === 'inbox') {
      const msg = item.message;
      return (
        <button
          key={trayItemId(item)}
          type="button"
          onClick={() => void onInboxClick(msg)}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/30 p-3 text-left hover:bg-card/50"
        >
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{msg.subject || '(no subject)'}</p>
            <p className="text-xs text-muted-foreground">From {msg.from}</p>
          </div>
          <AgeLabel createdAt={msg.createdAt} />
        </button>
      );
    }
    // The machine item never lands in FYI (classifyTray always puts it in blocking).
    if (item.kind !== 'card') return null;
    const card = item.card;
    return (
      <Card key={trayItemId(item)} className="bg-card/30">
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Badge variant="outline" className="text-[10px]">
              {deckCardLabel(card)}
            </Badge>
            <p
              className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium"
              title={card.title}
            >
              {card.title}
            </p>
            <AgeLabel createdAt={card.createdAt} />
          </div>
          <p className="text-xs text-muted-foreground">{card.context}</p>
          <div className="flex flex-wrap items-center gap-2">
            {card.options.map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant="outline"
                className="h-auto max-w-full whitespace-normal break-words py-1.5 text-left text-xs"
                disabled={cardBusy === card.id}
                onClick={() => void onCardOption(card, opt)}
              >
                {opt}
              </Button>
            ))}
            <Link
              href={card.href}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              See where this came from
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Each FYI item carries a different amount of project knowledge (a card has
  // its own projectId, an inbox message only via its task) — trayItemProjectId
  // hides that so grouping reads the same for both.
  const renderItems = (items: TrayItem[]) => {
    const grouped = groupByProject(
      items,
      (item) => trayItemProjectId(item, taskProjectId),
      projectName,
    );
    return grouped.map(([project, items]) => (
      <div key={project} className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {project} ({items.length})
        </p>
        <div className="space-y-2">{items.map(renderItem)}</div>
      </div>
    ));
  };

  return (
    <div className="space-y-4">
      <LastSeenGroups fresh={fresh} earlier={earlier} renderItems={renderItems} />
    </div>
  );
}
