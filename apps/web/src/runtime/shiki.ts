/**
 * Shiki-backed syntax highlighting (OD-049).
 *
 * Ported near-verbatim from open-design's `apps/web/src/runtime/shiki.ts` —
 * lazy-loaded highlighter, theme pair keyed off `data-theme`, small LRU
 * result cache. Trimmed the language list to what generated designs actually
 * ship (HTML/CSS/JS/TS/JSON/Markdown + the shells agents sometimes emit);
 * `shiki/bundle/web` still lazy-loads only what's requested either way.
 */
import type { BundledLanguage, Highlighter } from 'shiki/bundle/web';

let highlighterPromise: Promise<Highlighter> | null = null;

const cache = new Map<string, string>();
const CACHE_MAX = 128;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/web').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-light-default', 'github-dark-default'],
        langs: [
          'html',
          'css',
          'javascript',
          'typescript',
          'tsx',
          'jsx',
          'json',
          'markdown',
          'bash',
          'yaml',
        ],
      }),
    );
  }
  return highlighterPromise;
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const dark = isDarkMode();
  const cacheKey = `${dark ? 'd' : 'l'}:${lang}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const highlighter = await getHighlighter();
  const loadedLangs: string[] = highlighter.getLoadedLanguages();
  if (!loadedLangs.includes(lang)) {
    return '';
  }

  const html = highlighter.codeToHtml(code, {
    // Safe: just confirmed `lang` is one of the highlighter's loaded
    // (therefore valid `BundledLanguage`) languages, above.
    lang: lang as BundledLanguage,
    theme: dark ? 'github-dark-default' : 'github-light-default',
  });

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey, html);
  return html;
}
