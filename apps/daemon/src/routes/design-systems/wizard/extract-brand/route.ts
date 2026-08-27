/**
 * `POST /api/design-systems/wizard/extract-brand` — OD-075.
 *
 * "Start from a website" for the design-system wizard: fetch one page, read the
 * CSS it actually ships, and propose a token set the wizard pre-fills. It is a
 * *measurement*, not a generation — no model is called, and nothing here
 * invents a value it did not read. What could not be measured comes back in
 * `notes` so the reviewer knows which swatches are inferred.
 *
 * Ported from open-design's `apps/daemon/src/brands/prefetch.ts` +
 * `seed-fallback.ts`: the frequency-ranked colour scan with source provenance,
 * the high-signal rescue for `--brand-*`/`--accent-*` custom properties, the
 * luminance-cast background/foreground split, and the display/body/mono font
 * cascade. Two deliberate differences from the reference:
 *
 *   1. **Provenance is structural, not a text lookback.** The reference walked
 *      back 900 characters from each literal to guess the declaring property.
 *      Here the CSS is scanned rule → declaration → value, so the property and
 *      selector a colour came from are known rather than recovered.
 *   2. **No headless browser.** The reference's counts came from a computed
 *      -style sweep over live DOM elements; a plain fetch counts *declarations*
 *      instead. `:root` custom properties are weighted up to compensate, and
 *      `notes` says so.
 *
 * Fetch safety — this is a localhost daemon reaching out to a URL a user typed:
 * http(s) only, no loopback/private/link-local hosts, at most three redirect
 * hops each re-checked, a hard byte cap and a hard time budget. At most four
 * linked stylesheets are read, under the same rules.
 */

import { z } from "zod";
import { NextResponse } from "../../../../http";
import { validateBody } from "../../../../store/validations";
import { parseDeclarations, stripCssComments } from "../_lib";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const MAX_STYLESHEETS = 4;

// ─── HTML scanning ───────────────────────────────────────────────────────────

interface HtmlTag {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** Index just past the tag's `>`, so a caller can read element content. */
  readonly end: number;
}

/**
 * The document's tags, as name + attributes.
 *
 * ponytail: a small tag scanner rather than jsdom or cheerio — neither is a
 * daemon dependency (checked), and the four things this route needs from the
 * markup are `<meta>`, `<link>`, `<style>` and the `style=` attribute. Ceiling:
 * it does not build a tree and does not know that `<script>` content is not
 * markup, which is harmless when the only thing read out is attributes.
 */
function* scanTags(html: string): Generator<HtmlTag> {
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) return;
    const nameEnd = /[\s/>]/.exec(html.slice(open + 1, open + 40));
    if (!nameEnd || nameEnd.index === 0) {
      index = open + 1;
      continue;
    }
    const name = html.slice(open + 1, open + 1 + nameEnd.index).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      index = open + 1;
      continue;
    }
    const close = html.indexOf(">", open);
    if (close === -1) return;
    yield { name, attrs: parseAttrs(html.slice(open + 1 + nameEnd.index, close)), end: close + 1 };
    index = close + 1;
  }
}

/** `key="value"` / `key='value'` / `key=value` / `key`, in one attribute list. */
function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s/]/.test(source[index])) index += 1;
    const keyStart = index;
    while (index < source.length && !/[\s=/]/.test(source[index])) index += 1;
    if (index === keyStart) break;
    const key = source.slice(keyStart, index).toLowerCase();
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] !== "=") {
      out[key] = "";
      continue;
    }
    index += 1;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, index + 1);
      if (end === -1) break;
      out[key] = decodeEntities(source.slice(index + 1, end));
      index = end + 1;
    } else {
      const start = index;
      while (index < source.length && !/\s/.test(source[index])) index += 1;
      out[key] = decodeEntities(source.slice(start, index));
    }
  }
  return out;
}

/** The handful of entities that show up inside style/href attributes. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export interface PageStyles {
  /** Inline `<style>` bodies and `style=` attributes, already CSS-shaped. */
  readonly css: string;
  /** Absolute hrefs of linked stylesheets, in document order. */
  readonly stylesheets: readonly string[];
  readonly themeColor: string | null;
}

/**
 * Everything style-bearing in one page.
 *
 * A `style=` attribute is wrapped in a synthetic selector built from the
 * element's tag and class list, exactly as the reference does — the selector is
 * what later tells an accent apart from a body colour, so throwing it away
 * would cost the ranking its best signal.
 */
