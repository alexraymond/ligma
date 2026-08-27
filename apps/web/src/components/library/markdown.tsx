'use client';

/**
 * A markdown renderer small enough to keep.
 *
 * The Library renders two bodies of vendored prose — `DESIGN.md` and the
 * `craft/*.md` rulebooks — and both are written by us, in a narrow subset:
 * headings, paragraphs, lists, fenced code, blockquotes, pipe tables, and
 * inline code/bold/links. That subset is ~120 lines of `switch`, which is
 * cheaper than a runtime dependency the repo has so far avoided (no new npm
 * deps, brief §3).
 *
 * It builds React elements, never `dangerouslySetInnerHTML` — so a `<script>`
 * in a markdown file is text on the page, not a script on the page. Link hrefs
 * are checked before they become links for the same reason.
 *
 * ponytail: no nested lists, no reference links, no inline HTML. Reach for a
 * real parser the day the Library renders markdown someone else wrote.
 */

import { Fragment, type ReactNode } from 'react';

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

/** Only absolute http(s) and in-app paths become links — never `javascript:`. */
function safeHref(url: string): string | null {
  return /^(https?:\/\/|\/)/i.test(url) ? url : null;
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING_CLASS = [
  'mt-6 mb-2 text-lg font-semibold',
  'mt-6 mb-2 text-base font-semibold',
  'mt-5 mb-1.5 text-sm font-semibold',
  'mt-4 mb-1 text-sm font-medium',
  'mt-4 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground',
  'mt-4 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground',
];

function cells(row: string): string[] {
  return row
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function Markdown({ source }: { source: string }): ReactNode {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  const push = (node: ReactNode) => blocks.push(<Fragment key={blocks.length}>{node}</Fragment>);
  const take = (stop: (line: string) => boolean): string[] => {
    const collected: string[] = [];
    while (i < lines.length && !stop(lines[i])) collected.push(lines[i++]);
    return collected;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
    } else if (line.startsWith('```')) {
      i++;
      const body = take((l) => l.startsWith('```'));
      i++; // closing fence
      push(
        <pre className="my-3 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
          <code>{body.join('\n')}</code>
        </pre>,
      );
    } else if (/^#{1,6}\s/.test(line)) {
      const hashes = line.match(/^#+/);
      const level = hashes ? hashes[0].length : 1;
      // Demoted two levels: the page owns h1 and the detail pane's title owns
      // h2, so a document's own `#` must not compete with the thing it is
      // inside — the outline stays readable to a screen reader.
      const Tag = `h${Math.min(level + 2, 6)}` as 'h3';
      push(
        <Tag className={HEADING_CLASS[level - 1]}>
          {inline(line.replace(/^#+\s*/, ''), `h${i}`)}
        </Tag>,
      );
      i++;
    } else if (line.startsWith('|')) {
      const rows = take((l) => !l.startsWith('|')).map(cells);
      const [header, ...rest] = rows;
      const body = rest.filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
      push(
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c} className="border-b px-2 py-1.5 text-left font-semibold">
                    {inline(cell, `th${i}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-border/50 px-2 py-1.5 align-top">
                      {inline(cell, `td${i}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith('>')) {
      const body = take((l) => !l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));
      push(
        <blockquote className="my-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {inline(body.join(' '), `q${i}`)}
        </blockquote>,
      );
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = take((l) => !/^\s*([-*+]|\d+\.)\s/.test(l)).map((l) =>
        l.replace(/^\s*([-*+]|\d+\.)\s*/, ''),
      );
      const Tag = ordered ? 'ol' : 'ul';
      push(
        <Tag className={`my-2 space-y-1 pl-5 text-sm ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `li${i}-${n}`)}</li>
          ))}
        </Tag>,
      );
    } else if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      push(<hr className="my-4 border-border" />);
      i++;
    } else {
      const body = take(
        (l) =>
          l.trim() === '' ||
          l.startsWith('#') ||
          l.startsWith('|') ||
          l.startsWith('>') ||
          l.startsWith('```') ||
          /^\s*([-*+]|\d+\.)\s/.test(l),
      );
      push(<p className="my-2 text-sm leading-relaxed">{inline(body.join(' '), `p${i}`)}</p>);
    }
  }

  return <div className="max-w-3xl">{blocks}</div>;
}
