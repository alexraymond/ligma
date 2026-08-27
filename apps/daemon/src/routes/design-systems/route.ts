/**
 * `GET /api/design-systems` — the design-system catalog.
 *
 * Two views off one route, the shape the skills route already uses:
 *   - no query   → every package as a summary (name, category, blurb, swatches)
 *   - `?id=<id>` → that package's DESIGN.md, tokens.css, components.html and
 *                  the `preview/` pages its manifest declares
 *
 * TWO roots are served as one overlay: the vendored catalog tracked in the
 * repo, and the wizard-authored packages under `<DATA_DIR>/design-systems`
 * (store data, outside the checkout — docs/DECISIONS.md 2026-08-13). The union
 * is disjoint by construction: the wizard refuses a vendored id outright, so
 * there is no precedence rule to get wrong. Authored entries carry
 * `authored: true` so the Library can say which are the user's own.
 *
 * The directories are a *read-only input to this route*: there is no POST here
 * (the wizard owns writes), and no caller-supplied string is joined onto a
 * path without being checked first.
 * `id` must be a bare safe segment, and every manifest-declared preview path is
 * resolved inside the package directory before it is reported — a manifest that
 * points at `../../../etc/passwd` yields a package with no preview pages, not a
 * leak.
 *
 * ponytail: reads from disk on every request, no cache. 17 packages × 3 small
 * files is a few milliseconds and the files only change when someone edits the
 * repo. Ceiling: a catalog in the hundreds (open-design carried 151) makes the
 * list read worth memoising on directory mtime.
 */

import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type {
  DesignSystemDetail,
  DesignSystemPreviewPage,
  DesignSystemSummary,
  DesignSystemSwatchToken,
  DesignSystemUse,
  DesignSystemsResponse,
} from "@ligma/api";
import { DESIGN_SYSTEM_SWATCH_TOKENS } from "@ligma/api";
import { NextResponse, type NextRequest } from "../../http";
import { CENTRAL_PROJECTS_DIR, REPO_ROOT, dataRootInfo } from "../../paths";
import { listDesigns } from "../../studio/store";
import { PathSafetyError, isSafeSegment, safeResolve } from "../verification-runs/_lib";

/** The vendored catalog root. Overridable so tests can point at a fixture. */
export function designSystemsRoot(): string {
  return process.env.LIGMA_DESIGN_SYSTEMS_DIR
    ? path.resolve(process.env.LIGMA_DESIGN_SYSTEMS_DIR)
    : path.join(REPO_ROOT, "design-systems");
}

/**
 * Where the wizard writes. Store data, so it follows DATA_DIR and gets no knob
 * of its own; read at call time like `designSystemsRoot()` above, so a test can
 * repoint the store between cases.
 */
export function authoredDesignSystemsRoot(): string {
  return path.join(dataRootInfo().path, "design-systems");
}

/**
 * Which root holds `<id>`, vendored first. null when neither does.
 *
 * Shared with the `:id/file` route so one lookup rule serves both — a package
 * that lists in the catalog is a package whose files are readable.
 */
export async function rootForSystem(id: string): Promise<{ root: string; authored: boolean } | null> {
  const vendored = designSystemsRoot();
  if (await exists(path.join(vendored, id))) return { root: vendored, authored: false };
  const authored = authoredDesignSystemsRoot();
  if (await exists(path.join(authored, id))) return { root: authored, authored: true };
  return null;
}

interface PackageManifest {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  preview?: { pages?: Array<{ path?: string; role?: string; title?: string }> };
}