export function scanHtml(html: string, baseUrl: string): PageStyles {
  const parts: string[] = [];
  const stylesheets: string[] = [];
  let themeColor: string | null = null;

  for (const tag of scanTags(html)) {
    if (tag.name === "style") {
      const end = html.indexOf("</style", tag.end);
      parts.push(html.slice(tag.end, end === -1 ? html.length : end));
      continue;
    }
    if (tag.name === "meta" && tag.attrs.name?.toLowerCase() === "theme-color") {
      themeColor ??= tag.attrs.content?.trim() || null;
      continue;
    }
    if (tag.name === "link" && (tag.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      const href = absoluteUrl(tag.attrs.href, baseUrl);
      if (href && stylesheets.length < MAX_STYLESHEETS) stylesheets.push(href);
      continue;
    }
    const inline = tag.attrs.style?.trim();
    if (inline) {
      const classes = (tag.attrs.class ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
      const selector = [tag.name, ...classes.map((c) => `.${c}`)].join("");
      parts.push(`${selector}{${inline}}`);
    }
  }

  return { css: parts.join("\n"), stylesheets, themeColor };
}

function absoluteUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// ─── CSS scanning ────────────────────────────────────────────────────────────

export interface Declaration {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

/**
 * Every declaration in a stylesheet, with the selector it sits under.
 *
 * At-rule bodies (`@media`, `@supports`, `@layer`) are recursed into rather
 * than skipped — a brand that only declares its palette inside a media query
 * would otherwise measure as having no colours at all.
 */
export function scanCss(css: string, depth = 0): Declaration[] {
  const clean = depth === 0 ? stripCssComments(css) : css;
  const out: Declaration[] = [];
  let index = 0;
  while (index < clean.length && out.length < 20_000) {
    const open = clean.indexOf("{", index);
    if (open === -1) break;
    const selector = clean.slice(index, open).trim().replace(/\s+/g, " ").slice(0, 120);
    let depthCount = 1;
    let cursor = open + 1;
    while (cursor < clean.length && depthCount > 0) {
      if (clean[cursor] === "{") depthCount += 1;
      else if (clean[cursor] === "}") depthCount -= 1;
      cursor += 1;
    }
    const body = clean.slice(open + 1, cursor - 1);
    if (selector.startsWith("@") && body.includes("{") && depth < 3) {
      out.push(...scanCss(body, depth + 1));
    } else {
      for (const { property, value } of parseDeclarations(body)) {
        out.push({ selector, property: property.toLowerCase(), value });
      }
    }
    index = cursor;
  }
  return out;
}

// ─── Colour ──────────────────────────────────────────────────────────────────

export interface ColorCandidate {
  readonly hex: string;
  readonly count: number;
  readonly sources: readonly string[];
  readonly extreme: boolean;
}

/** `#abc` / `#aabbcc` / `#aabbccdd` / `rgb()` / `rgba()` / `hsl()` / `hsla()`. */
function colorLiteralsIn(value: string): string[] {
  const out: string[] = [];
  const lower = value.toLowerCase();
  let index = 0;
  while (index < lower.length) {
    const char = lower[index];
    if (char === "#") {
      let end = index + 1;
      while (end < lower.length && /[0-9a-f]/.test(lower[end])) end += 1;
      if (end - index >= 4) out.push(lower.slice(index, end));
      index = end;
      continue;
    }
    if (char === "r" || char === "h") {
      const paren = lower.indexOf("(", index);
      const head = paren === -1 ? "" : lower.slice(index, paren);
      if (paren !== -1 && (head === "rgb" || head === "rgba" || head === "hsl" || head === "hsla")) {
        const close = lower.indexOf(")", paren);
        if (close !== -1 && close - paren < 64) {
          out.push(lower.slice(index, close + 1));
          index = close + 1;
          continue;
        }
      }
    }
    index += 1;
  }
  return out;
}

/** A colour literal as `#rrggbb`, or null when it is not resolvable here. */
export function normalizeColor(literal: string): string | null {
  const text = literal.trim().toLowerCase();
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && parseInt(hex[3] + hex[3], 16) < 52) return null;
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 6) return `#${hex}`;
    if (hex.length === 8) return parseInt(hex.slice(6), 16) < 52 ? null : `#${hex.slice(0, 6)}`;
    return null;
  }

  const paren = text.indexOf("(");
  if (paren === -1) return null;
  const fn = text.slice(0, paren);
  const parts = text
    .slice(paren + 1, text.lastIndexOf(")"))
    .split(/[\s,/]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]) * (parts[3].endsWith("%") ? 0.01 : 1);
  if (Number.isFinite(alpha) && alpha < 0.2) return null;

  if (fn === "rgb" || fn === "rgba") {
    const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    return [r, g, b].every(Number.isFinite) ? toHex([r, g, b]) : null;
  }
  if (fn === "hsl" || fn === "hsla") {
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    return [h, s, l].every(Number.isFinite) ? toHex(hslToRgb(h, s, l)) : null;
  }
  // oklch(), lab(), color(), named colours and var() are not resolved here.
  return null;
}

