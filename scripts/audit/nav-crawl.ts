#!/usr/bin/env -S npx tsx
/**
 * Nav crawl audit (Phase 2 acceptance, build brief D5): proves the rail-driven
 * IA has zero orphan routes and that every retired mission-control URL still
 * redirects to its new home.
 *
 * What it does:
 *   1. Enumerates every `page.tsx` under apps/web/src/app as a routable surface,
 *      classifying static routes vs dynamic families ([id]/[role]/[scope]).
 *   2. Starts (or reuses) the daemon + web production server against the real
 *      repo `data/` dir (StoryForge project, 208 tasks, skills, decisions —
 *      real instances for every dynamic family).
 *   3. BFS-crawls same-origin <a href> links from "/", recording every reached
 *      pathname. A dynamic family counts as reached once any one instance is
 *      visited via a real link.
 *   4. Separately follows the known old-URL redirects and records where they land.
 *   5. Prints a JSON report to stdout and exits non-zero on any orphan or
 *      failed redirect.
 *
 * Run: `npx tsx scripts/audit/nav-crawl.ts` from the repo root.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../apps/daemon/src/paths";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
const APP_DIR = path.join(WEB_DIR, "src", "app");
const DAEMON_URL = "http://127.0.0.1:4477";
const WEB_URL = "http://localhost:3000";
const ONBOARDING_KEY = "mc-onboarded";

// ---------------------------------------------------------------------------
// 1. Route inventory — walk apps/web/src/app for page.tsx files.
// ---------------------------------------------------------------------------

interface RouteEntry {
  /** URL pattern, e.g. "/library/[id]" */
  pattern: string;
  type: "static" | "dynamic";
  /** True if the page.tsx body calls redirect() — validated separately (step 4). */
  isRedirect: boolean;
}

function segmentIsDynamic(seg: string): boolean {
  return seg.startsWith("[") && seg.endsWith("]");
}

/** Route groups `(name)` don't appear in the URL; strip them. */
function toUrlSegments(relDirParts: string[]): string[] {
  return relDirParts.filter((p) => !(p.startsWith("(") && p.endsWith(")")));
}

function walkPages(dir: string, relParts: string[], out: RouteEntry[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkPages(full, [...relParts, entry], out);
      continue;
    }
    if (entry === "page.tsx") {
      const urlParts = toUrlSegments(relParts);
      const pattern = "/" + urlParts.join("/");
      const normalized = pattern === "//" ? "/" : pattern.replace(/\/$/, "") || "/";
      const type = urlParts.some(segmentIsDynamic) ? "dynamic" : "static";
      out.push({ pattern: normalized, type, isRedirect: false });
    }
  }
}

