/**
 * The design-system wizard's shared half: what a proposed token set must look
 * like, and how one becomes a real package on disk.
 *
 * The wizard writes *the same triad the catalog already reads* —
 * `manifest.json`, `DESIGN.md`, `tokens.css` — so a created system is served,
 * previewed, picked and used by the existing routes (OD-010). What changed on
 * 2026-08-13 is only *where*: authored packages land in
 * `<DATA_DIR>/design-systems`, and the catalog reads the two roots as one
 * overlay rather than the wizard writing into the vendored checkout.
 *
 * Two properties this file exists to hold:
 *
 *   - **The id is never caller-controlled path text.** It is slugified, then
 *     checked against the same `isSafeSegment` the catalog uses, then joined.
 *   - **A vendored package is never writable.** Only a directory whose own
 *     manifest carries `authored: true` may be overwritten, and only when the
 *     caller asks for it. Everything else is a 409.
 */

import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { REPO_ROOT } from "../../../paths";
import { isSafeSegment } from "../../verification-runs/_lib";

/**
 * A proposed token set: bare custom-property names (no `--`) to CSS values.
 * The same vocabulary `tokens.css` carries — see `design-systems/_schema/`.
 */
export type WizardTokens = Readonly<Record<string, string>>;

/**
 * The tokens a package must declare to be usable.
 *
 * Exactly the catalog's swatch strip plus the two families the specimen
 * renderer reads. Anything beyond this is optional: a system may be as thin as
 * a palette and two fonts, and the A2 fill below completes it.
 */
export const REQUIRED_TOKENS = [
  "bg",
  "surface",
  "fg",
  "muted",
  "border",
  "accent",
  "font-display",
  "font-body",
] as const;

const TOKEN_NAME = /^[a-z][a-z0-9-]*$/;
const MAX_TOKENS = 200;
const MAX_VALUE_LENGTH = 240;

/**
 * Characters a token value may not contain.
 *
 * A token value is pasted into a `:root { … }` block that the Library renders
 * inside a `<style>` in a preview iframe. `;` `{` `}` would end the declaration
 * early; `<` could close the style element. This is the trust boundary — the
 * value arrives over HTTP from a form the user typed into, or from a *remote
 * page's* CSS via brand extraction, which is not the user at all.
 */
const FORBIDDEN_VALUE_CHARS = /[;{}<>\r\n]/;