type Rgb = readonly [number, number, number];

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

function hslToRgb(hDeg: number, s: number, l: number): Rgb {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const table: Rgb[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sector];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255] as const;
}

/** Rec.709 relative luminance, 0…1. */
function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** HSL saturation, 0…1. One formula throughout — the reference had three. */
function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

function mix(a: string, b: string, ratio: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return toHex([ar + (br - ar) * ratio, ag + (bg - ag) * ratio, ab + (bb - ab) * ratio]);
}

/**
 * A source string worth rescuing a rare colour for.
 *
 * A brand's accent is often declared once, in one custom property, and used
 * through `var()` everywhere after — so pure frequency buries it under the
 * hundred greys of a utility framework. Naming is the signal that survives.
 */
function isHighSignal(source: string): boolean {
  return /^var:--(?!token-|framer-|tw-)[\w-]*(brand|primary|accent|cta|action|highlight|link)/.test(source);
}

/** Custom properties count for more than one-off declarations — see header. */
function weightFor(property: string): number {
  return property.startsWith("--") ? 3 : 1;
}

/** Frequency-ranked colours with provenance, most signal first. */
export function extractColors(declarations: readonly Declaration[]): ColorCandidate[] {
  const counts = new Map<string, { count: number; sources: Set<string> }>();
  for (const { selector, property, value } of declarations) {
    if (value.length > 400) continue;
    const source = property.startsWith("--")
      ? `var:${property}`
      : `prop:${property}${selector ? ` selector:${selector}` : ""}`;
    for (const literal of colorLiteralsIn(value)) {
      const hex = normalizeColor(literal);
      if (!hex) continue;
      const entry = counts.get(hex) ?? { count: 0, sources: new Set<string>() };
      entry.count += weightFor(property);
      if (entry.sources.size < 6) entry.sources.add(source.slice(0, 120));
      counts.set(hex, entry);
    }
  }

  const all: ColorCandidate[] = [...counts]
    .map(([hex, { count, sources }]) => {
      const light = luma(hex);
      return { hex, count, sources: [...sources], extreme: light > 0.96 || light < 0.04 };
    })
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));

  // Three slices, deduped in order: named brand colours first (however rare),
  // then the frequent chromatics, then a few extremes for bg/fg duty.
  const ranked = [
    ...all.filter((c) => !c.extreme && c.sources.some(isHighSignal)).slice(0, 8),
    ...all.filter((c) => !c.extreme).slice(0, 15),
    ...all.filter((c) => c.extreme).slice(0, 4),
  ];
  const seen = new Set<string>();
  const deduped: ColorCandidate[] = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.hex)) continue;
    seen.add(candidate.hex);
    deduped.push(candidate);
  }
  return deduped;
}

// ─── Type ────────────────────────────────────────────────────────────────────

export interface FontCandidate {
  readonly family: string;
  readonly count: number;
}

const GENERIC_FONTS = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "cursive",
  "fantasy",
  "inherit",
  "initial",
  "unset",
  "revert",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "arial",
  "helvetica",
  "helvetica neue",
  "times new roman",
  "courier new",
  "emoji",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "noto color emoji",
]);

const ICON_FONT = /\b(icons?|symbols?|fontawesome|awesome|glyph|remix|material icons|material symbols|lucide|icomoon|fontello|pictogram)\b/i;
const SERIF_HINT = /serif|playfair|tiempos|georgia|garamond|merriweather|lora|times|caslon|freight/i;
const MONO_HINT = /mono|consol|courier|menlo|code|jetbrains|fira code|source code/i;

