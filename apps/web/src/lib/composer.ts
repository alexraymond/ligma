/**
 * The Home kickoff composer's model (UX spec F1 step 1) — open-design's hero
 * pattern: one prompt box, optional chips, and **required-input gating that
 * names the missing field before submit** rather than failing after it.
 *
 * Prompt-first is the pinned product default (build brief §2); adopting a repo
 * is a chip on the same composer, not a second front door.
 *
 * Pure and DOM-free so the gate is unit-testable — the component renders this,
 * it does not re-decide it.
 */

export type ComposerMode = 'prompt' | 'adopt';

/** The project-kind chips. Free text is still allowed — a chip is a shortcut. */
export const PROJECT_KINDS = [
  'Web app',
  'API service',
  'CLI tool',
  'Library',
  'Automation',
] as const;

export interface ComposerState {
  mode: ComposerMode;
  prompt: string;
  /** A `PROJECT_KINDS` entry, or null when the user picked none. */
  kind: string | null;
  /** Absolute path to an existing repo. Only read in `adopt` mode. */
  repoPath: string;
  /**
   * Optional, user-typed project name. Left blank, the daemon names the
   * project from the prompt itself until the promote planner proposes a real
   * title — never the whole prompt verbatim.
   */
  name: string;
}

export const EMPTY_COMPOSER: ComposerState = {
  mode: 'prompt',
  prompt: '',
  kind: null,
  repoPath: '',
  name: '',
};

export interface ComposerGate {
  ok: boolean;
  /**
   * What to tell the user *before* they press the button — the field's own name
   * and what it wants, never a generic "invalid input".
   */
  missing: string | null;
}

/**
 * The gate. One rule per mode, and every failure names its field.
 *
 * A relative repo path is rejected here rather than at the daemon because the
 * daemon resolves paths against its own cwd, which is not the user's — a
 * relative path that "works" would adopt a different directory than the one
 * they meant.
 */
export function gateComposer(state: ComposerState): ComposerGate {
  if (state.mode === 'adopt') {
    const repoPath = state.repoPath.trim();
    if (repoPath === '')
      return { ok: false, missing: 'Repo path — where the code you want to adopt lives' };
    if (!repoPath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(repoPath)) {
      return {
        ok: false,
        missing: 'Repo path — needs to be absolute, starting from the filesystem root',
      };
    }
    return { ok: true, missing: null };
  }
  if (state.prompt.trim() === '') {
    return { ok: false, missing: 'Prompt — describe the product you want built' };
  }
  return { ok: true, missing: null };
}

/** The request body the gated state submits to, per mode. */
export function composerRequest(
  state: ComposerState,
):
  | { url: '/api/briefs'; body: { prompt: string; kind?: string; name?: string } }
  | { url: '/api/projects/adopt'; body: { repoPath: string } } {
  if (state.mode === 'adopt') {
    return { url: '/api/projects/adopt', body: { repoPath: state.repoPath.trim() } };
  }
  const name = state.name.trim();
  return {
    url: '/api/briefs',
    body: {
      prompt: state.prompt.trim(),
      ...(state.kind ? { kind: state.kind } : {}),
      ...(name ? { name } : {}),
    },
  };
}

// ── Composer garnish (OD-022/024/025/087) ──────────────────────────────────
// Ported from open-design's home-hero sub-chips + starter-copy pattern, over
// ligma's fixed 5 `PROJECT_KINDS` instead of a plugin/facet-derived catalog —
// there is no installed-plugin table here to derive one from, so the pool
// below is hand-authored per kind rather than computed.

type ProjectKind = (typeof PROJECT_KINDS)[number];

/** A second-level chip under a project-kind chip — a shortcut into a concrete starter prompt. */
export interface SubChip {
  label: string;
  prompt: string;
}

