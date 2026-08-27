/**
 * ligma-dir.ts — typed IO for `.ligma/`, the knowledge directory committed into
 * an adopted repo (twin-primitives §2).
 *
 *   <repoPath>/.ligma/boot.json        the boot recipe
 *   <repoPath>/.ligma/journeys/*.json  one journey per file
 *   <repoPath>/.ligma/project.md       architecture notes, conventions, quirks
 *
 * Everything here is IN the target repo and therefore readable by the builder —
 * deliberately. The verification-sensitive half (baselines, probes) lives
 * centrally in `harness/baselines.ts` and is denied to builder spawns.
 *
 * Zod validates on the way in AND on the way out: a hand-edited boot.json is a
 * normal thing for a human to do, and a malformed one must be reported as
 * "invalid recipe", never crash a run half way through booting an env.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BootRecipe, Journey, ProjectKnowledge } from '@ligma/api';
import { z } from 'zod';

export const LIGMA_DIR_NAME = '.ligma';

/** Journey ids are filenames. No separators, no dots, no surprises. */
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// ─── Schemas ─────────────────────────────────────────────────────────────────

/** An argv array. Never a shell string: nothing here is ever word-split. */
const argvSchema = z.array(z.string().min(1)).min(1).max(32);

const portStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flag'), flag: z.string().min(1).max(32) }),
  z.object({ kind: z.literal('env'), var: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
  z.object({ kind: z.literal('fixed'), port: z.number().int().min(1).max(65535) }),
]);

const bootCommon = {
  appDir: z.string().max(200).default('.'),
  install: argvSchema.nullable().default(null),
};

/** A product that serves something: the recipe boots it and polls it healthy. */
export const serverBootSchema = z.object({
  ...bootCommon,
  dev: argvSchema,
  portStrategy: portStrategySchema,
  healthPath: z.string().startsWith('/').max(200).default('/'),
  healthMarker: z.string().min(1).max(200),
  seed: argvSchema.nullable().default(null),
});

/**
 * A project that is not a running program — a paper, a spec, a document repo, a
 * library with no UI (H5). It declares WHAT it produces instead of how to serve
 * it, plus at most one command the harness may run to check it. Demanding a dev
 * server here is what made a markdown+python research repo fabricate an HTTP
 * endpoint so it could be verified at all.
 */
export const artifactBootSchema = z.object({
  ...bootCommon,
  dev: z.null(),
  /** Globs naming the deliverables. Non-empty: an artifact project with no artifact is not one. */
  artifacts: z.array(z.string().min(1).max(200)).min(1).max(64),
  /** The ONE command the fs bridge may run (a test, a build). Never caller-supplied. */
  check: argvSchema.nullable().default(null),
});

/** `dev: null` is the whole discriminant — nothing to boot means nothing to serve. */
export const bootRecipeSchema = z.union([serverBootSchema, artifactBootSchema]);