function cleanFamily(part: string): string | null {
  const family = part.trim().replace(/^["']|["']$/g, "").trim();
  if (!family || family.startsWith("var(") || family.length > 60) return null;
  if (GENERIC_FONTS.has(family.toLowerCase())) return null;
  if (ICON_FONT.test(family)) return null;
  return family;
}

/**
 * Families in use, plus the families the page self-hosts.
 *
 * First non-generic entry in each stack wins and the rest of the stack is
 * dropped — a `font-family: Whatever, system-ui, sans-serif` declaration is one
 * vote for Whatever, not three votes for a system stack.
 */
export function extractFonts(declarations: readonly Declaration[]): {
  fonts: FontCandidate[];
  faceFamilies: string[];
} {
  const counts = new Map<string, number>();
  const faces = new Set<string>();
  for (const { selector, property, value } of declarations) {
    if (property !== "font-family" && !(property === "font" && value.includes(","))) continue;
    for (const part of value.split(",")) {
      const family = cleanFamily(part);
      if (!family) continue;
      if (selector.startsWith("@font-face")) faces.add(family);
      counts.set(family, (counts.get(family) ?? 0) + weightFor(property));
      break;
    }
  }
  return {
    fonts: [...counts]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
      .slice(0, 10),
    faceFamilies: [...faces].slice(0, 10),
  };
}

function fontStack(family: string): string {
  if (MONO_HINT.test(family)) return `"${family}", ui-monospace, Menlo, monospace`;
  if (SERIF_HINT.test(family)) return `"${family}", Georgia, serif`;
  return `"${family}", system-ui, -apple-system, sans-serif`;
}

// ─── Proposal ────────────────────────────────────────────────────────────────

export interface BrandExtraction {
  readonly url: string;
  /** The wizard's pre-fill: bare token names to CSS values. */
  readonly tokens: Record<string, string>;
  readonly colors: readonly ColorCandidate[];
  readonly fonts: readonly FontCandidate[];
  readonly themeColor: string | null;
  readonly stylesheets: readonly string[];
  /** What was inferred rather than measured, in the reviewer's words. */
  readonly notes: readonly string[];
}

/**
 * Colours and families → the eight tokens the wizard requires, plus mono.
 *
 * Backgrounds and foregrounds are picked by luminance against the page's own
 * count-weighted cast (a dark site's background is its most-used near-black,
 * not white), and `--surface` / `--muted` / `--border` are *blends* of the two
 * rather than separate measurements — a page publishes those as
 * near-indistinguishable greys that rank badly, and a blend of two measured
 * ends is more honest than a third weak measurement.
 */
export function proposeTokens(
  colors: readonly ColorCandidate[],
  fonts: readonly FontCandidate[],
  faceFamilies: readonly string[],
  themeColor: string | null,
): { tokens: Record<string, string>; notes: string[] } {
  const notes: string[] = [];
  const total = colors.reduce((sum, c) => sum + c.count, 0);
  const meanLuma = total > 0 ? colors.reduce((sum, c) => sum + luma(c.hex) * c.count, 0) / total : 1;
  const darkCast = meanLuma < 0.45;

  const byCount = [...colors].sort((a, b) => b.count - a.count);
  const pick = (test: (light: number) => boolean): string | null =>
    byCount.find((c) => test(luma(c.hex)))?.hex ?? null;

  const measuredBg = darkCast ? pick((l) => l <= 0.12) : pick((l) => l >= 0.9);
  const measuredFg = darkCast ? pick((l) => l >= 0.85) : pick((l) => l <= 0.25);
  const bg = measuredBg ?? (darkCast ? "#111111" : "#ffffff");
  const fg = measuredFg ?? (darkCast ? "#f4f4f4" : "#1a1a18");
  if (!measuredBg || !measuredFg) {
    notes.push("The page did not publish a clear background/text pair; the neutral ends are inferred from its overall lightness.");
  }

  const chromatic = byCount.filter((c) => {
    const l = luma(c.hex);
    return saturation(c.hex) >= 0.18 && l > 0.08 && l < 0.95;
  });
  const vivid = chromatic.filter((c) => {
    const l = luma(c.hex);
    return saturation(c.hex) >= 0.32 && l >= 0.22 && l <= 0.8;
  });
  const declared = themeColor ? normalizeColor(themeColor) : null;
  let accent: string;
  if (declared && saturation(declared) >= 0.18) {
    accent = declared;
    notes.push(`Accent taken from the page's declared <meta name="theme-color"> (${declared}).`);
  } else if (vivid[0] || chromatic[0]) {
    accent = (vivid[0] ?? chromatic[0]).hex;
  } else {
    accent = fg;
    notes.push("No chromatic colour was measured on the page; the accent falls back to the text colour. Pick one by hand.");
  }

  const tokens: Record<string, string> = {
    bg,
    surface: mix(bg, fg, 0.06),
    fg,
    "fg-2": mix(fg, bg, 0.2),
    muted: mix(fg, bg, 0.45),
    border: mix(bg, fg, 0.12),
    accent,
    "accent-on": luma(accent) > 0.6 ? "#111111" : "#ffffff",
  };

  const families = [...new Set([...fonts.map((f) => f.family), ...faceFamilies])];
  const mono = families.find((f) => MONO_HINT.test(f)) ?? null;
  const nonMono = families.filter((f) => f !== mono);
  const serif = nonMono.find((f) => SERIF_HINT.test(f)) ?? null;
  const display = serif ?? nonMono[0] ?? null;
  const body = nonMono.find((f) => f !== display) ?? display;
  if (display) tokens["font-display"] = fontStack(display);
  if (body) tokens["font-body"] = fontStack(body);
  if (mono) tokens["font-mono"] = fontStack(mono);
  if (!display) {
    notes.push("No non-generic font family was declared; the system stack applies until you name one.");
    tokens["font-display"] = "system-ui, -apple-system, sans-serif";
    tokens["font-body"] = "system-ui, -apple-system, sans-serif";
  }

  notes.push(
    "Radius, spacing, elevation and motion are not measured from a live page — the created package fills them from design-systems/_schema/defaults.css.",
  );
  notes.push(
    "Counts are declaration counts, not on-screen frequency: a static fetch cannot see which rules actually matched. Custom properties are weighted 3× to compensate.",
  );

  return { tokens, notes };
}

/** The whole measurement, network already done. Exported so tests need none. */
export function extractBrandTokens(html: string, url: string, linkedCss = ""): BrandExtraction {
  const page = scanHtml(html, url);
  const declarations = [...scanCss(page.css), ...scanCss(linkedCss)];
  const colors = extractColors(declarations);
  const { fonts, faceFamilies } = extractFonts(declarations);
  const { tokens, notes } = proposeTokens(colors, fonts, faceFamilies, page.themeColor);
  return {
    url,
    tokens,
    colors: colors.slice(0, 18),
    fonts,
    themeColor: page.themeColor,
    stylesheets: page.stylesheets,
    notes,
  };
}

// ─── Fetching ────────────────────────────────────────────────────────────────

/**
 * Whether the daemon is allowed to fetch this URL.
 *
 * The daemon binds to localhost and the URL is user-typed, so this is not a
 * classic SSRF surface — but "paste a URL" is still the one place a remote
 * page's content decides what the daemon reaches for next (linked
 * stylesheets, redirect targets), so the check runs on every hop. Lexical host
 * matching only: it will not stop a hostname that resolves to a private
 * address. ponytail: DNS-resolution pinning is the upgrade if this route ever
 * runs anywhere but a user's own machine.
 */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "0.0.0.0" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("169.254.")) {
    return false;
  }
  if (host.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return true;
}

/** Read at most `MAX_BYTES`, then stop pulling. A lying Content-Length cannot help. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

/** One resource, following at most `MAX_REDIRECTS` hops, each re-checked. */
async function fetchResource(
  start: string,
  signal: AbortSignal,
): Promise<{ body: string; finalUrl: string } | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isFetchableUrl(current)) return null;
    const response = await fetch(current, { redirect: "manual", signal }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = absoluteUrl(response.headers.get("location") ?? undefined, current);
      await response.body?.cancel().catch(() => {});
      if (!next) return null;
      current = next;
      continue;
    }
    if (!response.ok) return null;
    return { body: await readCapped(response), finalUrl: current };
  }
  return null;
}

