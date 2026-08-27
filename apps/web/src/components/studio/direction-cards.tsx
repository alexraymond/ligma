'use client';

/**
 * The first-design flow's two openers (roadmap phase 6): a grid of visual
 * directions, and a few starter prompts.
 *
 * Both write into the prompt textarea and nowhere else. Picking a direction is
 * a *visible* edit the user can read, reword or delete before sending — the
 * fragment never rides along invisibly with the turn. Picking nothing is a
 * complete answer; the composer works exactly as it did before.
 *
 * The card data is vendored (see `visual-styles.ts`); this UI is ours —
 * upstream's cards are CDN-hosted preview images, and nothing here fetches
 * from a CDN, so the mood is carried by a CSS swatch built from the data.
 */

import { cn } from '@/lib/utils';
import {
  VISUAL_STYLES,
  type VisualStyle,
  styleInPrompt,
  withStyleDirection,
} from './visual-styles';

/** How many directions sit above the fold; the rest live behind the disclosure. */
const FEATURED = 6;

/** Studio-shaped openings — the four kinds of thing people ask this designer for first. */
const STARTER_PROMPTS = [
  {
    label: 'Landing page',
    prompt: 'A landing page: hero, three feature blocks, pricing teaser, and a footer.',
  },
  {
    label: 'Dashboard',
    prompt: 'An analytics dashboard: KPI row, a trend chart, and a recent-activity table.',
  },
  {
    label: 'Mobile screens',
    prompt: 'Three mobile app screens: onboarding, home feed, and a profile.',
  },
  {
    label: 'Pricing page',
    prompt: 'A pricing page with three plans, a comparison table, and an FAQ.',
  },
] as const;

function DirectionCard({
  style,
  active,
  onPick,
}: {
  style: VisualStyle;
  active: boolean;
  onPick: () => void;
}) {
  const [a, b, c] = style.swatch;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      title={style.description}
      className={cn(
        'flex flex-col gap-1 rounded border p-1.5 text-left transition-colors',
        active ? 'border-primary bg-primary/10' : 'hover:bg-accent',
      )}
    >
      <span
        aria-hidden
        className="h-5 w-full rounded-sm border"
        style={{ background: `linear-gradient(90deg, ${a} 0 40%, ${b} 40% 75%, ${c} 75% 100%)` }}
      />
      <span className="truncate text-[11px] font-medium">{style.title}</span>
      <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
        {style.description}
      </span>
    </button>
  );
}

/**
 * The direction grid. Selection is read back out of the prompt text rather
 * than held in a second piece of state, so editing the line away un-presses
 * the card and clicking the same card twice removes it.
 */
export function DirectionCards({
  prompt,
  onChange,
}: {
  prompt: string;
  onChange: (next: string) => void;
}) {
  const picked = styleInPrompt(prompt);
  const pick = (style: VisualStyle) =>
    onChange(withStyleDirection(prompt, picked?.slug === style.slug ? null : style));
  const card = (style: VisualStyle) => (
    <DirectionCard
      key={style.slug}
      style={style}
      active={picked?.slug === style.slug}
      onPick={() => pick(style)}
    />
  );
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium">Start from a direction</p>
      <div className="grid grid-cols-2 gap-1.5">{VISUAL_STYLES.slice(0, FEATURED).map(card)}</div>
      <details>
        <summary className="cursor-pointer text-[11px] text-muted-foreground underline underline-offset-2">
          All {VISUAL_STYLES.length} directions
        </summary>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {VISUAL_STYLES.slice(FEATURED).map(card)}
        </div>
      </details>
    </div>
  );
}

/** Four example openings. Clicking one fills the textarea; the direction line, if any, stays. */
export function StarterPrompts({
  prompt,
  onChange,
}: { prompt: string; onChange: (next: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STARTER_PROMPTS.map(({ label, prompt: text }) => (
        <button
          key={label}
          type="button"
          title={text}
          onClick={() => onChange(withStyleDirection(text, styleInPrompt(prompt)))}
          className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