async function readJson(file: string): Promise<PackageManifest | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as PackageManifest;
  } catch {
    return null;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * The one-line summary from DESIGN.md's header blockquote.
 *
 * Every vendored package opens the same way — an `#` title, then a blockquote
 * whose first line is `Category: …` and whose remaining lines are the summary
 * (wrapped across lines in a couple of packages). That is a structural
 * convention of the format, not prose mining: the manifest's own `description`
 * is boilerplate ("Bundled Open Design package for X"), so it is the fallback,
 * not the source.
 */
export function parseDesignHeader(markdown: string): { category: string | null; blurb: string } {
  const lines = markdown.split("\n");
  const quoted: string[] = [];
  let seen = false;
  for (const line of lines) {
    if (line.startsWith(">")) {
      seen = true;
      quoted.push(line.replace(/^>\s?/, "").trim());
    } else if (seen && line.trim() === "") {
      break;
    } else if (seen) {
      break;
    }
  }
  let category: string | null = null;
  const summary: string[] = [];
  for (const line of quoted) {
    const match = /^Category:\s*(.+)$/.exec(line);
    if (match) category = match[1].trim();
    else if (line) summary.push(line);
  }
  return { category, blurb: summary.join(" ") };
}

/**
 * The swatch tokens' literal values from `tokens.css`.
 *
 * First definition wins, which is the `:root` block — a later
 * `@media (prefers-color-scheme: dark)` override must not become the thumbnail.
 */
export function parseSwatches(css: string): Partial<Record<DesignSystemSwatchToken, string>> {
  const out: Partial<Record<DesignSystemSwatchToken, string>> = {};
  for (const token of DESIGN_SYSTEM_SWATCH_TOKENS) {
    const match = new RegExp(`--${token}:\\s*([^;]+);`).exec(css);
    if (match) out[token] = match[1].trim();
  }
  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** One package's summary, or null when the directory is not a design system. */
async function summarise(root: string, id: string, authored: boolean): Promise<DesignSystemSummary | null> {
  const dir = path.join(root, id);
  const manifest = await readJson(path.join(dir, "manifest.json"));
  const design = await readText(path.join(dir, "DESIGN.md"));
  // A package needs at least one of the two: manifest.json is the authoring
  // target, DESIGN.md-only folders stay readable (the compatibility path the
  // _schema contract keeps open).
  if (!manifest && design === null) return null;

  const header = design ? parseDesignHeader(design) : { category: null, blurb: "" };
  const css = await readText(path.join(dir, "tokens.css"));

  return {
    id,
    name: manifest?.name ?? id,
    category: manifest?.category ?? header.category ?? "Uncategorised",
    blurb: header.blurb || manifest?.description || "",
    swatches: css ? parseSwatches(css) : {},
    hasPreview: await exists(path.join(dir, "components.html")),
    // Which root it came out of, not what its manifest claims: location is the
    // fact, `"authored": true` in a hand-edited manifest is an assertion.
    authored,
  };
}

/** Manifest-declared preview pages that resolve inside the package and exist. */
async function previewPages(dir: string, manifest: PackageManifest | null): Promise<DesignSystemPreviewPage[]> {
  const declared = manifest?.preview?.pages ?? [];
  const out: DesignSystemPreviewPage[] = [];
  for (const page of declared) {
    if (typeof page?.path !== "string") continue;
    let target: string;
    try {
      target = safeResolve(dir, page.path);
    } catch (err) {
      // A manifest that points outside its own directory reports no page.
      if (err instanceof PathSafetyError) continue;
      throw err;
    }
    if (!(await exists(target))) continue;
    out.push({ path: page.path, role: page.role ?? "", title: page.title ?? page.path });
  }
  return out;
}

/**
 * Design sessions drawn with this system — seam rule 3's "what this made".
 *
 * Derived from the design manifests themselves (`design.json.designSystem`),
 * because nothing stores the reverse index. ponytail: O(projects × designs)
 * JSON reads per detail request; the store has no cross-project design query
 * and adding one for a detail pane is a bigger change than the scan. Ceiling —
 * a few hundred designs; build the index when the scan is felt.
 */
async function usedBy(id: string): Promise<DesignSystemUse[]> {
  let projectIds: string[];
  try {
    projectIds = await readdir(CENTRAL_PROJECTS_DIR);
  } catch {
    return [];
  }
  const out: DesignSystemUse[] = [];
  for (const projectId of projectIds) {
    if (!isSafeSegment(projectId)) continue;
    const designs = await listDesigns(projectId).catch(() => []);
    for (const design of designs) {
      if (design.designSystem !== id) continue;
      out.push({
        projectId,
        designId: design.id,
        title: design.title,
        status: design.status,
        updatedAt: design.updatedAt,
      });
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One root's packages. A root that does not exist contributes none, not a 500. */
async function listRoot(root: string, authored: boolean): Promise<DesignSystemSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const systems: DesignSystemSummary[] = [];
  for (const entry of entries.sort()) {
    // `_schema/` holds the contracts, not a package.
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    if (!isSafeSegment(entry)) continue;
    const summary = await summarise(root, entry, authored).catch(() => null);
    if (summary) systems.push(summary);
  }
  return systems;
}

/** Vendored ∪ authored, by id. Disjoint — the wizard never takes a vendored id. */
async function list(): Promise<DesignSystemsResponse> {
  const systems = [
    ...(await listRoot(designSystemsRoot(), false)),
    ...(await listRoot(authoredDesignSystemsRoot(), true)),
  ];
  return { systems: systems.sort((a, b) => a.id.localeCompare(b.id)) };
}

async function detail(root: string, id: string, authored: boolean): Promise<DesignSystemDetail | null> {
  const summary = await summarise(root, id, authored);
  if (!summary) return null;
  const dir = path.join(root, id);
  const manifest = await readJson(path.join(dir, "manifest.json"));
  return {
    ...summary,
    design: (await readText(path.join(dir, "DESIGN.md"))) ?? "",
    tokensCss: (await readText(path.join(dir, "tokens.css"))) ?? "",
    preview: await readText(path.join(dir, "components.html")),
    previewPages: await previewPages(dir, manifest),
    usedBy: await usedBy(id),
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id");
  const headers = { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" };

  if (id === null) {
    return NextResponse.json(await list(), { headers });
  }
  // A traversal attempt is rejected before it ever reaches the filesystem —
  // ids are bare directory names, so anything with a separator is invalid.
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: "Invalid design system id" }, { status: 400 });
  }
  const located = await rootForSystem(id);
  const found = located === null ? null : await detail(located.root, id, located.authored);
  if (!found) {
    return NextResponse.json({ error: `Design system not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(found, { headers });
}