export const journeySchema = z.object({
  id: z.string().regex(SAFE_ID, 'journey id must be [A-Za-z0-9][A-Za-z0-9_-]*'),
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  steps: z.array(z.string().min(1).max(500)).max(40).default([]),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  origin: z.enum(['human', 'discovery']),
  schedule: z.string().max(100).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** The shape a caller may hand to `writeJourney` — timestamps are ours. */
export const journeyInputSchema = journeySchema
  .omit({ createdAt: true, updatedAt: true })
  .partial({ id: true });
export type JourneyInput = z.input<typeof journeyInputSchema>;

/**
 * A partial edit. Written out rather than derived with `.partial()`: a field
 * carrying `.default([])` still materializes its default when the key is
 * absent, so a PATCH of the title alone silently emptied the steps.
 */
export const journeyPatchSchema = z.object({
  title: journeySchema.shape.title.optional(),
  goal: journeySchema.shape.goal.optional(),
  steps: z.array(z.string().min(1).max(500)).max(40).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  origin: journeySchema.shape.origin.optional(),
  schedule: z.string().max(100).nullable().optional(),
});

// ─── Paths ───────────────────────────────────────────────────────────────────

export function ligmaDir(repoPath: string): string {
  return path.join(repoPath, LIGMA_DIR_NAME);
}

export function bootPath(repoPath: string): string {
  return path.join(ligmaDir(repoPath), 'boot.json');
}

export function journeysDir(repoPath: string): string {
  return path.join(ligmaDir(repoPath), 'journeys');
}

export function projectMdPath(repoPath: string): string {
  return path.join(ligmaDir(repoPath), 'project.md');
}

function journeyPath(repoPath: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe journey id: ${id}`);
  return path.join(journeysDir(repoPath), `${id}.json`);
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

// ─── boot.json ───────────────────────────────────────────────────────────────

export type BootRead =
  | { status: 'ready'; boot: BootRecipe; error: null }
  | { status: 'missing'; boot: null; error: null }
  | { status: 'invalid'; boot: null; error: string };

/**
 * Read and validate the boot recipe. Never throws: a repo with no `.ligma/` is
 * the normal state before adoption, and a broken recipe is a fact to render,
 * not an exception to swallow somewhere else.
 */
export function readBoot(repoPath: string): BootRead {
  const file = bootPath(repoPath);
  if (!existsSync(file)) return { status: 'missing', boot: null, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    return { status: 'invalid', boot: null, error: `${file} is not valid JSON: ${message(err)}` };
  }
  const parsed = bootRecipeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', boot: null, error: `${file}: ${issues(parsed.error)}` };
  }
  return { status: 'ready', boot: parsed.data, error: null };
}

/** Validate and write. Throws on an invalid recipe — we never persist garbage. */
export function writeBoot(repoPath: string, boot: unknown): BootRecipe {
  const parsed = bootRecipeSchema.parse(boot);
  writeJson(bootPath(repoPath), parsed);
  return parsed;
}

// ─── journeys ────────────────────────────────────────────────────────────────

export interface JourneyRead {
  journeys: Journey[];
  /** Files that exist but do not validate — surfaced, never silently dropped. */
  invalid: Array<{ file: string; error: string }>;
}

export function listJourneys(repoPath: string): JourneyRead {
  const dir = journeysDir(repoPath);
  if (!existsSync(dir)) return { journeys: [], invalid: [] };

  const out: JourneyRead = { journeys: [], invalid: [] };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const parsed = journeySchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
      if (parsed.success) out.journeys.push(parsed.data);
      else out.invalid.push({ file: name, error: issues(parsed.error) });
    } catch (err) {
      out.invalid.push({ file: name, error: message(err) });
    }
  }
  return out;
}

export function readJourney(repoPath: string, id: string): Journey | null {
  return listJourneys(repoPath).journeys.find((j) => j.id === id) ?? null;
}

/** Turn a title into a stable, filename-safe journey id. */
export function journeyIdFrom(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `jrn_${slug || Date.now().toString(36)}`;
}

/**
 * Create or update one journey file. `createdAt` survives an update; both
 * timestamps are stamped here so a hand-edited file cannot lie about its age.
 */
export function writeJourney(repoPath: string, input: JourneyInput): Journey {
  const base = journeyInputSchema.parse(input);
  const id = base.id ?? journeyIdFrom(base.title);
  const now = new Date().toISOString();
  const existing = readJourney(repoPath, id);
  const journey = journeySchema.parse({
    ...base,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  writeJson(journeyPath(repoPath, id), journey);
  return journey;
}

export function deleteJourney(repoPath: string, id: string): boolean {
  const file = journeyPath(repoPath, id);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// ─── project.md ──────────────────────────────────────────────────────────────

export function readProjectMd(repoPath: string): string {
  const file = projectMdPath(repoPath);
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}

/** Append a dated note. This is how a run teaches the project something. */
export function appendProjectMd(repoPath: string, note: string, source = 'human'): string {
  const file = projectMdPath(repoPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = readProjectMd(repoPath);
  const entry = `\n## ${new Date().toISOString()} — ${source}\n\n${note.trim()}\n`;
  const next = existing ? `${existing.replace(/\s+$/, '')}\n${entry}` : `# Project notes\n${entry}`;
  writeFileSync(file, next, 'utf-8');
  return next;
}

// ─── Quirks ──────────────────────────────────────────────────────────────────

/**
 * `project.md`'s one conventional section (UX spec §6 Knowledge: "quirks").
 *
 * The things about this codebase that will surprise whoever touches it next —
 * an adoption crawl's confusion log, a builder's "the dev server needs two
 * starts", a human's "never run the seed twice".
 *
 * Finding it is **addressing a container the daemon itself writes**, not reading
 * meaning out of prose: we own the heading, so a heading-scoped slice is
 * structure. Everything inside is rendered verbatim; nothing is parsed from it.
 */
export const QUIRKS_HEADING = '## Quirks';

const QUIRKS_RE = /^##\s+quirks\s*$/i;
const HEADING_RE = /^#{1,2}\s+/;

/** Line bounds of the Quirks section body, or null when there is no section. */
function quirksBounds(lines: string[]): { heading: number; end: number } | null {
  const heading = lines.findIndex((line) => QUIRKS_RE.test(line));
  if (heading === -1) return null;
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { heading, end };
}

/** The Quirks section body, without its heading. Empty when there is none. */
export function readQuirks(repoPath: string): string {
  const lines = readProjectMd(repoPath).split('\n');
  const bounds = quirksBounds(lines);
  if (!bounds) return '';
  return lines
    .slice(bounds.heading + 1, bounds.end)
    .join('\n')
    .trim();
}

/**
 * Add one quirk, under the conventional heading, creating the section when this
 * repo has never recorded one. Returns the whole file, as `appendProjectMd`
 * does, so a caller can render the result without a second read.
 */
export function appendQuirk(repoPath: string, note: string, source = 'human'): string {
  const file = projectMdPath(repoPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = readProjectMd(repoPath);
  const entry = `### ${new Date().toISOString()} — ${source}\n\n${note.trim()}`;

  const lines = existing.split('\n');
  const bounds = quirksBounds(lines);
  const next = bounds
    ? // Inside the section, at its end — so the newest quirk sits under the
      // ones before it rather than displacing the section's own preamble.
      [
        ...lines.slice(0, bounds.end).join('\n').replace(/\s+$/, '').split('\n'),
        '',
        entry,
        '',
        ...lines.slice(bounds.end),
      ]
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    : `${(existing || '# Project notes').replace(/\s+$/, '')}\n\n${QUIRKS_HEADING}\n\n${entry}\n`;

  const body = next.endsWith('\n') ? next : `${next}\n`;
  writeFileSync(file, body, 'utf-8');
  return body;
}

// ─── Rendered view ───────────────────────────────────────────────────────────

/** Everything the Knowledge tab shows for one project, in one read. */
export function readKnowledge(projectId: string, repoPath: string | null): ProjectKnowledge {
  if (!repoPath) {
    return {
      projectId,
      repoPath: null,
      bootStatus: 'missing',
      boot: null,
      bootError: null,
      projectMd: '',
      quirks: '',
      journeys: [],
      invalidJourneys: [],
    };
  }
  const boot = readBoot(repoPath);
  const { journeys, invalid } = listJourneys(repoPath);
  return {
    projectId,
    repoPath,
    bootStatus: boot.status,
    boot: boot.boot,
    bootError: boot.error,
    projectMd: readProjectMd(repoPath),
    quirks: readQuirks(repoPath),
    journeys,
    invalidJourneys: invalid,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function issues(err: z.ZodError): string {
  // A union's own issue says only "Invalid input"; the reason a human needs is
  // one level down, in each branch's issues. boot.json is hand-edited, so the
  // message must still name the field that is wrong.
  return err.issues
    .flatMap((i) => (i.code === 'invalid_union' ? i.errors.flat() : [i]))
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
