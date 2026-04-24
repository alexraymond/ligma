import { useT } from '@ligma/i18n';
import { Plus } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCodesignStore } from '../../store';
import { HomeRow } from './HomeRow';
import { RubricHeader } from './RubricHeader';
import { type Bucket, bucketByDate } from './bucket';

/**
 * Date-grouped wall of tape-pinned cards. Today appears first with a hero
 * card; Yesterday and each prior month follow in reverse-chronological order.
 * When the user has no designs yet, the wall renders an empty-state plaque
 * that mirrors the Caveat margin scribble on the mockup.
 */
export function HomeWall(): ReactElement {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const designsLoaded = useCodesignStore((s) => s.designsLoaded);
  const openNewProjectModal = useCodesignStore((s) => s.openNewProjectModal);
  const buckets: Bucket[] = bucketByDate(designs);

  if (!designsLoaded) {
    return <div className="h-full" />;
  }

  if (buckets.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center"
        style={{ padding: '80px 32px 48px', gap: 20 }}
      >
        <p
          style={{
            fontFamily: 'var(--font-hand)',
            fontSize: 22,
            fontStyle: 'italic',
            color: 'var(--color-text-secondary)',
            maxWidth: 560,
            lineHeight: 1.4,
          }}
        >
          {t('home.empty.hint')}
        </p>
        <button
          type="button"
          onClick={openNewProjectModal}
          className="inline-flex items-center gap-[8px]"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--color-on-accent)',
            background: 'var(--color-accent)',
            border: 'none',
            padding: '10px 22px',
            cursor: 'pointer',
            transform: 'rotate(-1.5deg)',
            boxShadow: 'var(--shadow-tilt-badge)',
          }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden />
          <span>{t('newProject.ctaButton')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 28 }}>
      <div className="flex items-center justify-end" style={{ marginBottom: -10 }}>
        <button
          type="button"
          onClick={openNewProjectModal}
          className="inline-flex items-center gap-[6px]"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-on-accent)',
            background: 'var(--color-accent)',
            border: 'none',
            padding: '6px 14px',
            cursor: 'pointer',
            transform: 'rotate(-1deg)',
            boxShadow: 'var(--shadow-tilt-badge)',
          }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
          <span>{t('newProject.ctaButton')}</span>
        </button>
      </div>
      {buckets.map((bucket, i) => {
        const isToday = bucket.key === 'today';
        return (
          <section
            key={bucket.key}
            className="flex flex-col"
            style={{ gap: 20, paddingTop: i === 0 ? 4 : 6 }}
          >
            <RubricHeader
              label={
                isToday
                  ? t('home.bucket.today')
                  : bucket.key === 'yesterday'
                    ? t('home.bucket.yesterday')
                    : bucket.label
              }
              {...(bucket.dateSuffix !== undefined ? { dateSuffix: bucket.dateSuffix } : {})}
              emphasized={isToday}
            />
            <HomeRow designs={bucket.items} heroLayout={isToday} />
          </section>
        );
      })}
    </div>
  );
}
