/**
 * The Studio's data layer: the daemon calls, plus the pure state helpers the
 * unit tests cover.
 *
 * This file is where the studio map's largest port item lands. ligma-classic
 * routed every Studio interaction through `window.codesign.*` — ~260
 * `ipcRenderer.invoke` call sites behind an Electron `contextBridge` (studio
 * map §7, "the single largest port item"). None of that exists in a browser,
 * so each interaction becomes an HTTP call against `API_ROUTES` here. The
 * interactions are ported; the transport is rebuilt, which is exactly the split
 * the map predicted.
 */

import { apiFetch } from '@/lib/api-client';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import {
  API_ROUTES,
  type CompiledInstructionPreview,
  type CreateDesignAttachmentRequest,
  type CreatePinRequest,
  type DesignAttachment,
  type DesignAttachmentsResponse,
  type DesignManifest,
  type DesignPin,
  type DesignSnapshotSummary,
  type DesignSummary,
  type DesignTranscriptEntry,
  type DesignTurnAccepted,
  type DesignTurnRequest,
  type ProjectShape,
  type PromotePreview,
  type PromoteResult,
  type TweakControl,
  type TweakValue,
} from '@ligma/api';

// ─── Shape gating ────────────────────────────────────────────────────────────

/**
 * Whether this project has a design stage at all.
 *
 * "Only the stages the project uses render — a headless project shows no Design
 * stage and no Studio tab at all, rather than an empty one (an unused stage is
 * noise, an absent one is information)" (UX spec §4). An unconfirmed shape is
 * not a design stage either: the shape is confirmed as one discovery question,
 * and until it is, the project has not said it has a face.
 */
export function studioVisible(shape: ProjectShape | undefined): boolean {
  return shape === 'ui' || shape === 'mixed';
}

// ─── Route helpers ───────────────────────────────────────────────────────────

