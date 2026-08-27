/**
 * The Library's catalogs: the vendored `design-systems/` and `craft/` trees,
 * as the daemon serves them.
 *
 * These directories are read-only inputs to the product — they ship in the
 * repo, the agent reads them at generation time, and the Library renders the
 * same bytes so the human can see what the agent is being told. Nothing here
 * is user data and nothing here is writable over HTTP: both routes are GET.
 */

import type { DesignStatus } from './designs';

/**
 * The `tokens.css` custom properties every package defines, in the order a
 * swatch strip should show them. Enough to recognise a system at thumbnail
 * size without shipping the whole stylesheet to a popover.
 */
export const DESIGN_SYSTEM_SWATCH_TOKENS = [
  'bg',
  'surface',
  'fg',
  'muted',
  'border',
  'accent',
] as const;

export type DesignSystemSwatchToken = (typeof DESIGN_SYSTEM_SWATCH_TOKENS)[number];

/** List view — `GET /api/design-systems`. Cheap enough for a picker popover. */
export interface DesignSystemSummary {
  /** Directory name under `design-systems/`, and the slug stored on a design. */
  id: string;
  name: string;
  category: string;
  /** One-line summary, from DESIGN.md's header blockquote (manifest fallback). */
  blurb: string;
  /** Resolved `--<token>` values from `tokens.css`; a token absent is omitted. */
  swatches: Partial<Record<DesignSystemSwatchToken, string>>;
  /** Whether `components.html` exists — a real preview vs. the token specimen. */
  hasPreview: boolean;
  /**
   * True when the package came out of the wizard's own store
   * (`<DATA_DIR>/design-systems`) rather than the repo's vendored catalog.
   * The two sets are disjoint: the wizard refuses a vendored id.
   */
  authored: boolean;
}

/** A static page declared by the package manifest under `preview/`. */
export interface DesignSystemPreviewPage {
  path: string;
  role: string;
  title: string;
}

/**
 * A design session that was drawn with this system — the "what this made" half
 * of seam rule 3, derived from the design manifests rather than a stored index.
 */
export interface DesignSystemUse {
  projectId: string;
  designId: string;
  title: string;
  status: DesignStatus;
  updatedAt: string;
}

/** Detail view — `GET /api/design-systems?id=<id>`. */
export interface DesignSystemDetail extends DesignSystemSummary {
  /** `DESIGN.md` verbatim — the prose the generation agent is handed. */
  design: string;
  /** `tokens.css` verbatim. */
  tokensCss: string;
  /**
   * `components.html` verbatim, or null when the package ships none. The
   * Library renders it in a sandboxed iframe; null means fall back to the
   * token specimen.
   */
  preview: string | null;
  /** Manifest-declared `preview/` pages that actually exist on disk. */
  previewPages: DesignSystemPreviewPage[];
  usedBy: DesignSystemUse[];
}

export interface DesignSystemsResponse {
  systems: DesignSystemSummary[];
}

/** One `craft/*.md` rulebook, body included — `GET /api/craft-rules`. */
export interface CraftRule {
  /** File basename without `.md` — the slug a critique rule score carries. */
  id: string;
  title: string;
  blurb: string;
  /** The markdown source, verbatim. */
  body: string;
}

export interface CraftRulesResponse {
  rules: CraftRule[];
}

/**
 * One vendored `skills/<id>/SKILL.md` package — list view,
 * `GET /api/skill-catalog`. Title and description come from the file's own
 * YAML frontmatter (`name`, `description`), the same fields every skill
 * loader in the repo already reads.
 */
export interface SkillCatalogEntry {
  /** Directory name under `skills/`. */
  id: string;
  title: string;
  description: string;
}

export interface SkillCatalogResponse {
  skills: SkillCatalogEntry[];
}

/** Detail view — `GET /api/skill-catalog?id=<id>`. */
export interface SkillCatalogDetail extends SkillCatalogEntry {
  /** SKILL.md's body, after the frontmatter delimiter. */
  body: string;
  /** Other files the package ships (relative paths), e.g. `templates/foo.html`. */
  files: string[];
}
