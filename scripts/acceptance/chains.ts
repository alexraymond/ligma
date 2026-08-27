/**
 * chains.ts — the seven D-chains of build brief §7, as data.
 *
 * A real product build takes tens of minutes, and a persona session cannot idle
 * through one. So each D is a CHAIN: recorded journey runs, engine-recorded
 * interludes, and evidence exported out of the booted instance — every link
 * with its own record, no link asserted without one (contract §"Journey
 * decomposition"). The decomposition below is that contract's, verbatim in
 * structure; the runner (`run-campaign.ts`) is the only thing that executes it.
 *
 * Nothing here interprets prose: an interlude names an API path, the array in
 * the response, and the exact field values that must be present on one item.
 */

export interface JourneyRunLink {
  kind: "journey-run";
  id: string;
  description: string;
  /** A journey in this repo's `.ligma/journeys/`. */
  journeyId: string;
}

export interface InterludeMonitorLink {
  kind: "interlude-monitor";
  id: string;
  description: string;
  /** Path on the BOOTED instance's daemon, e.g. `/api/tasks`. */
  path: string;
  /** The array key in the JSON response, e.g. `tasks`. */
  collection: string;
  /**
   * One item in that array must match every entry (strict equality on a
   * top-level field). `anyOf` lets a monitor accept either of two resting
   * states — "reached awaiting-verification OR already done" is one condition,
   * not two links.
   */
  anyOf: Record<string, string>[];
  timeoutMs: number;
  pollMs: number;
}

export interface EvidenceExportLink {
  kind: "evidence-export";
  id: string;
  description: string;
  /**
   * `booted-runs`      — verification/journey run dirs + signed verdicts;
   * `booted-baselines` — central characterization baselines;
   * `campaign-manifests` — the chain manifests earlier links already produced
   *                        (the raw material D6/D7 are assembled from).
   */
  source: "booted-runs" | "booted-baselines" | "campaign-manifests";
  /** A link that exports nothing has proved nothing: below this, it fails. */
  minArtifacts: number;
  /** `campaign-manifests` only: these chains must exist AND be green. */
  requireChains?: string[];
}

export interface AuditScriptLink {
  kind: "audit-script";
  id: string;
  description: string;
  /** Repo-relative path to a tsx script. */
  script: string;
  args: string[];
  timeoutMs: number;
}

export type Link = JourneyRunLink | InterludeMonitorLink | EvidenceExportLink | AuditScriptLink;

export interface Chain {
  id: string;
  title: string;
  /** The §7 sentence this chain exists to prove. Quoted, not paraphrased. */
  brief: string;
  /** What the booted instance starts from. Greenfield chains start empty. */
  seed: "none" | "demo";
  links: Link[];
}

const MINUTES = 60_000;

