'use client';

import { type SubChip, subChipsForKind } from '@/lib/composer';

/**
 * Secondary chip rail under the 5 project-kind chips (OD-022) — narrows a kind
 * into a concrete starter idea. Picking one seeds the prompt box.
 *
 * The reference derives its sub-chips from the Community facet table (an
 * installed-plugin catalog); ligma has no plugin/facet system, so the pool is
 * the hand-authored table in `lib/composer.ts` instead — same idea, static
 * source.
 */
export function ComposerSubChips({
  kind,
  onPick,
}: {
  kind: string | null;
  onPick: (subChip: SubChip) => void;
}) {
  const chips = subChipsForKind(kind);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Starter ideas">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onPick(chip)}
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
