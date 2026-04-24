import { useT } from '@ligma/i18n';
import type { ReactElement } from 'react';
import { HomeWall } from './home/HomeWall';

export interface HomeViewProps {
  /** Reserved for future integrations (e.g. the templates link in TopStrip
   *  scrolling to a starter-row anchor inside the wall). Not yet used. */
  starterAnchorId?: string;
}

/**
 * Paper-sketchbook home — the "wall" of date-grouped tape-pinned design
 * cards. Replaces the previous tabbed HubView. Design Systems and Settings
 * have been promoted to sibling app views reachable via the left rail.
 */
export function HomeView(_props: HomeViewProps = {}): ReactElement {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] relative" style={{ padding: '16px 30px 20px 32px' }}>
        <HomeWall />
        <span
          aria-hidden
          style={{
            position: 'absolute',
            bottom: 8,
            right: 18,
            fontFamily: 'var(--font-hand)',
            fontSize: 15,
            color: 'var(--color-text-muted)',
            transform: 'rotate(-1deg)',
          }}
        >
          {t('home.marginScribble')}
        </span>
      </div>
    </div>
  );
}