function route(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(`:${key}`, value),
    template,
  );
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function post(url: string, body: unknown): Promise<Response> {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function designsUrl(projectId: string): string {
  return route(API_ROUTES.projectDesigns, { id: projectId });
}

export function designUrl(projectId: string, designId: string): string {
  return route(API_ROUTES.projectDesign, { id: projectId, did: designId });
}

export function designStreamUrl(projectId: string, designId: string): string {
  return route(API_ROUTES.projectDesignStream, { id: projectId, did: designId });
}

// ─── Designs ─────────────────────────────────────────────────────────────────

export async function listDesigns(projectId: string): Promise<DesignSummary[]> {
  const body = await json<{ designs: DesignSummary[] }>(await apiFetch(designsUrl(projectId)));
  return body.designs;
}

export interface DesignState {
  design: DesignManifest;
  snapshots: DesignSnapshotSummary[];
  turnInFlight: boolean;
}

export async function readDesign(projectId: string, designId: string): Promise<DesignState> {
  return json<DesignState>(await apiFetch(designUrl(projectId, designId)));
}

export async function createDesign(
  projectId: string,
  input: {
    title?: string;
    prompt?: string;
    designSystem?: string;
    /**
     * Reference images for the opening prompt. They ride along with the create
     * because the upload route needs a design id and there isn't one yet —
     * every later turn uploads first and sends ids (`uploadAttachment`).
     */
    attachments?: CreateDesignAttachmentRequest[];
  },
): Promise<{ design: DesignSummary; turn: DesignTurnAccepted | null }> {
  return json(await post(designsUrl(projectId), input));
}

/**
 * Swap the design system mid-session. It takes effect on the next turn — the
 * design on the canvas was drawn against the old one and stays that way until
 * you ask for something.
 */
export async function updateDesign(
  projectId: string,
  designId: string,
  input: { designSystem: string | null },
): Promise<DesignManifest> {
  const body = await json<{ design: DesignManifest }>(
    await apiFetch(designUrl(projectId, designId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  return body.design;
}

/** Store one reference image against a design; returns what it became. */
export async function uploadAttachment(
  projectId: string,
  designId: string,
  input: CreateDesignAttachmentRequest,
): Promise<DesignAttachment> {
  const body = await json<DesignAttachmentsResponse>(
    await post(route(API_ROUTES.projectDesignAttachments, { id: projectId, did: designId }), input),
  );
  if (!body.attachment)
    throw new Error('The daemon stored the image but did not say which entry it became');
  return body.attachment;
}

export async function sendTurn(
  projectId: string,
  designId: string,
  turn: DesignTurnRequest,
): Promise<DesignTurnAccepted> {
  return json<DesignTurnAccepted>(
    await post(route(API_ROUTES.projectDesignTurn, { id: projectId, did: designId }), turn),
  );
}

export async function interruptTurn(projectId: string, designId: string): Promise<void> {
  await apiFetch(route(API_ROUTES.projectDesignTurn, { id: projectId, did: designId }), {
    method: 'DELETE',
  });
}

export async function approveDesign(projectId: string, designId: string): Promise<void> {
  await json(
    await post(route(API_ROUTES.projectDesignApprove, { id: projectId, did: designId }), {}),
  );
}

// ─── File bodies ─────────────────────────────────────────────────────────────

export interface DesignFileBody {
  path: string;
  body: string;
}

/**
 * Source bodies for the current version, for the Wall's iframes.
 *
 * **Known gap (reported to the conductor):** the Phase 3 design API has no
 * file-content route. `DesignManifest.versions[].files[]` carries a path, a
 * SHA-256 fingerprint and a byte size — enough to list a design, not enough to
 * render one. `GET /api/projects/:id/designs/:did/files` is the missing sibling
 * of `verification-runs`' artifact route. Until it lands this resolves to an
 * empty list and every card renders its "preview unavailable" plate rather than
 * a blank iframe, so the failure is legible instead of silent.
 */
/**
 * Bodies for one version. Defaults to the head version; pass `versionId` to
 * read an older one — the `/files` route serves both off the same
 * content-addressed store (OD-049: this is what lets the version rail's code
 * viewer show a past version's source, not only the current one).
 */
export async function readDesignFiles(
  projectId: string,
  designId: string,
  versionId?: string,
): Promise<DesignFileBody[]> {
  const url = `${designUrl(projectId, designId)}/files${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`;
  const res = await apiFetch(url, { retries: 0 });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { files?: DesignFileBody[] } | null;
  return body?.files ?? [];
}

// ─── Turn transcript ─────────────────────────────────────────────────────────

/**
 * The conversation so far, as the append records the SSE lane also carries —
 * one fold on the client turns either source into messages (`transcript.ts`).
 * An unreachable daemon resolves to an empty transcript rather than throwing:
 * the composer must still open, and the stream will fill it once it connects.
 */
export async function readTurnTranscript(
  projectId: string,
  designId: string,
): Promise<DesignTranscriptEntry[]> {
  const res = await apiFetch(
    route(API_ROUTES.projectDesignTranscript, { id: projectId, did: designId }),
    {
      retries: 0,
    },
  );
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { entries?: DesignTranscriptEntry[] } | null;
  return body?.entries ?? [];
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** The formats `packages/exporters` ships, in the order the menu offers them. */
export const EXPORT_FORMATS = [
  { format: 'zip', label: 'ZIP bundle (all screens)' },
  { format: 'html', label: 'Standalone HTML' },
  { format: 'pdf', label: 'PDF' },
  { format: 'pptx', label: 'Deck (PPTX)' },
  { format: 'markdown', label: 'Markdown' },
  { format: 'png', label: 'PNG image' },
  { format: 'jpeg', label: 'JPEG image' },
  { format: 'webp', label: 'WebP image' },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['format'];

/** The filename the daemon named, so the download keeps the design's name. */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Download a design in one of the exporter formats (D7 DC-1).
 *
 * Fetched rather than linked so an export failure lands in the app's own error
 * copy — a missing system Chrome answers 503 with `EXPORTER_NO_CHROME` — instead
 * of dumping a JSON body into a browser tab (OD-115: the parent had an export
 * diagnostics button; a raw 500 page is not one).
 *
 * The thrown `Error` carries the daemon's `code` (an `EXPORTER_*` string) as a
 * `.code` property — `export-error-code.ts` reads it back out for the
 * diagnostics panel. This used to be dropped on the floor here, which is the
 * one thing that needed fixing to make OD-115's "typed codes already flow to
 * the user" true: the daemon always sent the code, this just wasn't keeping it.
 */
export async function exportDesign(
  projectId: string,
  designId: string,
  format: ExportFormat,
): Promise<{ filename: string; blob: Blob }> {
  const res = await apiFetch(`${designUrl(projectId, designId)}/export?format=${format}`, {
    retries: 0,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw Object.assign(new Error(body?.error ?? `Export failed (${res.status})`), {
      code: body?.code ?? 'UNKNOWN',
    });
  }
  return {
    filename: filenameFromDisposition(res.headers.get('content-disposition')) ?? `design.${format}`,
    blob: await res.blob(),
  };
}

// ─── Pins ────────────────────────────────────────────────────────────────────

export async function listPins(projectId: string, designId: string): Promise<DesignPin[]> {
  const body = await json<{ pins: DesignPin[] }>(
    await apiFetch(route(API_ROUTES.projectDesignPins, { id: projectId, did: designId })),
  );
  return body.pins;
}

export async function createPin(
  projectId: string,
  designId: string,
  input: CreatePinRequest,
): Promise<DesignPin> {
  return json<DesignPin>(
    await post(route(API_ROUTES.projectDesignPins, { id: projectId, did: designId }), input),
  );
}

export async function updatePin(
  projectId: string,
  designId: string,
  input: { pinId: string; text?: string; scope?: DesignPin['scope']; remove?: boolean },
): Promise<void> {
  const res = await apiFetch(
    route(API_ROUTES.projectDesignPins, { id: projectId, did: designId }),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  await json(res);
}

/**
 * What "Apply (N)" would send, byte for byte.
 *
 * F4's whole complaint about ligma-classic is that Apply was an invisible batch
 * re-generation. The daemon compiles this with the same function the turn uses,
 * so showing it is disclosure rather than reassurance — which is why the
 * dialog renders `instruction` verbatim in a `<pre>` and never summarises it.
 */
export async function previewPinInstruction(
  projectId: string,
  designId: string,
  input: { pinIds?: string[]; prompt?: string },
): Promise<CompiledInstructionPreview> {
  return json<CompiledInstructionPreview>(
    await post(route(API_ROUTES.projectDesignPinsPreview, { id: projectId, did: designId }), input),
  );
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export async function restoreSnapshot(
  projectId: string,
  designId: string,
  versionId: string,
): Promise<void> {
  await json(
    await post(route(API_ROUTES.projectDesignSnapshots, { id: projectId, did: designId }), {
      versionId,
    }),
  );
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export async function promotePreview(
  projectId: string,
  input: { designId?: string; brief?: string },
): Promise<PromotePreview> {
  return json<PromotePreview>(
    await post(route(API_ROUTES.projectPromotePreview, { id: projectId }), input),
  );
}

export async function promote(projectId: string, preview: PromotePreview): Promise<PromoteResult> {
  return json<PromoteResult>(
    await post(route(API_ROUTES.projectPromote, { id: projectId }), { preview }),
  );
}

// ─── Pure state helpers (unit-tested) ────────────────────────────────────────

/** The chips above the composer: pending pins only, oldest first. */
export function stagedPins(pins: DesignPin[]): DesignPin[] {
  return pins.filter((pin) => pin.status === 'pending');
}

/**
 * The turn a pin was applied by — F4's "each applied pin links to the turn that
 * applied it". `appliedInVersionId` is that link; the rail resolves it to a
 * version number so the UI can say "v4" rather than an opaque id.
 */
export function pinAppliedIn(
  pin: DesignPin,
  snapshots: DesignSnapshotSummary[],
): DesignSnapshotSummary | null {
  if (pin.appliedInVersionId === null) return null;
  return snapshots.find((s) => s.versionId === pin.appliedInVersionId) ?? null;
}

/**
 * Version-rail selection for the before/after compare.
 *
 * Clicking a second version opens the compare; clicking a selected version
 * clears it; a third click replaces the older half so the pair is always the
 * two most recently clicked. Selection is kept sorted by `n` so "before" is
 * always the lower version, whichever order the user clicked in.
 */
export function toggleCompare(selection: string[], versionId: string): string[] {
  if (selection.includes(versionId)) return selection.filter((id) => id !== versionId);
  if (selection.length < 2) return [...selection, versionId];
  return [selection[1], versionId];
}

export interface ComparePair {
  before: DesignSnapshotSummary;
  after: DesignSnapshotSummary;
}

export function comparePair(
  selection: string[],
  snapshots: DesignSnapshotSummary[],
): ComparePair | null {
  if (selection.length !== 2) return null;
  const picked = selection
    .map((id) => snapshots.find((s) => s.versionId === id))
    .filter((s): s is DesignSnapshotSummary => s !== undefined)
    .sort((a, b) => a.n - b.n);
  if (picked.length !== 2) return null;
  return { before: picked[0], after: picked[1] };
}

/** One file's fate between two versions. */
export interface FileChange {
  path: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
}

/**
 * The before/after compare, computed from what a version actually records.
 *
 * A `DesignVersion` lists its files by SHA-256 fingerprint, so "did this file
 * change between v3 and v7" is an exact answer, not an estimate — that is the
 * dividend of content-addressed snapshots (CONTRACTS-phase3: content-addressed
 * blobs, not full-body SQLite rows). Unchanged files sort
 * last so the diff leads with what moved.
 */
export function versionDiff(
  before: { path: string; fingerprint: string }[],
  after: { path: string; fingerprint: string }[],
): FileChange[] {
  const beforeMap = new Map(before.map((f) => [f.path, f.fingerprint]));
  const afterMap = new Map(after.map((f) => [f.path, f.fingerprint]));
  const rank = { added: 0, removed: 1, changed: 2, unchanged: 3 } as const;

  const changes: FileChange[] = [];
  for (const [path, fingerprint] of afterMap) {
    const previous = beforeMap.get(path);
    if (previous === undefined) changes.push({ path, change: 'added' });
    else changes.push({ path, change: previous === fingerprint ? 'unchanged' : 'changed' });
  }
  for (const path of beforeMap.keys()) {
    if (!afterMap.has(path)) changes.push({ path, change: 'removed' });
  }
  return changes.sort((a, b) => rank[a.change] - rank[b.change] || a.path.localeCompare(b.path));
}

/**
 * The version rail's "when" (F6): a relative label for the row ("3h ago"),
 * with the absolute date+time for the hover `title=` so precision is a
 * hover away rather than lost entirely. Built on the app's one shared
 * time-formatting surface (lib/time.ts) rather than hand-rolled here.
 */
export function versionTimeLabel(
  createdAt: string,
  now?: number,
): { relative: string; absolute: string } {
  return {
    relative: formatRelativeTime(createdAt, now),
    absolute: formatDateTime(createdAt, now),
  };
}

/**
 * The control to render for one tweak token.
 *
 * The agent's `declare_tweak_schema` is advisory in ligma-classic and advisory
 * here (`TweakControl`'s docstring): a token the agent forgot to declare still
 * gets a control, inferred from its value's shape, so the panel never silently
 * drops a token. Ported from `TweakPanel.tsx`'s fallback heuristic.
 */
export function controlFor(schema: TweakControl | undefined, value: TweakValue): TweakControl {
  if (schema) return schema;
  if (typeof value === 'boolean') return { kind: 'boolean', live: true };
  if (typeof value === 'number')
    return { kind: 'number', min: 0, max: value * 2 || 100, step: 1, live: true };
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return { kind: 'color', live: true };
  return { kind: 'string', live: true };
}
