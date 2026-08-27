/**
 * In-repo project knowledge — `.ligma/` committed into the *target* repo
 * (twin-primitives §2). Human-editable, system-maintained, travels with the code.
 *
 * `boot.json` is the boot recipe: it generalizes what used to be a hardcoded
 * TargetAdapter into data, so any repo carrying a valid one gets an ephemeral
 * env. Commands are argv arrays, never shell strings — nothing here is ever
 * parsed out of free text (build brief §8).
 */

import type { Journey } from './journeys';

/** How the booted dev server learns which port to listen on. */
export type PortStrategy =
  /** Append `[flag, "<port>"]` to the dev argv (e.g. `-p 4173`). */
  | { kind: 'flag'; flag: string }
  /** Set `<var>=<port>` in the child's environment. */
  | { kind: 'env'; var: string }
  /** The command already knows its port; the env just records which one. */
  | { kind: 'fixed'; port: number };

interface BootCommon {
  /** Repo-relative directory the commands run in. "." for the repo root. */
  appDir: string;
  /** Dependency install, or null when the repo needs none. */
  install: string[] | null;
}

/** A product that serves something. The env boots it and polls it healthy. */
export interface ServerBootRecipe extends BootCommon {
  /** The long-running dev server. Must not daemonize itself. */
  dev: string[];
  portStrategy: PortStrategy;
  /** Path fetched for the health check, e.g. "/". */
  healthPath: string;
  /** Text that must appear in the health response — proof of HTML, not a shell. */
  healthMarker: string;
  /** Deterministic fixture load, or null when the product needs no seed. */
  seed: string[] | null;
}

/**
 * A project that is not a running program: a paper, a document repo, a library
 * with no UI. It declares what it PRODUCES, and the env is just a worktree —
 * no port, no dev server, no health poll (execution-flow review H5).
 */
export interface ArtifactBootRecipe extends BootCommon {
  /** Nothing to boot. This is the discriminant. */
  dev: null;
  /** Globs naming the deliverables the panel reads and cites. Never empty. */
  artifacts: string[];
  /** The only command the fs bridge may run — a test or a build — or null. */
  check: string[] | null;
}

export type BootRecipe = ServerBootRecipe | ArtifactBootRecipe;

/** Narrow a recipe to the artifact kind. `dev === null` is the whole test. */
export function isArtifactBoot(boot: BootRecipe): boot is ArtifactBootRecipe {
  return boot.dev === null;
}

export type BootStatus = 'missing' | 'invalid' | 'ready';

/** What the Knowledge tab renders: the whole `.ligma/` directory, resolved. */
export interface ProjectKnowledge {
  projectId: string;
  repoPath: string | null;
  bootStatus: BootStatus;
  boot: BootRecipe | null;
  /** Why `bootStatus` is not "ready". null when it is. */
  bootError: string | null;
  /** `.ligma/project.md`, verbatim. Empty string when absent. */
  projectMd: string;
  /**
   * The body of `project.md`'s conventional `## Quirks` section, verbatim and
   * without its heading. Empty when the section does not exist.
   *
   * This is a *heading-scoped slice of a document whose structure we define* —
   * the daemon writes the heading, so finding it is addressing a known
   * container, not guessing meaning out of prose. Everything inside it is
   * rendered as-is; nothing is parsed out of the text itself.
   */
  quirks: string;
  journeys: Journey[];
  /** Journey files that failed validation, with the reason — never silently hidden. */
  invalidJourneys: Array<{ file: string; error: string }>;
}

export interface KnowledgeAppendRequest {
  /** Markdown appended to `.ligma/project.md` under a timestamped heading. */
  note: string;
  /** Who learned it — "human" or a run id. */
  source?: string;
  /**
   * Append into the conventional `## Quirks` section instead of a new dated
   * one, creating the section when it is absent. This is what makes quirks a
   * thing the product maintains rather than a heading a human has to remember.
   */
  section?: 'quirks';
}