export const CHAINS: Chain[] = [
  {
    id: "d1",
    title: "Headless greenfield",
    brief:
      "From the Home composer: \"Build a REST API that shortens URLs, with rate limiting.\" Discovery confirms the shape; no Studio tab ever appears; Promote opens directly from the brief with tasks, criteria, journeys, and a token estimate; the build runs gated by the governor; a consumer persona in a clean env follows the generated README and exercises the API; the verdict lands with evidence; the task's green check links to it. Zero CLI usage by the user.",
    seed: "none",
    links: [
      {
        kind: "journey-run",
        id: "d1a-compose-promote",
        description:
          "Browser persona: composer → URL-shortener prompt → discovery confirms headless → NO Studio tab → promote from the brief showing tasks/criteria/journeys/estimate → confirm. Zero CLI.",
        journeyId: "d1a-compose-promote",
      },
      {
        kind: "interlude-monitor",
        id: "d1-build",
        description:
          "The booted instance's OWN build, gated by ITS governor: a task must reach awaiting-verification (or done) on the booted daemon.",
        path: "/api/tasks",
        collection: "tasks",
        anyOf: [{ kanban: "awaiting-verification" }, { kanban: "done" }],
        timeoutMs: 90 * MINUTES,
        pollMs: 15_000,
      },
      {
        kind: "evidence-export",
        id: "d1b-consume",
        description:
          "The booted instance's own consumer-panel verdict — a naive-developer in a clean env following the generated README — exported with its run record and its signature verified.",
        source: "booted-runs",
        minArtifacts: 1,
      },
      {
        kind: "journey-run",
        id: "d1c-green-check",
        description: "Browser persona: the task's green check renders WITH a verdict link, and the link resolves to the evidence.",
        journeyId: "d1c-green-check",
      },
      {
        kind: "evidence-export",
        id: "d1-baselines",
        description: "The characterization baselines the booted instance recorded, exported from its central store.",
        source: "booted-baselines",
        minArtifacts: 1,
      },
    ],
  },
  {
    id: "d2",
    title: "UI greenfield",
    brief:
      "A multi-screen web app: prototypes stream onto the Wall; the critique lane is visible without touching settings; the user pins a comment, sees the apply-preview, applies it; promotes from the approved design; a browser persona walks the built app; the judge scores against the design baseline; a failure returns to the builder with the judge's reasoning and passes on a capped retry.",
    seed: "none",
    links: [
      {
        kind: "journey-run",
        id: "d2a-design-loop",
        description:
          "Prototypes stream onto the Wall; critique lane visible without touching settings; pin a comment; SEE the apply-preview; apply; approve; promote from design.",
        journeyId: "d2a-design-loop",
      },
      {
        kind: "interlude-monitor",
        id: "d2-build",
        description: "The booted instance builds the approved design: a task reaches awaiting-verification (or done).",
        path: "/api/tasks",
        collection: "tasks",
        anyOf: [{ kanban: "awaiting-verification" }, { kanban: "done" }],
        timeoutMs: 90 * MINUTES,
        pollMs: 15_000,
      },
      {
        kind: "journey-run",
        id: "d2b-verify-retry",
        description:
          "Browser persona walks the built app; the judge scores against the design baseline; on failure the builder gets the judge's reasoning and passes within the attempt cap.",
        journeyId: "d2b-verify-retry",
      },
      {
        kind: "evidence-export",
        id: "d2-retry-chain",
        description: "The engine-recorded retry chain: every run record and signed verdict the booted instance produced.",
        source: "booted-runs",
        minArtifacts: 1,
      },
    ],
  },
  {
    id: "d3",
    title: "Brownfield adoption",
    brief:
      "Adopt a real existing repo the system did not build; boot recipe inferred and confirmed once; an exploratory persona proposes journeys; a characterization baseline is recorded centrally, never in-repo; the project arrives with Verify and Knowledge populated.",
    seed: "none",
    links: [
      {
        kind: "journey-run",
        id: "d3-adopt",
        description:
          "Adopt a real repo ligma did not build; boot inferred, confirmed once; exploratory persona proposes journeys; Verify and Knowledge arrive populated.",
        journeyId: "d3-adopt",
      },
      {
        kind: "interlude-monitor",
        id: "d3-adopted",
        description: "The adopted project exists on the booted instance and carries the repo it was adopted from.",
        path: "/api/projects",
        collection: "projects",
        anyOf: [{ status: "active" }],
        timeoutMs: 30 * MINUTES,
        pollMs: 10_000,
      },
      {
        kind: "evidence-export",
        id: "d3-baseline",
        description:
          "The characterization baseline, exported from the booted instance's CENTRAL store — proof it landed centrally and never in the adopted repo.",
        source: "booted-baselines",
        minArtifacts: 1,
      },
    ],
  },
  {
    id: "d4",
    title: "The daily loop",
    brief:
      "With decisions, a design approval, a stale-brief flag, and a verdict spot-check queued: everything is answerable from Deck cards alone — inline evidence, no navigation, batch mode at ≥10, working undo.",
    seed: "demo",
    links: [
      {
        kind: "journey-run",
        id: "d4-deck",
        description:
          "Everything answered from Deck cards alone — inline evidence, no navigation, undo works.",
        journeyId: "d4-deck",
      },
      {
        kind: "journey-run",
        id: "d4b-batch",
        description:
          "Batch mode at ≥10: at least five decisions cleared in one pass, count drops accordingly. A goal only the batch tool satisfies — personas optimize goals, not step lists (attempt-4 lesson).",
        journeyId: "d4b-batch-clear",
      },
      {
        kind: "evidence-export",
        id: "d4-run",
        description: "The Deck journeys' own run records and signed verdicts.",
        source: "booted-runs",
        minArtifacts: 2,
      },
    ],
  },
  {
    id: "d5",
    title: "Seam audit",
    brief:
      "An automated crawl from the rail reaches every routable surface (zero orphans); a component audit finds one status-pill vocabulary, one shimmer primitive, no green check without a verdict link, and `error` visually distinct from `failed`.",
    seed: "none",
    links: [
      {
        kind: "audit-script",
        id: "d5-nav-crawl",
        description: "Zero orphan routes from the rail, and every retired mission-control URL still redirects.",
        script: "scripts/audit/nav-crawl.ts",
        args: [],
        timeoutMs: 20 * MINUTES,
      },
      {
        kind: "audit-script",
        id: "d5-seam-audit",
        description:
          "One status-pill vocabulary; one shimmer primitive; no green check without a verdict link; `error` styled distinctly from `failed`.",
        script: "scripts/audit/seam-audit.ts",
        args: [],
        timeoutMs: 5 * MINUTES,
      },
    ],
  },
  {
    id: "d6",
    title: "Feature-completeness matrix",
    brief:
      "Every §6-inventory surface × its listed contents, each cell backed by a journey run or an explicit, argued waiver. Silent scope-shrink is a failure.",
    seed: "none",
    links: [
      {
        kind: "evidence-export",
        id: "d6-evidence-base",
        description:
          "The matrix may only be assembled from recorded evidence: every D1–D5 chain manifest must exist and be green before a cell can cite one.",
        source: "campaign-manifests",
        minArtifacts: 5,
        requireChains: ["d1", "d2", "d3", "d4", "d5"],
      },
    ],
  },
  {
    id: "d7",
    title: "Capability-parity matrix",
    brief:
      "Every row of docs/parity/*-capabilities.md maps to its working ligma equivalent with evidence, or to an explicit argued waiver. A row where ligma does less than the parent did is failing unless Alex approved the reduction by decision card.",
    seed: "none",
    links: [
      {
        kind: "evidence-export",
        id: "d7-evidence-base",
        description:
          "Same rule as D6: every parity row cites a recorded run, so D1–D5 must be green and exported before the matrix is written.",
        source: "campaign-manifests",
        minArtifacts: 5,
        requireChains: ["d1", "d2", "d3", "d4", "d5"],
      },
    ],
  },
];

export function chainById(id: string): Chain | undefined {
  return CHAINS.find((c) => c.id === id);
}

/**
 * Whether a chain needs an ephemeral ligma at all. D5 audits source and its own
 * servers; D6/D7 read manifests already on disk. Booting an instance for them
 * would be minutes of nothing.
 */
export function needsBootedInstance(chain: Chain): boolean {
  return chain.links.some(
    (link) =>
      link.kind === "journey-run" ||
      link.kind === "interlude-monitor" ||
      (link.kind === "evidence-export" && link.source !== "campaign-manifests"),
  );
}