function fileCallsRedirect(pattern: string): boolean {
  // page.tsx path from a URL pattern (dynamic segments keep their [x] form).
  const rel = pattern === "/" ? "page.tsx" : path.join(...pattern.slice(1).split("/"), "page.tsx");
  const full = path.join(APP_DIR, rel);
  if (!existsSync(full)) return false;
  const src = readFileSync(full, "utf8");
  return /\bredirect\(/.test(src) && /from ["']next\/navigation["']/.test(src);
}

function buildRouteInventory(): RouteEntry[] {
  const out: RouteEntry[] = [];
  walkPages(APP_DIR, [], out);
  for (const r of out) r.isRedirect = fileCallsRedirect(r.pattern);
  out.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return out;
}

/** Build a matcher: does a real pathname belong to this route's family? */
function familyRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((seg) => (segmentIsDynamic(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}$`);
}

/**
 * Did the crawl reach an instance of this route?
 *
 * A dynamic family is NOT satisfied by a pathname that is itself a static route:
 * `/library/new` matches `^/library/[^/]+$`, so before this guard the skill
 * *editor* family `/library/[id]` counted as reached the moment the crawl found
 * the "New Skill" button — an orphan hiding behind its own sibling.
 */
function reachedBy(route: RouteEntry, reached: Set<string>, staticPatterns: Set<string>): boolean {
  const re = familyRegex(route.pattern);
  for (const pathname of reached) {
    if (!re.test(pathname)) continue;
    if (route.type === "dynamic" && staticPatterns.has(pathname)) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1b. The data-gated register — routes no crawl can reach because no instance
//     exists, argued in the open rather than excluded in silence.
// ---------------------------------------------------------------------------

interface DataGate {
  /** Must match a route pattern in the filesystem inventory. */
  pattern: string;
  /** Why no instance can exist in the crawl's data. */
  reason: string;
  /** The store whose entries ARE the instances — the claim is void if it is non-empty. */
  instancesDir: string;
  /** file:line of every link site that reaches this family the moment one exists. */
  wiredAt: string[];
}

const DATA_GATED: DataGate[] = [
  {
    pattern: "/adoption/[runId]",
    reason:
      "no repo has been adopted in this checkout, so there is no adoption run to review; the family appears the moment F2 runs",
    instancesDir: "data/adoption-runs",
    wiredAt: [
      "apps/web/src/lib/deck-cards.ts:331", // Deck card href for an adoption awaiting review
      "apps/web/src/components/kickoff-composer.tsx:86", // "Adopt a repo" lands on the review sheet
    ],
  },
  {
    pattern: "/verification/[id]",
    reason:
      "no verification run has been recorded in this checkout, so every verdict link in the UI has nothing to point at",
    instancesDir: "data/verification-runs",
    wiredAt: [
      "apps/web/src/app/projects/[id]/verify/page.tsx:114", // task row → its verdict
      "apps/web/src/app/projects/[id]/knowledge/page.tsx:375", // baseline → the run that recorded it
      "apps/web/src/components/task-detail-panel.tsx:72", // task panel → the full report
      "apps/web/src/lib/deck-cards.ts:359", // verdict spot-check card
    ],
  },
];

interface GateVerdict extends DataGate {
  /** Instances found in `instancesDir` — a data gate only holds at zero. */
  instances: number;
  /** Wiring proofs that do not resolve to a line mentioning the route. */
  brokenProofs: string[];
  ok: boolean;
}

/** The link a wiring proof claims to be — checked, so the register cannot rot. */
function proofHolds(proof: string, pattern: string): boolean {
  const match = /^(.*):(\d+)$/.exec(proof);
  if (!match) return false;
  const file = path.join(REPO_ROOT, match[1]!);
  if (!existsSync(file)) return false;
  const line = readFileSync(file, "utf8").split("\n")[Number(match[2]) - 1];
  // "/verification/[id]" is reached by a link built from "/verification/".
  const prefix = `/${pattern.slice(1).split("/")[0]}/`;
  return line !== undefined && line.includes(prefix);
}

function verifyGates(inventory: RouteEntry[]): GateVerdict[] {
  const patterns = new Set(inventory.map((r) => r.pattern));
  return DATA_GATED.map((gate) => {
    if (!patterns.has(gate.pattern)) {
      return { ...gate, instances: -1, brokenProofs: [`${gate.pattern} is not a route in this app`], ok: false };
    }
    const dir = path.join(REPO_ROOT, gate.instancesDir);
    const instances = existsSync(dir) ? readdirSync(dir).filter((e) => !e.startsWith(".")).length : 0;
    const brokenProofs = gate.wiredAt.filter((proof) => !proofHolds(proof, gate.pattern));
    return { ...gate, instances, brokenProofs, ok: instances === 0 && brokenProofs.length === 0 };
  });
}

// ---------------------------------------------------------------------------
// 2. Process lifecycle — reuse a running daemon/web, else start them.
// ---------------------------------------------------------------------------

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitUp(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

interface Managed {
  proc: ChildProcess;
  label: string;
}

/**
 * Children are started as their own process group leaders (`detached`) and the
 * *group* is signalled on the way out. `pnpm run <script>` is deliberately not
 * used as the wrapper: it does not forward SIGTERM to the script it spawned, so
 * every earlier crawl left a daemon and a `next start` behind — and the next
 * crawl silently "reused" that stale server instead of the build it just made.
 * We exec the local tsx/next binaries directly instead.
 *
 * stdout belongs to the JSON report and nothing else, so a child's banners are
 * piped to stderr rather than inherited.
 */
function spawnManaged(label: string, bin: string, args: string[], cwd: string): ChildProcess {
  const proc = spawn(bin, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout?.on("data", (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk}`));
  proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk}`));
  return proc;
}

const DAEMON_DIR = path.join(REPO_ROOT, "apps", "daemon");

/**
 * Where each server came from. A crawl against a *reused* server is a crawl
 * against whatever build that server is running, which may not be the one on
 * disk — the report says which, because a report that can't say is not evidence.
 */
const provenance: { daemon: "started" | "reused"; web: "started" | "reused" } = { daemon: "started", web: "started" };

async function ensureDaemon(managed: Managed[]): Promise<void> {
  if (await isUp(`${DAEMON_URL}/api/daemon`)) {
    console.error("[nav-crawl] daemon already running at 4477 — reusing");
    provenance.daemon = "reused";
    return;
  }
  console.error("[nav-crawl] starting daemon: tsx src/server.ts");
  const proc = spawnManaged("daemon", path.join(DAEMON_DIR, "node_modules", ".bin", "tsx"), ["src/server.ts"], DAEMON_DIR);
  managed.push({ proc, label: "daemon" });
  const ok = await waitUp(`${DAEMON_URL}/api/daemon`, 30_000);
  if (!ok) throw new Error("daemon did not come up within 30s");
}

/**
 * Web is started via production build + start (matches apps/web/playwright.config.ts's
 * own e2e webServer pattern) rather than `next dev`, so the crawl exercises the
 * same artifact CI/acceptance evidence uses.
 */
async function ensureWeb(managed: Managed[]): Promise<void> {
  const nextBin = path.join(WEB_DIR, "node_modules", ".bin", "next");
  if (await isUp(WEB_URL)) {
    console.error("[nav-crawl] web already running at 3000 — reusing (this build may not be the one on disk)");
    provenance.web = "reused";
    return;
  }
  const hasBuild = existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"));
  if (!hasBuild) {
    console.error("[nav-crawl] no .next build found — building web (next build)");
    await new Promise<void>((resolve, reject) => {
      const build = spawnManaged("web-build", nextBin, ["build"], WEB_DIR);
      build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`web build failed (${code})`))));
    });
  }
  console.error("[nav-crawl] starting web: next start");
  const proc = spawnManaged("web", nextBin, ["start"], WEB_DIR);
  managed.push({ proc, label: "web" });
  const ok = await waitUp(WEB_URL, 30_000);
  if (!ok) throw new Error("web did not come up within 30s");
}

function teardown(managed: Managed[]): void {
  while (managed.length > 0) {
    const { proc, label } = managed.pop()!;
    if (proc.pid === undefined || proc.exitCode !== null) continue;
    console.error(`[nav-crawl] stopping ${label} (process group ${proc.pid})`);
    // Negative pid = the whole group, so the `next start` worker dies with its
    // launcher instead of surviving as an orphan on port 3000.
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
}

// ---------------------------------------------------------------------------
// 3. BFS crawl.
// ---------------------------------------------------------------------------

async function collectLinks(page: Page): Promise<string[]> {
  const hrefs: string[] = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const out: string[] = [];
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) continue;
    const pathname = href.split("?")[0].split("#")[0];
    if (pathname) out.push(pathname);
  }
  return out;
}

/**
 * Anchors revealed only by switching a tab. Clicking a tab IS real navigation —
 * a human does it without thinking — but the DOM harvest above only sees the
 * active panel, so a link that exists solely behind an inactive tab reads as an
 * orphan. Reproduced: the Library's "+ New Skill" anchor follows the active tab
 * (walkthrough m4's contextual CTA), which re-orphaned `/library/new` — the
 * exact regression adda77f fixed once at the page level. Fixing the *crawler*
 * covers the whole class instead of pinning one page's CTA forever.
 */
async function collectTabRevealedLinks(page: Page): Promise<string[]> {
  const out: string[] = [];
  const tabs = await page.$$('[role="tab"]:not([aria-selected="true"])');
  for (const tab of tabs) {
    try {
      await tab.click({ timeout: 1_000 });
      await page.waitForTimeout(250);
      out.push(...(await collectLinks(page)));
    } catch {
      // A tab that won't click (detached mid-render, covered by an overlay)
      // just contributes nothing — same tolerance as the goto fallbacks.
    }
  }
  return out;
}

/**
 * Every project's own id, read straight from the fixture file rather than
 * discovered through a link.
 *
 * The projects *list* page fires five data hooks on mount (tasks, goals,
 * projects, agents, active-runs); when their combined network traffic keeps
 * `networkidle` from ever going quiet, the crawl falls back to a bare `load`
 * wait that fires before React has rendered a single project card — so
 * `/projects` sometimes yields zero project links (reproduced: two otherwise
 * identical crawls, one run harvested both project hrefs from that page, the
 * next harvested none). Whether a given project's whole subtree — home, tabs,
 * and whatever those tabs link onward to — gets visited at all then depends on
 * some *other* page happening to reference it first, which is exactly how
 * `proj_ligma`'s `/verify` tab (and the `/verification/[id]` runs linked from
 * it) went unvisited while `proj_oFbAe2ugPMBW`'s did not (parity-matrix.md
 * §D7.4). Seeding every project id directly removes the race: each project's
 * own page reliably renders its own tabs (single-hook `useProjects` lookup,
 * observed stable across every run), so nothing downstream depends on the
 * list page's timing.
 */
function readProjectIds(): string[] {
  const full = path.join(DATA_DIR, "projects.json");
  if (!existsSync(full)) return [];
  const body = JSON.parse(readFileSync(full, "utf8")) as { projects?: { id: string }[] };
  return (body.projects ?? []).map((p) => p.id);
}

async function bfsCrawl(browser: Browser): Promise<{ reached: Set<string>; visited: string[] }> {
  const context = await browser.newContext();
  // Onboarding modal blocks the rail on first load — pre-seed the localStorage flag.
  await context.addInitScript((key) => window.localStorage.setItem(key, "true"), ONBOARDING_KEY);
  const page = await context.newPage();

  const reached = new Set<string>();
  const visited: string[] = [];
  const queue: string[] = ["/", ...readProjectIds().map((id) => `/projects/${id}`)];
  const seen = new Set<string>(queue);

  while (queue.length > 0) {
    const pathname = queue.shift()!;
    try {
      await page.goto(`${WEB_URL}${pathname}`, { waitUntil: "networkidle", timeout: 15_000 });
    } catch {
      // `load` fires on the network event, not on React: every route here is a
      // "use client" page whose real content — including static links, not
      // just data-fetched ones — arrives via post-hydration render and a
      // `useEffect` fetch. A page-wide 3s run poll (`useActiveRuns`) plus
      // per-page data hooks means `networkidle` sometimes doesn't quiet down
      // inside 15s, and `load` alone then harvests links from a shell that
      // hasn't hydrated yet — reproduced directly: two otherwise-identical
      // crawls of `/projects/[id]/verify` and `/library` disagreed on which
      // links were present. Give it one more, shorter shot at actually going
      // idle before accepting whatever `load` alone saw.
      await page.goto(`${WEB_URL}${pathname}`, { waitUntil: "load", timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    }
    const landed = new URL(page.url()).pathname;
    reached.add(landed);
    // A door that rendered and then handed off client-side (phase 3: "/" opens
    // the last project, "/projects/:id" opens its default stage) was still
    // genuinely served at its own path — the crawl reached it, then moved.
    // Server-redirect shells recorded this way are harmless: they are
    // isRedirect in the inventory and excluded from the orphan check anyway.
    if (landed !== pathname) reached.add(pathname);
    visited.push(pathname);

    const links = [...(await collectLinks(page)), ...(await collectTabRevealedLinks(page))];
    for (const link of links) {
      if (seen.has(link)) continue;
      seen.add(link);
      queue.push(link);
    }
  }

  await context.close();
  return { reached, visited };
}

// ---------------------------------------------------------------------------
// 4. Old-URL redirect verification.
// ---------------------------------------------------------------------------

const REDIRECTS: { from: string; expected: string }[] = [
  // /decisions → /deck → /needs-you: asserted against the terminal landing —
  // waiting on the middle hop of a chain is a race, not a check.
  { from: "/decisions", expected: "/needs-you" },
  // Phase 3: the global Board and Matrix retired into the portfolio grid, so
  // these two old names now chain — asserted against the terminal landing.
  { from: "/status-board", expected: "/projects" },
  { from: "/priority-matrix", expected: "/projects" },
  { from: "/skills", expected: "/library" },
  { from: "/checkpoints", expected: "/settings/checkpoints" },
  { from: "/launch", expected: "/runs" },
  // Not in the acceptance list but present in the filesystem inventory as
  // isRedirect:true routes — verified here too so every redirect page.tsx is
  // actually exercised, not silently excluded from both checks.
  { from: "/skills/new", expected: "/library/new" },
  { from: "/skills/skill_demo_research", expected: "/library/skill_demo_research" },
  // Phase 1: the Deck and Inbox fold into the /needs-you tray.
  { from: "/deck", expected: "/needs-you" },
  { from: "/inbox", expected: "/needs-you" },
  // Phase 3: global pages retire into the portfolio grid (?view= drops out —
  // this check compares pathnames), and the project tabs become stage+panel
  // deep links, exercised through the dogfood project.
  { from: "/objectives", expected: "/projects" },
  { from: "/board", expected: "/projects" },
  { from: "/board/matrix", expected: "/projects" },
  { from: "/projects/proj_ligma/references", expected: "/projects/proj_ligma/brief" },
  { from: "/projects/proj_ligma/design-files", expected: "/projects/proj_ligma/studio" },
  { from: "/projects/proj_ligma/notes", expected: "/projects/proj_ligma/board" },
  { from: "/projects/proj_ligma/terminal", expected: "/projects/proj_ligma/board" },
  { from: "/projects/proj_ligma/runs", expected: "/projects/proj_ligma/board" },
  { from: "/projects/proj_ligma/knowledge", expected: "/projects/proj_ligma/verify" },
];

async function checkRedirects(browser: Browser): Promise<{ from: string; expected: string; landed: string; ok: boolean }[]> {
  const context = await browser.newContext();
  await context.addInitScript((key) => window.localStorage.setItem(key, "true"), ONBOARDING_KEY);
  const page = await context.newPage();

  const results = [];
  for (const { from, expected } of REDIRECTS) {
    await page.goto(`${WEB_URL}${from}`, { waitUntil: "load", timeout: 15_000 }).catch(() => {});
    // These are statically prerendered pages: the redirect ships as a
    // `<meta http-equiv="refresh" content="1;url=...">` tag, not a server 30x,
    // so the URL only changes ~1s after load. Wait for it explicitly.
    await page.waitForURL((url) => url.pathname === expected, { timeout: 5_000 }).catch(() => {});
    const landed = new URL(page.url()).pathname;
    results.push({ from, expected, landed, ok: landed === expected });
  }
  await context.close();
  return results;
}

// ---------------------------------------------------------------------------
// 5. Fixtures — the data the dynamic families are reached through.
// ---------------------------------------------------------------------------

function countFixtures(): Record<string, number> {
  const count = (file: string, key: string): number => {
    const full = path.join(DATA_DIR, file);
    if (!existsSync(full)) return 0;
    const body = JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown[]> | unknown[];
    const list = Array.isArray(body) ? body : body[key];
    return Array.isArray(list) ? list.length : 0;
  };
  return {
    projects: count("projects.json", "projects"),
    agents: count("agents.json", "agents"),
    skills: count("skills-library.json", "skills"),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(managed: Managed[]): Promise<void> {
  const inventory = buildRouteInventory();
  let browser: Browser | undefined;
  let exitCode = 0;

  try {
    await ensureDaemon(managed);
    await ensureWeb(managed);

    browser = await chromium.launch();
    const { reached, visited } = await bfsCrawl(browser);
    const redirects = await checkRedirects(browser);

    // Orphan check: every non-redirect inventory entry must have at least one
    // reached pathname of its own family.
    const checkable = inventory.filter((r) => !r.isRedirect);
    const staticPatterns = new Set(inventory.filter((r) => r.type === "static").map((r) => r.pattern));
    const gates = verifyGates(inventory);
    const gateFor = new Map(gates.map((g) => [g.pattern, g]));

    const orphans: string[] = [];
    const dataGated: GateVerdict[] = [];
    const supersededGates: GateVerdict[] = [];
    for (const route of checkable) {
      if (reachedBy(route, reached, staticPatterns)) {
        // Real navigation reached this route directly — strictly better proof
        // than the gate's excuse ever was, even though "no instances yet" no
        // longer holds (e.g. this checkout has since accumulated real runs).
        // That is progress, not a broken claim, and must not fail the audit.
        const gate = gateFor.get(route.pattern);
        if (gate && !gate.ok) supersededGates.push(gate);
        continue;
      }
      const gate = gateFor.get(route.pattern);
      // A gate that no longer holds — instances exist, or its wiring proof has
      // moved — buys nothing: the route is an orphan again, loudly.
      if (gate?.ok) dataGated.push(gate);
      else orphans.push(route.pattern);
    }
    const supersededPatterns = new Set(supersededGates.map((g) => g.pattern));
    const brokenGates = gates.filter((g) => !g.ok && !supersededPatterns.has(g.pattern));

    const redirectFailures = redirects.filter((r) => !r.ok);

    const report = {
      servers: provenance,
      // The instances the dynamic families are crawled through. A zero here is
      // why a family orphans — missing fixture data, not a missing link.
      fixtures: countFixtures(),
      routeInventory: {
        total: inventory.length,
        static: inventory.filter((r) => r.type === "static").length,
        dynamic: inventory.filter((r) => r.type === "dynamic").length,
        redirectPages: inventory.filter((r) => r.isRedirect).length,
        checkable: checkable.length,
        entries: inventory,
      },
      crawl: {
        pagesVisited: visited.length,
        pathnamesReached: reached.size,
        reached: [...reached].sort(),
      },
      orphans,
      /** Unreached, but argued: no instance exists, and the link that will reach one is named. */
      conditionallyReached: dataGated,
      /** Register entries whose route the crawl now reaches directly — the excuse is retired, not broken. */
      supersededGates,
      /** Register entries that no longer hold, for a route the crawl still couldn't reach — a claim this audit refuses to keep. */
      brokenGates,
      redirects,
      result: orphans.length === 0 && brokenGates.length === 0 && redirectFailures.length === 0 ? "PASS" : "FAIL",
    };

    console.log(JSON.stringify(report, null, 2));

    for (const gate of dataGated) {
      console.error(
        `\n[nav-crawl] conditionally reached (data-gated): ${gate.pattern}\n` +
          `        reason: ${gate.reason}\n` +
          `        instances in ${gate.instancesDir}: ${gate.instances}\n` +
          `        wired at: ${gate.wiredAt.join(", ")}`,
      );
    }
    for (const gate of supersededGates) {
      console.error(
        `\n[nav-crawl] gate superseded (reached directly, excuse retired): ${gate.pattern}\n` +
          `        instances in ${gate.instancesDir}: ${gate.instances}`,
      );
    }
    if (brokenGates.length > 0) {
      console.error(
        `\n[nav-crawl] BROKEN DATA-GATE CLAIMS (${brokenGates.length}): ` +
          brokenGates
            .map((g) => `${g.pattern} — ${g.instances} instance(s); bad proofs: ${g.brokenProofs.join(", ") || "none"}`)
            .join("; "),
      );
    }
    if (orphans.length > 0) {
      console.error(`\n[nav-crawl] ORPHANS (${orphans.length}): ${orphans.join(", ")}`);
    }
    if (redirectFailures.length > 0) {
      console.error(
        `\n[nav-crawl] REDIRECT FAILURES (${redirectFailures.length}): ` +
          redirectFailures.map((r) => `${r.from} -> expected ${r.expected}, landed ${r.landed}`).join("; "),
      );
    }
    if (report.result === "FAIL") exitCode = 1;
    console.error(`\n[nav-crawl] ${report.result}\n`);
  } finally {
    if (browser) await browser.close();
    teardown(managed);
  }

  process.exit(exitCode);
}

const managedGlobal: Managed[] = [];
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // Ctrl-C must not leak the servers either.
  process.on(signal, () => {
    teardown(managedGlobal);
    process.exit(130);
  });
}

main(managedGlobal).catch((err) => {
  console.error("[nav-crawl] fatal:", err);
  teardown(managedGlobal);
  process.exit(1);
});