export interface TokenValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** Structural check on a proposed token set. Says nothing about aesthetics. */
export function validateTokens(tokens: unknown): TokenValidation {
  const errors: string[] = [];
  if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) {
    return { ok: false, errors: ["tokens must be an object of name → CSS value"] };
  }

  const entries = Object.entries(tokens as Record<string, unknown>);
  if (entries.length === 0) errors.push("tokens must not be empty");
  if (entries.length > MAX_TOKENS) errors.push(`tokens must declare at most ${MAX_TOKENS} properties`);

  for (const [name, value] of entries) {
    if (!TOKEN_NAME.test(name)) {
      errors.push(`token "${name}" is not a valid custom-property name (lowercase, digits, dashes, no leading --)`);
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`token "--${name}" must be a non-empty string`);
      continue;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      errors.push(`token "--${name}" is longer than ${MAX_VALUE_LENGTH} characters`);
      continue;
    }
    if (FORBIDDEN_VALUE_CHARS.test(value)) {
      errors.push(`token "--${name}" contains a character that would break out of the declaration (; { } < > newline)`);
    }
  }

  for (const required of REQUIRED_TOKENS) {
    if (typeof (tokens as Record<string, unknown>)[required] !== "string") {
      errors.push(`token "--${required}" is required`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── CSS scanning shared with brand extraction ───────────────────────────────

/** Drop `/* … *&#47;` comments so a declaration scan never reads commented-out CSS. */
export function stripCssComments(css: string): string {
  let out = "";
  let index = 0;
  for (;;) {
    const start = css.indexOf("/*", index);
    if (start === -1) return out + css.slice(index);
    out += css.slice(index, start);
    const end = css.indexOf("*/", start + 2);
    if (end === -1) return out;
    index = end + 2;
  }
}

export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * Every `property: value` pair inside a declaration body, in source order.
 *
 * A declaration-level scanner rather than a full CSS parser: it splits on the
 * top-level `;` and the first `:`, which is all a token file or a rule body is.
 * ponytail: no CSS tokenizer exists in the daemon's dependency tree (no
 * postcss, no css-tree — checked), and adding one to read `name: value` pairs
 * would be a dependency for twenty lines. Ceiling: this does not understand
 * nested at-rules or `;` inside a quoted string. Swap in css-tree the day a
 * token value legitimately needs either.
 */
export function parseDeclarations(body: string): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  for (const chunk of stripCssComments(body).split(";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const property = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    if (property.length === 0 || value.length === 0) continue;
    out.push({ property, value });
  }
  return out;
}

/** The custom properties declared in the first `:root { … }` block. */
export function parseRootCustomProperties(css: string): Record<string, string> {
  const clean = stripCssComments(css);
  const start = clean.indexOf(":root");
  if (start === -1) return {};
  const open = clean.indexOf("{", start);
  if (open === -1) return {};
  const close = clean.indexOf("}", open);
  if (close === -1) return {};
  const out: Record<string, string> = {};
  for (const { property, value } of parseDeclarations(clean.slice(open + 1, close))) {
    if (property.startsWith("--")) out[property.slice(2)] = value;
  }
  return out;
}

/**
 * The A2 fallbacks from `design-systems/_schema/defaults.css`.
 *
 * That file exists to be exactly this input ("the future input to the derive
 * script … when a brand's DESIGN.md does not specify an A2 token, the script
 * copies the declaration from this file"). Reusing it means a wizard-created
 * package ships the same radius / spacing / elevation / motion scale every
 * vendored package does, without a second copy of those values living here.
 *
 * Read from the repo (not from an overridden catalog root): the schema is the
 * repo's contract, not a property of whichever directory is being written to.
 * Missing or unreadable → no fill, never an error.
 */
export async function schemaDefaults(): Promise<Record<string, string>> {
  try {
    const css = await readFile(path.join(REPO_ROOT, "design-systems", "_schema", "defaults.css"), "utf-8");
    return parseRootCustomProperties(css);
  } catch {
    return {};
  }
}

// ─── Identity ────────────────────────────────────────────────────────────────

/** A display name reduced to a directory slug: `My Brand 2!` → `my-brand-2`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Drop the combining marks NFKD just split off, so "Ünï" slugs to "uni"
    // rather than to "u-ni". Mirrored in apps/web/src/runtime/brand-tokens.ts.
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Whether `id` may name a design-system directory in either root.
 *
 * `isSafeSegment` is the catalog's own rule (no separators, no dots), narrowed
 * to the manifest schema's slug shape so the manifest we write validates
 * against `_schema/manifest.schema.ts`. `_`-prefixed names are the schema's,
 * and the catalog listing skips them.
 */
export function isValidSystemId(id: string): boolean {
  return isSafeSegment(id) && /^[a-z0-9][a-z0-9-]*$/.test(id) && id.length <= 48;
}

// ─── Package writing ─────────────────────────────────────────────────────────

export interface CreatePackageInput {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly blurb: string;
  readonly tokens: WizardTokens;
  /** Where the tokens came from, for the manifest and DESIGN.md provenance. */
  readonly sourceUrl?: string;
}

/** What existed at `design-systems/<id>` before the wizard was asked to write. */
export type Occupant = { readonly kind: "free" } | { readonly kind: "authored" } | { readonly kind: "vendored" };

/**
 * Classify an existing directory.
 *
 * `authored: true` in the manifest is the only thing that makes a package
 * writable. A directory that exists but has no readable manifest counts as
 * vendored — the safe answer, because a `DESIGN.md`-only legacy folder is still
 * somebody's, and so is a directory the wizard does not recognise at all.
 */
export async function occupantOf(root: string, id: string): Promise<Occupant> {
  const dir = path.join(root, id);
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return { kind: "vendored" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "free" };
    return { kind: "vendored" };
  }
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf-8")) as {
      authored?: unknown;
    };
    return manifest.authored === true ? { kind: "authored" } : { kind: "vendored" };
  } catch {
    return { kind: "vendored" };
  }
}

