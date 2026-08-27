'use client';

import { StatusChip, type StatusChipState } from '@/components/status-pill';
import { stagesFor } from '@/lib/rail';
import { cn } from '@/lib/utils';
import type { Brief, DesignSummary, ProjectShape, Task } from '@ligma/api';
import { openForm } from '@ligma/api';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The stage bar is both status display and navigation (UX spec §4, §11 "one
 * header row"): each of the fixed four stages — Brief · Studio · Build ·
 * Proof (CONTRACTS-phase3) — carries a live chip and clicking it jumps to its
 * surface. It replaces the old PipelineStrip+TabRow pair, which spread the
 * same four decisions (plus six absorbed tabs) across two rows that could
 * disagree.
 *
 * Shape-adaptive, but not by hiding a stage with nothing in it yet: Build and
 * Proof always render once the project exists, with a quiet/empty chip when
 * there's nothing to show — an unused stage is still legible, only an
 * inapplicable one (Studio on a headless project) is truly absent. Brief is
 * the one stage that *can* be absent: it only exists once a brief has been
 * asked for, or the project arrived by adoption.
 *
 * The stage list and route segments come from `stagesFor`/`STAGES`
 * (`lib/rail.ts`, Agent K) — the same table ⌘K matches stage names against —
 * so this bar and the keyboard nav can't quietly disagree about what a stage
 * is called or where it lives. This file adds the one thing that table
 * doesn't carry: live chip/state per stage.
 */
export interface PipelineStage {
  key: string;
  label: string;
  href: string;
  chip: string;
  /**
   * The chip's state in the app's one vocabulary (UX spec §7) — the strip owns
   * no colours of its own.
   */
  state: StatusChipState;
}

/** What the bar needs beyond tasks. Absent members simply render a quiet chip. */
export interface PipelineContext {
  brief?: Brief | null;
  designs?: DesignSummary[];
  /** True for a project that arrived by adoption — its early stages are placeholders. */
  adopted?: boolean;
  /** Read only through `studioVisible` (via `stagesFor`) — never compared inline. */
  shape?: ProjectShape | undefined;
  /**
   * True when the brief/designs fetch failed. Brief must fail open, not
   * closed: hiding it on a transient error would read as "this project never
   * had one" (F2/B5).
   */
  pipelineError?: boolean;
}

function briefChip(context: PipelineContext): { chip: string; state: StatusChipState } {
  const brief = context.brief;
  if (brief) {
    return {
      chip: brief.staleFlaggedAt
        ? 'stale'
        : openForm(brief)
          ? '◷ discovery'
          : brief.status === 'compiled'
            ? '✓ compiled'
            : '✓ locked',
      state: brief.staleFlaggedAt ? 'stale' : openForm(brief) ? 'running' : 'done',
    };
  }
  if (context.adopted) return { chip: 'adopted', state: 'queued' };
  // Only reachable when `pipelineError` is what's keeping Brief visible.
  return { chip: 'unknown', state: 'queued' };
}

function studioChip(context: PipelineContext): { chip: string; state: StatusChipState } {
  const designs = context.designs ?? [];
  const awaiting = designs.filter((d) => d.status === 'critiquing').length;
  const approved = designs.filter((d) => d.status === 'approved').length;
  if (designs.length === 0) {
    return { chip: context.adopted ? 'adopted' : 'none yet', state: 'queued' };
  }
  if (awaiting > 0) return { chip: `◷${awaiting}`, state: 'in-review' };
  if (approved > 0) return { chip: `✓${approved}`, state: 'done' };
  return { chip: `●${designs.length}`, state: 'queued' };
}

function buildChip(tasks: Task[]): { chip: string; state: StatusChipState } {
  if (tasks.length === 0) return { chip: 'no tasks', state: 'queued' };
  const open = tasks.filter((t) => t.kanban !== 'done');
  const building = tasks.filter((t) => t.kanban === 'in-progress');
  return {
    chip: building.length > 0 ? `▶${building.length}` : `${open.length} open`,
    state: building.length > 0 ? 'running' : open.length === 0 ? 'done' : 'queued',
  };
}

function proofChip(tasks: Task[]): { chip: string; state: StatusChipState } {
  const inReview = tasks.filter((t) => t.kanban === 'awaiting-verification');
  const failed = tasks.filter((t) => t.verificationStatus === 'failed');
  const passed = tasks.filter((t) => t.verificationStatus === 'passed');
  const touched = tasks.filter((t) => (t.verificationStatus ?? 'unverified') !== 'unverified');
  if (inReview.length === 0 && touched.length === 0) return { chip: 'not proven', state: 'queued' };
  if (failed.length > 0) return { chip: `✗${failed.length}`, state: 'failed' };
  if (inReview.length > 0) return { chip: `◷${inReview.length}`, state: 'in-review' };
  return { chip: `✓${passed.length}`, state: 'passed' };
}

export function projectStages(
  projectId: string,
  tasks: Task[],
  context: PipelineContext = {},
): PipelineStage[] {
  const hasBrief =
    Boolean(context.brief) || Boolean(context.adopted) || Boolean(context.pipelineError);

  return stagesFor({ shape: context.shape })
    .filter((stage) => stage.key !== 'brief' || hasBrief)
    .map((stage) => {
      const { chip, state } =
        stage.key === 'brief'
          ? briefChip(context)
          : stage.key === 'studio'
            ? studioChip(context)
            : stage.key === 'build'
              ? buildChip(tasks)
              : proofChip(tasks);
      return {
        key: stage.key,
        label: stage.label,
        href: `/projects/${projectId}/${stage.segment}`,
        chip,
        state,
      };
    });
}

export function PipelineStrip({ stages }: { stages: PipelineStage[] }) {
  const pathname = usePathname();
  if (stages.length === 0) return null;

  return (
    <nav aria-label="Pipeline" className="flex flex-wrap items-center gap-1 text-sm">
      {stages.map((stage, i) => (
        <span key={stage.key} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/40">·</span>}
          <Link
            href={stage.href}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent',
              pathname === stage.href && 'bg-accent',
            )}
          >
            <span className="font-medium">{stage.label}</span>
            {/* The stage's own href is the chip's verdict link: a green ✓ on the
                Proof stage is one click from the verdicts that back it. */}
            <StatusChip state={stage.state} label={stage.chip} />
          </Link>
        </span>
      ))}
    </nav>
  );
}
