import type { Design } from '@ligma/shared';
import type { CSSProperties, ReactElement } from 'react';
import { HomeCard } from './HomeCard';

export interface HomeRowProps {
  designs: Design[];
  /** When true, the first card renders as a hero (2×2) and the grid reserves
   *  two rows — matches the Today section's attention-grabbing layout. */
  heroLayout?: boolean;
}

// minmax(0, 1fr) — without the 0 min, any grid item whose intrinsic width
// exceeds the track (e.g. the 1280-px iframe inside DesignCardPreview) would
// force the track to grow, and 4 × 1280 px blows past the max-w container.
// Also applies `minWidth: 0` on the children below so flex/grid children
// don't let their own auto-min-content do the same thing.
const PLAIN_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '18px',
};

const HERO_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gridAutoRows: '172px',
  gridTemplateRows: '172px 172px',
  gap: '16px 18px',
};

const CELL_STYLE: CSSProperties = { minWidth: 0 };
const HERO_CELL_STYLE: CSSProperties = {
  gridColumn: '1 / span 2',
  gridRow: '1 / span 2',
  minWidth: 0,
};

// Hero layout fits exactly 5 items: hero (2×2) + 4 fillers in the right
// 2 columns. Anything beyond that spills into a plain 4-col row below so
// cards never escape the 2-row track and overflow into implicit tracks.
const HERO_CAPACITY_FILLERS = 4;

/**
 * 4-column grid of HomeCards. In `heroLayout` mode the first design spans
 * the top-left 2×2 block and the next four fill the remaining cells. Any
 * additional designs overflow into a sibling plain row below.
 */
export function HomeRow({ designs, heroLayout }: HomeRowProps): ReactElement | null {
  if (designs.length === 0) return null;

  if (!heroLayout) {
    return (
      <div style={PLAIN_GRID}>
        {designs.map((d) => (
          <div key={d.id} style={CELL_STYLE}>
            <HomeCard design={d} />
          </div>
        ))}
      </div>
    );
  }

  const [hero, ...rest] = designs;
  if (!hero) return null;
  const fillers = rest.slice(0, HERO_CAPACITY_FILLERS);
  const spill = rest.slice(HERO_CAPACITY_FILLERS);
  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      <div style={HERO_GRID}>
        <div style={HERO_CELL_STYLE}>
          <HomeCard design={hero} variant="hero" />
        </div>
        {fillers.map((d) => (
          <div key={d.id} style={CELL_STYLE}>
            <HomeCard design={d} />
          </div>
        ))}
      </div>
      {spill.length > 0 ? (
        <div style={PLAIN_GRID}>
          {spill.map((d) => (
            <div key={d.id} style={CELL_STYLE}>
              <HomeCard design={d} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
