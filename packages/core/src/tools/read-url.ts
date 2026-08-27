/**
 * read_url — fetch a URL and return a stripped-text excerpt the model can
 * use to inform the design. This is a deliberate lightweight implementation:
 * no headless browser, no JS execution, just HTML → plain text with a
 * length cap. The model doesn't need pixel-perfect DOM; it needs copy +
 * structure hints.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

const ReadUrlParams = Type.Object({
  url: Type.String(),
  maxChars: Type.Optional(Type.Number()),
});

export interface ReadUrlDetails {
  url: string;
  status: number;
  charsReturned: number;
  truncated: boolean;
}

function stripHtmlToText(html: string): string {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      // Preserve paragraph/heading breaks as newlines so the model can see
      // structure without real block-level markup.
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|br)\s*>/gi, '\n')
      .replace(/<br\s*\/?>(?!\n)/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * The URL reaching this tool is model-chosen, and the model's context can
 * contain attacker-supplied text (a reference page, an attachment, a brief
 * pasted from an email). Treat every request as attacker-directed:
 *
 *  - http/https only. `file:`, `gopher:`, `data:` are not "fetching a page".
 *  - no loopback / link-local / private ranges. The cloud metadata endpoint
 *    (169.254.169.254) and a developer's own localhost daemon are the two
 *    interesting targets for an injected `read_url`.
 *  - a bounded read. The 4KB output cap used to be applied AFTER buffering
 *    the entire body, so a multi-GB response was a memory bomb.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function hexPairToIpv4(high: string, low: string): string {
  const n = (Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16);
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function isBlockedHost(hostname: string): boolean {
  // URL keeps IPv6 literals in brackets.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true;
  // IPv4-mapped IPv6 — strip to the v4 part and re-check. Node's URL parser
  // normalises `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, so accept
  // both spellings.
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const target =
    mappedDotted?.[1] ??
    (mappedHex ? hexPairToIpv4(mappedHex[1] as string, mappedHex[2] as string) : host);

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(target);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true; // loopback, private, "this host"
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^(f[cd]|fe[89ab])/.test(target)) return true;
  return false;
}

/**
 * Note the residual gap: a hostname that RESOLVES to a private address still
 * passes (DNS rebinding). Closing it needs resolution + a pinned-IP agent,
 * which is a larger change than this tool warrants today.
 * ponytail: literal-address blocking only — add a resolving lookup + pinned
 * connect if this tool ever runs somewhere with real internal services.
 */
function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`read_url only fetches http/https URLs (got "${url.protocol}").`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(
      `read_url refuses private / loopback addresses (host "${url.hostname}"). Only public web pages can be read.`,
    );
  }
  return url;
}

const MAX_REDIRECTS = 5;

/**
 * Follow redirects by hand so every hop is re-validated. Letting fetch follow
 * them automatically means a perfectly public host can 302 the agent onto
 * 169.254.169.254 and the scheme/host guard above never sees it.
 */
async function fetchGuarded(start: URL, signal: AbortSignal | undefined): Promise<Response> {
  let url = start;
  for (let hop = 0; ; hop += 1) {
    const res = await fetch(url, {
      ...(signal ? { signal } : {}),
      redirect: 'manual',
      headers: {
        'user-agent': 'ligma/0.1 (+https://github.com/alexraymond/ligma)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
    });
    if (res.status < 300 || res.status > 399) return res;
    const location = res.headers.get('location');
    if (location === null) return res;
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting at ${start.href}`);
    }
    url = assertFetchableUrl(new URL(location, url).href);
  }
}

/** Read at most `limit` bytes of the response, then stop pulling. */
async function readBounded(res: Response, limit: number): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= limit) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

export function makeReadUrlTool(): AgentTool<typeof ReadUrlParams, ReadUrlDetails> {
  return {
    name: 'read_url',
    label: 'Read URL',
    description:
      'Fetch a public URL and return its visible text (stripped of HTML, ' +
      'scripts, styles). Use this to pull copy/facts from a reference URL ' +
      'the user supplied. Output is capped at maxChars (default 4000).',
    parameters: ReadUrlParams,
    async execute(_id, params, signal): Promise<AgentToolResult<ReadUrlDetails>> {
      const max = params.maxChars ?? 4000;
      const url = assertFetchableUrl(params.url);
      let res: Response;
      try {
        res = await fetchGuarded(url, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Network request failed: ${msg}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${params.url}`);
      }
      const body = await readBounded(res, MAX_BODY_BYTES);
      const text = stripHtmlToText(body);
      const truncated = text.length > max;
      const out = truncated ? `${text.slice(0, max)}\n\n[…truncated at ${max} chars]` : text;
      return {
        content: [{ type: 'text', text: out }],
        details: {
          url: params.url,
          status: res.status,
          charsReturned: out.length,
          truncated,
        },
      };
    },
  };
}