const SUB_CHIPS_BY_KIND: Record<ProjectKind, readonly SubChip[]> = {
  'Web app': [
    {
      label: 'Dashboard',
      prompt: 'Build a dashboard that tracks the metrics that matter to the team.',
    },
    {
      label: 'Landing page',
      prompt: 'Build a landing page that explains the product and converts visitors.',
    },
    {
      label: 'Internal tool',
      prompt: 'Build an internal tool the team uses to manage day-to-day work.',
    },
  ],
  'API service': [
    { label: 'REST API', prompt: 'Build a REST API with CRUD endpoints and input validation.' },
    {
      label: 'Webhook receiver',
      prompt: 'Build a service that receives webhooks and processes them reliably.',
    },
    {
      label: 'Data pipeline',
      prompt: 'Build a service that ingests, transforms, and stores incoming data.',
    },
  ],
  'CLI tool': [
    {
      label: 'File processor',
      prompt: 'Build a CLI that processes files in a directory and reports the results.',
    },
    {
      label: 'Dev utility',
      prompt: 'Build a CLI utility that automates a repetitive developer task.',
    },
  ],
  Library: [
    {
      label: 'Utility package',
      prompt: 'Build a small, well-tested utility library other code can depend on.',
    },
    { label: 'SDK wrapper', prompt: 'Build a typed wrapper around a third-party API.' },
  ],
  Automation: [
    {
      label: 'Scheduled job',
      prompt: 'Build an automation that runs on a schedule and reports what it did.',
    },
    {
      label: 'Event-driven workflow',
      prompt: 'Build an automation triggered by an event that runs a multi-step workflow.',
    },
  ],
};

/** Sub-chips for a kind, or `[]` for `null`/an unrecognised kind. */
export function subChipsForKind(kind: string | null): readonly SubChip[] {
  return kind !== null && kind in SUB_CHIPS_BY_KIND ? SUB_CHIPS_BY_KIND[kind as ProjectKind] : [];
}

/**
 * Sub-chip → prompt seeding. A sub-chip is a shortcut, not an overwrite: it
 * only fills an empty box, the same rule `gateComposer` already applies to
 * what counts as "described" — text the user typed is never clobbered.
 */
export function seedPromptFromSubChip(currentPrompt: string, subChip: SubChip): string {
  return currentPrompt.trim() === '' ? subChip.prompt : currentPrompt;
}

/**
 * The composer's one-line starter recommendation for a kind (OD-087) — reuses
 * the sub-chip pool's first entry rather than maintaining a second copy of
 * the same idea under a different name.
 */
export function starterPromptForKind(kind: string | null): string | null {
  return subChipsForKind(kind)[0]?.prompt ?? null;
}

const DEFAULT_PLACEHOLDERS = [
  'Build a REST API that shortens URLs, with rate limiting.',
  'A dashboard that tracks weekly active users.',
  'A CLI that batches image resizes for a folder.',
] as const;

const PLACEHOLDERS_BY_KIND: Record<ProjectKind, readonly string[]> = {
  'Web app': [
    'Build a dashboard that tracks weekly active users.',
    'A landing page for a newsletter, with an email capture form.',
    'An internal tool for triaging support tickets.',
  ],
  'API service': [
    'Build a REST API that shortens URLs, with rate limiting.',
    'A webhook receiver that verifies signatures and queues jobs.',
    'A GraphQL API in front of an existing database.',
  ],
  'CLI tool': [
    'A CLI that batches image resizes for a folder.',
    'A CLI that lints commit messages against a house style.',
    'A CLI that diffs two JSON files and prints what changed.',
  ],
  Library: [
    'A typed date-range utility library with no dependencies.',
    'A typed wrapper around a flaky third-party API, with retries.',
  ],
  Automation: [
    'A nightly job that backs up a database to object storage.',
    'A workflow that files a ticket when a metric crosses a threshold.',
  ],
};

/** The placeholder pool for a kind, or the kind-agnostic defaults. */
export function placeholdersForKind(kind: string | null): readonly string[] {
  return kind !== null && kind in PLACEHOLDERS_BY_KIND
    ? PLACEHOLDERS_BY_KIND[kind as ProjectKind]
    : DEFAULT_PLACEHOLDERS;
}

/**
 * Placeholder rotation as a plain cycle — no typewriter, no easing (this is a
 * productivity tool, not a landing page: OD-087 asks for a slow rotation with
 * no autoplaying flash). The component owns the timer; this is just "what's
 * the next index".
 */
export function nextPlaceholderIndex(index: number, poolSize: number): number {
  return poolSize <= 0 ? 0 : (index + 1) % poolSize;
}