/** `tokens.css` — the `:root` block, schema defaults filled in behind it. */
export function renderTokensCss(input: CreatePackageInput, defaults: Record<string, string>): string {
  const authored = Object.entries(input.tokens);
  const filled = Object.entries(defaults).filter(([name]) => !(name in input.tokens));
  const lines = [
    "/* ─────────────────────────────────────────────────────────────────────────",
    ` * design-systems/${input.id}/tokens.css`,
    " *",
    ` * ${input.name} — created with the Ligma design-system wizard.`,
    input.sourceUrl ? ` * Tokens proposed from ${input.sourceUrl}, then reviewed by hand.` : " * Tokens authored by hand.",
    " *",
    " * The first block is what the author declared. The second is filled from",
    " * design-systems/_schema/defaults.css: the shared A2 fallbacks (radius,",
    " * spacing, elevation, motion) that a live site does not publish and a",
    " * from-scratch author should not have to invent. Override any of them by",
    " * declaring the token above and re-creating the system.",
    " * ─────────────────────────────────────────────────────────────────── */",
    "",
    ":root {",
    "  /* ─── Authored ─────────────────────────────────────────────────── */",
    ...authored.map(([name, value]) => `  --${name}: ${value};`),
  ];
  if (filled.length > 0) {
    lines.push("", "  /* ─── Filled from _schema/defaults.css ──────────────────────────── */");
    lines.push(...filled.map(([name, value]) => `  --${name}: ${value};`));
  }
  lines.push("}", "");
  return lines.join("\n");
}

/**
 * `DESIGN.md` — the prose the generation agent is handed.
 *
 * The header follows the vendored convention exactly (`#` title, then a
 * blockquote whose first line is `Category:`), because `parseDesignHeader` in
 * the catalog route reads the category and blurb straight out of it.
 */
export function renderDesignMd(input: CreatePackageInput): string {
  const color = Object.entries(input.tokens).filter(([name]) => !name.startsWith("font-"));
  const type = Object.entries(input.tokens).filter(([name]) => name.startsWith("font-"));
  return [
    `# Design System — ${input.name}`,
    "",
    `> Category: ${input.category}`,
    `> ${input.blurb}`,
    "",
    "## 1. Visual Theme & Atmosphere",
    "",
    input.blurb,
    "",
    input.sourceUrl
      ? `Tokens were measured from ${input.sourceUrl} and then reviewed by hand. Anything the site did not publish — radius, spacing, elevation, motion — comes from the shared schema defaults, not from the site.`
      : "Tokens were authored by hand in the wizard. Anything not declared here comes from the shared schema defaults.",
    "",
    "## 2. Color",
    "",
    ...color.map(([name, value]) => `- **\`--${name}\`** — \`${value}\``),
    "",
    "## 3. Typography",
    "",
    ...(type.length > 0
      ? type.map(([name, value]) => `- **\`--${name}\`** — \`${value}\``)
      : ["- No families declared; the schema fallbacks apply."]),
    "",
    "## 4. Revising this system",
    "",
    "This package is user-authored (`\"authored\": true` in `manifest.json`). Re-running the wizard with the same name **overwrites these files in place** — the vendored package format carries no version field, so there is nothing to bump and no previous revision is kept. Copy the directory first if you want the old one back.",
    "",
    "Vendored systems are never overwritten by the wizard, whatever name is submitted.",
    "",
  ].join("\n");
}

/** `manifest.json` — the v1 project manifest, plus the `authored` marker. */
export function renderManifest(input: CreatePackageInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: "od-design-system-project/v1",
      id: input.id,
      name: input.name,
      category: input.category,
      description: input.blurb,
      // `authored` is the wizard's marker: it is what makes this package
      // distinguishable from a vendored one, and what makes it overwritable.
      // HANDOFF: `design-systems/_schema/manifest.schema.ts` rejects unknown
      // top-level keys, so `"authored"` needs adding to ALLOWED_TOP_LEVEL_KEYS
      // and to DesignSystemProjectManifest. Nothing validates manifests at read
      // time today, so no runtime path is affected until that lands.
      authored: true,
      source: input.sourceUrl
        ? { type: "local", path: input.sourceUrl, importedAt: new Date().toISOString() }
        : { type: "local", path: "ligma-design-system-wizard", importedAt: new Date().toISOString() },
      files: { design: "DESIGN.md", tokens: "tokens.css" },
      importMode: "normalized",
      craft: { applies: [], suggested: ["color", "accessibility-baseline"], exemptions: [] },
    },
    null,
    2,
  )}\n`;
}

/** Write the triad. The caller has already decided the id is free or writable. */
export async function writePackage(root: string, input: CreatePackageInput): Promise<string[]> {
  const dir = path.join(root, input.id);
  await mkdir(dir, { recursive: true });
  const defaults = await schemaDefaults();
  const files: Array<[string, string]> = [
    ["manifest.json", renderManifest(input)],
    ["DESIGN.md", renderDesignMd(input)],
    ["tokens.css", renderTokensCss(input, defaults)],
  ];
  for (const [file, contents] of files) await writeFile(path.join(dir, file), contents, "utf-8");
  return files.map(([file]) => file);
}
