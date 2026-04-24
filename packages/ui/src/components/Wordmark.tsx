/**
 * Ligma brand wordmark — paper-sketchbook aesthetic. Word mark in Fraunces
 * with an optional red-handwritten version pill rotated like a red-pen
 * margin note. No logomark by design — the typography is the brand.
 */

interface WordmarkProps {
  badge?: string;
  size?: 'sm' | 'md';
}

export function Wordmark({ badge, size = 'md' }: WordmarkProps) {
  const fontSize = size === 'sm' ? '20px' : '27px';
  const badgeSize = size === 'sm' ? '16px' : '20px';
  const gap = size === 'sm' ? '10px' : '12px';
  return (
    <span className="inline-flex items-baseline leading-none" style={{ gap }}>
      <span
        className="leading-none"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: 'var(--color-text-primary)',
        }}
      >
        Ligma
      </span>
      {badge ? (
        <span
          className="leading-none inline-block"
          style={{
            fontFamily: 'var(--font-hand)',
            fontSize: badgeSize,
            fontWeight: 600,
            color: 'var(--color-accent)',
            transform: 'rotate(-5deg)',
            transformOrigin: 'left bottom',
          }}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}
