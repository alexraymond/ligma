import type { ReactElement } from 'react';

export interface RubricHeaderProps {
  label: string;
  /** Optional date suffix, e.g. "24 Apr 2026" — joined with an em dash. */
  dateSuffix?: string;
  /** When true, the label is wrapped in a red-pencil oval and an arrow icon
   *  points into the row. Used for the Today bucket as the attention anchor. */
  emphasized?: boolean;
}

/**
 * "Today — 24 Apr 2026" / "Yesterday" / "Mar 2026" section heading used by
 * the Home wall. The emphasized variant gets a hand-drawn red oval around
 * the label and a red arrow pointing into the row — exactly the treatment
 * the paper-sketchbook mockup uses for "Today".
 */
export function RubricHeader({ label, dateSuffix, emphasized }: RubricHeaderProps): ReactElement {
  const fullLabel = dateSuffix ? `${label} — ${dateSuffix}` : label;
  return (
    <h2
      className="flex items-center gap-[16px] m-0"
      style={{
        fontFamily: 'var(--font-display)',
        fontStyle: 'italic',
        fontWeight: 500,
        fontSize: '13px',
        textTransform: 'uppercase',
        letterSpacing: '0.24em',
        color: 'var(--color-text-primary)',
      }}
    >
      {emphasized ? (
        <span className="ligma-pencil-oval">
          {fullLabel}
          <svg
            aria-hidden
            width={22}
            height={10}
            viewBox="0 0 22 10"
            style={{
              position: 'absolute',
              right: -26,
              top: 8,
              overflow: 'visible',
            }}
          >
            <title>arrow</title>
            <path
              d="M1 5 L18 5 M14 1 L19 5 L14 9"
              stroke="var(--color-accent)"
              strokeWidth={1.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : (
        <span style={{ padding: '2px 6px 4px' }}>{fullLabel}</span>
      )}
      <span aria-hidden style={{ flex: 1, borderTop: '1px dashed var(--color-rule)', height: 0 }} />
    </h2>
  );
}
