import { X } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useCodesignStore } from '../../store';

const INDENT = '  ';

// Small pretty-printer for the artboard HTML slice. It's a display aid, not a
// parser — the content is real DOM the sandbox rendered, so the structure is
// well-formed by the time we see it. Tokens are tagged so we can render each
// as safe text inside React elements (no dangerouslySetInnerHTML).
type HtmlToken =
  | { kind: 'tag'; text: string; depth: number }
  | { kind: 'text'; text: string; depth: number }
  | { kind: 'comment'; text: string; depth: number };

function tokenize(raw: string): HtmlToken[] {
  const pieces = raw.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];
  const out: HtmlToken[] = [];
  let depth = 0;
  for (const piece of pieces) {
    const isComment = piece.startsWith('<!--');
    const isTag = !isComment && piece.startsWith('<');
    const isClose = isTag && piece.startsWith('</');
    const isSelfClose =
      isTag &&
      (piece.endsWith('/>') ||
        /^<(?:br|hr|img|input|meta|link|source|track|area|base|col|embed|param|wbr)\b/i.test(
          piece,
        ));
    if (isClose) depth = Math.max(0, depth - 1);
    if (isComment) out.push({ kind: 'comment', text: piece, depth });
    else if (isTag) out.push({ kind: 'tag', text: piece, depth });
    else {
      const trimmed = piece.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 0) out.push({ kind: 'text', text: trimmed, depth });
    }
    if (isTag && !isClose && !isSelfClose) depth++;
  }
  return out;
}

// Break a single tag like `<div class="a" id="b">` into highlighted spans. All
// output is React children — every piece is a string under a span, so browsers
// render it as text, not HTML. Safe for adversarial input.
function renderTag(tag: string, rowKey: number): ReactNode {
  const nameMatch = tag.match(/^(<\/?)([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!nameMatch) {
    return <span key={rowKey}>{tag}</span>;
  }
  const [, prefix, name] = nameMatch;
  const rest = tag.slice(nameMatch[0].length);
  const attrRe = /\s+([a-zA-Z-:]+)(?:=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>]+))?/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = attrRe.exec(rest);
  while (match !== null) {
    if (match.index > cursor) parts.push(rest.slice(cursor, match.index));
    parts.push(' ');
    parts.push(
      <span key={`${rowKey}-a-${match.index}`} className="tok-attr">
        {match[1]}
      </span>,
    );
    if (match[2] !== undefined) {
      parts.push('=');
      parts.push(
        <span key={`${rowKey}-v-${match.index}`} className="tok-string">
          {match[2]}
        </span>,
      );
    }
    cursor = match.index + match[0].length;
    match = attrRe.exec(rest);
  }
  if (cursor < rest.length) parts.push(rest.slice(cursor));
  return (
    <Fragment key={rowKey}>
      {prefix}
      <span className="tok-tag">{name}</span>
      {parts}
    </Fragment>
  );
}

export function ArtboardCodeDrawer() {
  const view = useCodesignStore((s) => s.artboardCodeView);
  const close = useCodesignStore((s) => s.closeArtboardCode);
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => (view ? tokenize(view.outerHTML) : []), [view]);
  const plain = useMemo(
    () =>
      tokens.map((t) => INDENT.repeat(t.depth) + (t.kind === 'text' ? t.text : t.text)).join('\n'),
    [tokens],
  );

  useEffect(() => {
    if (!view) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, close]);

  if (!view) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };

  return (
    <aside
      className="absolute top-0 right-0 bottom-0 z-20 w-[520px] max-w-[55%] border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] flex flex-col"
      role="dialog"
      aria-label={`Source for ${view.label || 'artboard'}`}
    >
      <header className="flex items-center gap-[var(--space-3)] h-[44px] px-[var(--space-4)] border-b border-[var(--color-border-muted)]">
        <div className="flex flex-col min-w-0 flex-1">
          <span
            className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {view.viewport || 'artboard'}
          </span>
          <span className="truncate text-[var(--text-sm)] text-[var(--color-text-primary)] font-medium">
            {view.label || 'Untitled artboard'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Close code viewer"
          className="inline-flex items-center justify-center w-[24px] h-[24px] rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <X className="w-[14px] h-[14px]" aria-hidden />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-auto px-[var(--space-4)] py-[var(--space-3)] bg-[var(--color-background-secondary)]">
        <pre
          className="m-0 text-[12px] leading-[1.55] text-[var(--color-text-primary)] whitespace-pre-wrap break-words"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {tokens.map((t, i) => {
            const indent = INDENT.repeat(t.depth);
            if (t.kind === 'comment') {
              return (
                <Fragment key={i}>
                  {indent}
                  <span className="tok-comment">{t.text}</span>
                  {'\n'}
                </Fragment>
              );
            }
            if (t.kind === 'text') {
              return (
                <Fragment key={i}>
                  {indent}
                  {t.text}
                  {'\n'}
                </Fragment>
              );
            }
            return (
              <Fragment key={i}>
                {indent}
                {renderTag(t.text, i)}
                {'\n'}
              </Fragment>
            );
          })}
        </pre>
        <style>{`
          .tok-tag { color: var(--color-accent); }
          .tok-attr { color: #8a6a2a; }
          .tok-string { color: #2a6a4a; }
          .tok-comment { color: var(--color-text-muted); font-style: italic; }
          :root.dark .tok-attr { color: #d4a94a; }
          :root.dark .tok-string { color: #7bc49a; }
        `}</style>
      </div>
    </aside>
  );
}
