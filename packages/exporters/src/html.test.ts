import { describe, expect, it } from 'vitest';
import { buildHtmlDocument } from './html';

describe('buildHtmlDocument', () => {
  it('wraps a bare fragment in a document shell and injects the generator meta', () => {
    const out = buildHtmlDocument('<p>hi</p>', { injectTailwind: false });
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<meta name="generator" content="ligma" />');
    expect(out).toContain('<p>');
  });

  it('injects the Tailwind CDN tag only when missing', () => {
    const withCdn = buildHtmlDocument('<html><head></head><body></body></html>');
    expect(withCdn.match(/cdn\.tailwindcss\.com/g)).toHaveLength(1);

    const already = buildHtmlDocument(
      '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body></body></html>',
    );
    expect(already.match(/cdn\.tailwindcss\.com/g)).toHaveLength(1);
  });

  // P1 — prettifyHtml used to run its whitespace transforms over the WHOLE
  // document before script/pre detection, so `><` inside a JS string literal
  // grew a newline (SyntaxError) and `<pre>` whitespace was collapsed.
  it('never rewrites the inside of a <script> block', () => {
    const script = `<script>
      const markup = "<div><span>x</span></div>";
      const gap = "a   b";
      if (1 > 0) { console.log(markup, gap); }
    </script>`;
    const out = buildHtmlDocument(`<html><head></head><body>${script}</body></html>`, {
      injectTailwind: false,
    });
    expect(out).toContain('const markup = "<div><span>x</span></div>";');
    expect(out).toContain('const gap = "a   b";');
    // No newline may be introduced between the adjacent tags in the literal.
    expect(out).not.toContain('"<div>\n<span>');
  });

  it('preserves <pre> and <textarea> content verbatim', () => {
    const body = '<pre>  line one\n\n    indented</pre><textarea>  keep   me  </textarea>';
    const out = buildHtmlDocument(`<html><head></head><body>${body}</body></html>`, {
      injectTailwind: false,
    });
    expect(out).toContain('<pre>  line one\n\n    indented</pre>');
    expect(out).toContain('<textarea>  keep   me  </textarea>');
  });

  it('still indents ordinary markup', () => {
    const out = buildHtmlDocument('<div><p>hi</p></div>', { injectTailwind: false });
    expect(out).toMatch(/\n(\s*)<div>\n\1 {2}<p>hi<\/p>\n/);
  });

  it('leaves the document untouched when prettify is off', () => {
    const src = '<html><head></head><body><pre>  x  </pre></body></html>';
    const out = buildHtmlDocument(src, { injectTailwind: false, prettify: false });
    expect(out).toContain('<pre>  x  </pre>');
  });
});
