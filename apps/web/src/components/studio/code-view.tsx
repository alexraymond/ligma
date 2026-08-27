'use client';

/**
 * Read-only syntax-highlighted source view (OD-049), for a generated design
 * file inside the version rail.
 *
 * The reference's `FileViewer.tsx` is an 18k-line artifact-preview engine
 * (URL-load vs srcDoc mode, comment/tweak/draw bridges, deck navigation…);
 * none of that applies to "show this file's source." What's ported is just
 * the mechanism its markdown code blocks used: `highlightCode` from
 * `runtime/shiki.ts`, with a plain `<pre>` fallback — here promoted to the
 * file's own render path rather than a nested markdown block, and applied to
 * huge files too (a multi-MB generated bundle isn't worth tokenizing).
 */

import { highlightCode } from '@/runtime/shiki';
import { useEffect, useState } from 'react';

/** Above this, skip shiki — tokenizing a huge file blocks the thread for no
 * legibility gain a human is going to read anyway. */
export const MAX_HIGHLIGHT_BYTES = 200_000;

/** Extensions the shiki bundle in `runtime/shiki.ts` actually loads. */
const LANG_BY_EXTENSION: Record<string, string> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
};

/** The shiki language id for a file path's extension, or `""` if unknown —
 * an unknown/missing language falls back to the plain `<pre>` view. */
export function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  return LANG_BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? '';
}

/** Whether a file is too large to bother tokenizing. */
export function shouldPlainRender(body: string): boolean {
  return body.length > MAX_HIGHLIGHT_BYTES;
}

/**
 * `className` sizes the scroll box: the version rail wants a 72-unit peek at a
 * file, Focus mode's Source view wants the whole pane. Everything else about
 * the two mounts is identical, so it is a class, not a second component.
 */
export function CodeView({
  path,
  body,
  className = 'max-h-72',
}: { path: string; body: string; className?: string }) {
  const lang = languageForPath(path);
  const plain = shouldPlainRender(body);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    setHtml(null);
    if (plain || !lang) return;
    let cancelled = false;
    void highlightCode(body, lang).then((result) => {
      if (!cancelled) setHtml(result || null);
    });
    return () => {
      cancelled = true;
    };
  }, [body, lang, plain]);

  if (html) {
    return (
      <div
        className={`${className} overflow-auto rounded text-[11px] leading-snug [&_pre]:m-0 [&_pre]:p-2`}
        // shiki generates this HTML itself from the same `body` string — no
        // caller-supplied markup ever reaches it.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-generated markup only, not user input.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre
      className={`${className} overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-[11px] leading-snug`}
    >
      {body}
    </pre>
  );
}