const extractSchema = z.object({ url: z.string().url().max(2000) });

export async function POST(request: Request): Promise<Response> {
  const validation = await validateBody(request, extractSchema);
  if (!validation.success) return validation.error;

  const { url } = validation.data;
  if (!isFetchableUrl(url)) {
    return NextResponse.json(
      { error: "Only public http(s) URLs can be read — loopback and private-network hosts are refused." },
      { status: 400 },
    );
  }

  // One budget for the page and every stylesheet under it, so a slow site
  // cannot hold the request open four times over.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const page = await fetchResource(url, signal).catch(() => null);
  if (!page) {
    return NextResponse.json(
      { error: `Could not read ${url} — it did not answer in time, refused the request, or redirected somewhere unreadable.` },
      { status: 502 },
    );
  }

  const { stylesheets } = scanHtml(page.body, page.finalUrl);
  const sheets: string[] = [];
  const skipped: string[] = [];
  for (const href of stylesheets) {
    const sheet = await fetchResource(href, signal).catch(() => null);
    if (sheet) sheets.push(sheet.body);
    else skipped.push(href);
  }

  const extraction = extractBrandTokens(page.body, page.finalUrl, sheets.join("\n"));
  const notes = [...extraction.notes];
  if (skipped.length > 0) notes.push(`${skipped.length} linked stylesheet(s) could not be read and were skipped.`);
  if (page.finalUrl !== url) notes.push(`Followed a redirect to ${page.finalUrl}.`);

  return NextResponse.json({ ...extraction, notes });
}
