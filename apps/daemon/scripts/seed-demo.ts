/**
 * Demo Data Seed Script
 *
 * Populates Ligma with sample data to showcase the app's features.
 * Run with: pnpm seed:demo — the daemon must be running.
 *
 * The core dataset (projects, goals, tasks, brain dump, inbox, activity log,
 * decisions) is NOT written here. It belongs to `POST /api/seed-demo`, and this
 * script is a client of that route: one implementation of the demo records, so
 * the two cannot drift apart again (codebase audit D14). The route also carries
 * the in-flight guard — overwriting the store under a running dispatcher is a
 * hazard whichever process does it, and a script writing files directly had no
 * guard and no lock at all.
 *
 * What stays here is only what the route does not own: the agent roster and
 * skills library (written through the same locked stores the app writes them
 * through), and the three non-decision Deck cards — a design awaiting approval,
 * a stale brief, a sampled verdict.
 */

import { mkdirSync, existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

import type { AgentsFile, Brief, CriterionVerdict, SkillsLibraryFile, VerificationRunManifest, VerificationVerdict } from "@ligma/api";
import { DEFAULT_DAEMON_PORT } from "@ligma/api";
import { DATA_DIR as dataDir } from "../src/paths";
import { saveAgents, saveSkillsLibrary, saveTasksArchive } from "../src/store/data";
import { saveContract } from "../src/harness/contract-store";
import { sign } from "../src/harness/signing";
import { writeBrief } from "../src/engine/discovery";
import { createDesign, mutateManifest, recordVersion, setStatus } from "../src/studio/store";
import { sourceDir } from "../src/studio/paths";

// Ensure data directory exists
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// ponytail: the local half assumes this process resolves the same DATA_DIR as
// the daemon it POSTs — true for `pnpm seed:demo`, which carries the same
// LIGMA_DATA_DIR pin as `pnpm serve`. Add a handshake if a remote daemon ever
// becomes a supported target.
const daemonBase = (): string =>
  `http://127.0.0.1:${process.env.LIGMA_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT)}`;

/** The core dataset, from the one implementation that owns it. */
async function seedCoreData(): Promise<void> {
  const url = `${daemonBase()}/api/seed-demo`;
  let res: Response;
  try {
    // Mutating routes require this content-type; the route reads no body.
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch (err) {
    throw new Error(
      `Cannot reach the daemon at ${url}. Start it (\`pnpm --filter @ligma/daemon serve\`) — or point ` +
        `LIGMA_DAEMON_PORT at the one that is running — and seed again. Cause: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (!res.ok) {
    // 409 is the route's in-flight guard: a run is live and the store must not
    // be overwritten under it. Anything else is the route's own error, verbatim.
    const body = (await res.text()).trim();
    throw new Error(`POST /api/seed-demo failed (${res.status} ${res.statusText})${body ? `: ${body}` : ""}`);
  }
}

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();

// ─── Agents ─────────────────────────────────────────────────────────────────

const agents: AgentsFile = {
  agents: [
    {
      id: "me",
      name: "Me",
      icon: "User",
      description: "Tasks I do myself — decisions, approvals, creative direction",
      instructions: "You are the owner/CEO. Your role is to make decisions, give approvals, provide creative direction, and handle relationship-building. Focus on high-leverage activities that only a human can do.",
      capabilities: ["decision-making", "approvals", "creative-direction", "relationship-building"],
      skillIds: [],
      status: "active",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "researcher",
      name: "Researcher",
      icon: "Search",
      description: "Market research, competitive analysis, evaluation",
      instructions: "You are acting as a Research Analyst. Your role is to investigate topics thoroughly and produce actionable insights for a solo software entrepreneur.\n\nSteps:\n1. Read ligma/data/ai-context.md for current project context\n2. Search the web for the most current information on this topic\n3. Cross-reference multiple sources for accuracy\n4. Focus on practical, actionable findings\n5. Consider the solo entrepreneur context (limited time, limited budget, need for leverage)",
      capabilities: ["web-research", "competitive-analysis", "report-writing", "data-gathering", "topic-investigation"],
      skillIds: ["skill_demo_research"],
      status: "active",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "developer",
      name: "Developer",
      icon: "Code",
      description: "Implementation, bug fixes, testing, deployment",
      instructions: "You are acting as a Software Engineer. Your role is to write clean, well-tested code and handle all technical implementation tasks.\n\nBefore starting:\n1. Read ligma/data/ai-context.md for current project context\n2. Check the project's CLAUDE.md for coding conventions\n3. Review existing code patterns before writing new code",
      capabilities: ["full-stack-development", "bug-fixes", "testing", "code-review", "deployment", "architecture"],
      skillIds: ["skill_demo_task_mgmt"],
      status: "active",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "marketer",
      name: "Marketer",
      icon: "Megaphone",
      description: "Copy, growth strategy, content, SEO",
      instructions: "You are acting as a Growth Marketing Specialist for a bootstrapped software business.\n\nCapabilities you should apply:\n- Write compelling copy for landing pages, emails, and social media\n- Analyze positioning and messaging\n- Suggest growth experiments\n- Create content outlines for blog posts and documentation",
      capabilities: ["copywriting", "growth-strategy", "content-creation", "seo", "social-media", "positioning"],
      skillIds: [],
      status: "active",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "business-analyst",
      name: "Business Analyst",
      icon: "BarChart3",
      description: "Strategy, planning, prioritization, financials",
      instructions: "You are acting as a Business Analyst and Strategist advising a solo software entrepreneur.\n\nBefore starting:\n1. Read ligma/data/ai-context.md for a quick snapshot of current state\n2. Read ligma/data/projects.json to understand current projects\n3. Read ligma/data/goals.json to understand priorities",
      capabilities: ["market-analysis", "feature-prioritization", "business-modeling", "financial-projections", "strategic-planning"],
      skillIds: ["skill_demo_eisenhower"],
      status: "active",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
  ],
};

// ─── Skills Library ─────────────────────────────────────────────────────────

const skillsLibrary: SkillsLibraryFile = {
  skills: [
    {
      id: "skill_demo_research",
      name: "Web Research",
      description: "Deep web research with structured markdown output",
      content: "# Web Research\n\nWhen performing research:\n1. Search the web for the most current information\n2. Cross-reference multiple sources for accuracy\n3. Focus on practical, actionable findings\n4. Save findings to the research/ directory as markdown\n\n## Output Format\n- Executive Summary (3-5 sentences)\n- Key Findings (bulleted list)\n- Opportunities / Risks\n- Recommended Next Steps\n- Sources (links and references)",
      agentIds: ["researcher"],
      tags: ["research", "analysis"],
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "skill_demo_eisenhower",
      name: "Eisenhower Matrix Triage",
      description: "Applies Eisenhower matrix logic to prioritize work",
      content: "# Eisenhower Matrix Triage\n\n## Quadrant Definitions\n| Quadrant | Criteria | Action |\n|----------|----------|--------|\n| DO | important + urgent | Work on immediately |\n| SCHEDULE | important + not-urgent | Block time |\n| DELEGATE | not-important + urgent | Assign to agent |\n| ELIMINATE | not-important + not-urgent | Drop or defer |\n\n## Triage Rules\n1. New tasks default to SCHEDULE unless deadline < 48 hours\n2. DELEGATE tasks should always have assignedTo set\n3. Review DO quadrant daily",
      agentIds: ["me", "business-analyst"],
      tags: ["prioritization", "eisenhower", "triage"],
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: "skill_demo_task_mgmt",
      name: "Task Management",
      description: "Manages tasks in Ligma via JSON data files",
      content: "# Task Management\n\nAll data lives in ligma/data/ as JSON files.\n\n## Quick Reference\n- AI Context: ligma/data/ai-context.md (read FIRST)\n- Tasks: ligma/data/tasks.json\n- Goals: ligma/data/goals.json\n- Projects: ligma/data/projects.json\n\n## Creating a Task\nRequired: id, title, description, importance, urgency, kanban, assignedTo\nGenerate IDs as: task_{Date.now()}\n\n## After Any Data Modification\nRun pnpm gen:context in ligma/ to regenerate ai-context.md",
      agentIds: ["developer", "researcher", "marketer", "business-analyst"],
      tags: ["tasks", "management", "workflow"],
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
  ],
};


// \u2500\u2500\u2500 The other three Deck card kinds \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// The Deck is the one attention queue (UX spec \u00A76): decisions, a design waiting
// on approval, a brief that went stale under a compiled contract, and a sampled
// verdict. A demo instance that only ever holds decisions cannot show that, so
// the seed writes the other three through the same stores the product writes
// them through \u2014 the studio store, the brief store, the contract store and the
// harness signer \u2014 rather than hand-rolling their files.

/** The design the Deck asks you to approve. `critiquing` = drawn, scored, waiting on a human. */
async function seedDesign(): Promise<string> {
  const design = await createDesign({
    projectId: "proj_demo_1",
    title: "Landing page \u2014 hero and CTA",
    prompt: "A conversion-optimized hero: headline, subheadline, one CTA, and a product screenshot. Value prop readable in under five seconds.",
    designSystem: null,
  });

  const src = sourceDir("proj_demo_1", design.id);
  await mkdir(src, { recursive: true });
  await writeFile(join(src, "index.html"), DESIGN_HTML, "utf-8");
  await writeFile(join(src, "styles.css"), DESIGN_CSS, "utf-8");
  // The Deck card's thumbnail. Part of the design's own source, so it travels
  // with the version rail and the blob store like every other file.
  await writeFile(join(src, "preview.svg"), DESIGN_PREVIEW_SVG, "utf-8");

  await mutateManifest("proj_demo_1", design.id, async (manifest) => {
    await recordVersion(manifest, "prompt", "first pass");
    manifest.critique = {
      status: "scored",
      score: 82,
      threshold: 75,
      rules: [
        { rule: "typography", score: 88, note: "Clear hierarchy; the subheadline could lose one line." },
        { rule: "contrast", score: 79, note: "CTA passes AA on the dark band, not AAA." },
        { rule: "restraint", score: 78, note: "Three accent colours where two would do." },
      ],
      designSystem: null,
      error: null,
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(3),
    };
    setStatus(manifest, "critiquing");
  });
  return design.id;
}

/** The brief whose post-compilation edit raised the stale flag the Deck asks about. */
function seedStaleBrief(): void {
  const brief: Brief = {
    id: "brf_demo_1",
    projectId: "proj_demo_1",
    prompt: "A conversion-optimized landing page for the SaaS product: hero, features, pricing, testimonials, CTA. Ship the signup form with it.",
    kind: "web-app",
    shape: "ui",
    status: "compiled",
    turns: [],
    // The edit that flagged it: added after the contract compiled, which is
    // exactly the condition editFlagsStale() gates on.
    constraints: ["Pricing section must show annual billing by default."],
    createdAt: daysAgo(14),
    updatedAt: hoursAgo(2),
    lockedAt: daysAgo(13),
    compiledAt: daysAgo(9),
    staleFlaggedAt: hoursAgo(2),
  };
  writeBrief(brief);
}

/** FNV-1a, 32-bit \u2014 the sampler in apps/web/src/lib/deck-cards.ts, verbatim. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The verdict the Deck spot-checks.
 *
 * Spot-checks sample 1 run in 10, deterministically on the run id \u2014 so a seeded
 * verdict is only ever in the Deck if its id happens to hash into the sample.
 * Scanning forward from now for the first millisecond that does is how you seed
 * a *sampled* run without lying about the rate or hard-coding a stale date.
 */
async function seedSpotCheckedRun(): Promise<string> {
  let ms = now.getTime();
  while (hashId(`vrun_${ms}`) % 10 !== 0) ms++;
  const runId = `vrun_${ms}`;

  const contract = saveContract({
    taskId: "task_demo_1",
    productId: null,
    title: "Hero section for the landing page",
    baselineRunId: null,
    criteria: CONTRACT_CRITERIA.map((c) => ({
      id: c.id,
      kind: "criterion" as const,
      text: c.text,
      holdout: false,
      provenance: { source: "task:task_demo_1", quote: c.text },
    })),
  });

  const runDir = join(dataDir, "verification-runs", runId);
  await mkdir(runDir, { recursive: true });

  const unsigned: Omit<VerificationVerdict, "signature"> = {
    runId,
    taskId: "task_demo_1",
    contractId: contract.id,
    contractVersion: contract.version,
    outcome: "failed",
    criterionVerdicts: CONTRACT_CRITERIA.map(
      (c): CriterionVerdict => ({ criterionId: c.id, status: c.status, reasoning: c.reasoning, evidence: [] }),
    ),
    humanDecisions: [],
    judgeModel: "demo-seed",
    createdAt: hoursAgo(1),
  };
  // Really signed, by this instance's own key \u2014 generated here on first use.
  // A hand-written "passed" would be the exact lie the harness exists to catch.
  const verdict: VerificationVerdict = { ...unsigned, signature: sign(unsigned) };

  const manifest: VerificationRunManifest = {
    id: runId,
    taskId: "task_demo_1",
    journeyId: null,
    projectId: "proj_demo_1",
    contractId: contract.id,
    contractVersion: contract.version,
    envId: null,
    baseCommit: "0000000000000000000000000000000000000000",
    status: "complete",
    pid: null,
    personaReports: [],
    verdictPath: "verdict.json",
    startedAt: hoursAgo(1),
    finishedAt: hoursAgo(1),
    error: null,
  };

  await writeFile(join(runDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`, "utf-8");
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return runId;
}

/** The criteria the seeded verdict rules on. One not-met, so the spot-check has something to weigh. */
const CONTRACT_CRITERIA: Array<{ id: string; text: string; status: CriterionVerdict["status"]; reasoning: string }> = [
  {
    id: "crit_1",
    text: "Hero loads in under 2 seconds",
    status: "met",
    reasoning: "First contentful paint measured at 1.1s on a cold load with the screenshot inlined.",
  },
  {
    id: "crit_2",
    text: "CTA button is above the fold on mobile",
    status: "not-met",
    reasoning:
      "At 390\u00D7844 the CTA sits 60px below the fold \u2014 the subheadline runs to four lines and pushes it down. It is above the fold at 768px and wider, so this fails only on phones.",
  },
  {
    id: "crit_3",
    text: "Headline communicates core value proposition",
    status: "met",
    reasoning: "The headline names the outcome (\"ship the week's work by Friday\") rather than the mechanism.",
  },
];

const DESIGN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ship the week's work by Friday</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="hero">
      <h1>Ship the week's work by Friday.</h1>
      <p class="sub">One queue for everything waiting on you. Answer it, and the agents keep moving.</p>
      <a class="cta" href="#signup">Start free</a>
      <img class="shot" src="preview.svg" alt="The Deck, holding four cards" />
    </header>
  </body>
</html>
`;

const DESIGN_CSS = `:root { --ink: #0b1220; --paper: #f7f9fc; --accent: #3b82f6; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--paper); color: var(--ink); }
.hero { max-width: 62rem; margin: 0 auto; padding: 5rem 1.5rem; text-align: center; }
.hero h1 { font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.05; margin: 0 0 1rem; }
.sub { font-size: 1.125rem; opacity: 0.75; max-width: 34rem; margin: 0 auto 2rem; }
.cta { display: inline-block; background: var(--accent); color: #fff; padding: 0.9rem 1.75rem; border-radius: 0.5rem; font-weight: 600; text-decoration: none; }
.shot { display: block; width: 100%; margin-top: 3rem; border-radius: 0.75rem; box-shadow: 0 24px 60px rgb(11 18 32 / 0.18); }
`;

/** The design's own preview, drawn as vector so it is real content rather than a stand-in bitmap. */
const DESIGN_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Landing page hero preview">
  <rect width="640" height="360" fill="#f7f9fc"/>
  <rect x="0" y="0" width="640" height="40" fill="#0b1220" opacity="0.06"/>
  <rect x="160" y="86" width="320" height="26" rx="6" fill="#0b1220"/>
  <rect x="200" y="126" width="240" height="14" rx="5" fill="#0b1220" opacity="0.45"/>
  <rect x="232" y="150" width="176" height="14" rx="5" fill="#0b1220" opacity="0.45"/>
  <rect x="266" y="192" width="108" height="34" rx="8" fill="#3b82f6"/>
  <rect x="96" y="256" width="448" height="80" rx="10" fill="#0b1220" opacity="0.10"/>
</svg>
`;

void (async () => {
  // The route first: it overwrites the core stores wholesale, so anything this
  // script writes locally has to land after it, not under it.
  await seedCoreData();
  console.log(`  \u2713 core dataset via POST ${daemonBase()}/api/seed-demo`);

  await saveAgents(agents);
  await saveSkillsLibrary(skillsLibrary);
  await saveTasksArchive({ tasks: [] });
  console.log("  \u2713 agents.json, skills-library.json, tasks-archive.json");

  const designId = await seedDesign();
  seedStaleBrief();
  const runId = await seedSpotCheckedRun();
  console.log(`  \u2713 design ${designId} (critiquing \u2014 Deck approval card)`);
  console.log("  \u2713 brief proj_demo_1 (compiled + stale \u2014 Deck stale-brief card)");
  console.log(`  \u2713 ${runId} (signed verdict, samples into the 1-in-10 spot-check)`);

  console.log("\n\uD83D\uDE80 Demo data seeded successfully!");
  console.log("   Open the web UI to see the demo.\n");
})().catch((err: unknown) => {
  // A half-seeded instance is worse than none: the Deck would silently be short
  // a card kind and the chain would blame the product for the fixture.
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
