/**
 * Evidence pins (UX spec F6) — the human points at the defect in the verdict's
 * own evidence, and **the pointing itself becomes the instruction**.
 *
 * A pin is a normalized coordinate on one evidence screenshot plus a comment.
 * It compiles into a structured instruction block — ligma-classic's
 * `buildEnrichedPrompt` shape (studio map §6) — which becomes either feedback
 * on the fix task's next builder prompt or a brand-new task.
 *
 * Coordinates are normalized 0..1 rather than pixels so a pin lands in the same
 * place whatever width the image is rendered at.
 *
 * `compilePinInstructions` lives here rather than in the daemon because both
 * sides run it: the daemon hands it to the prompt builder, and the pin popover
 * previews it before the human commits — same rationale as `deck.ts`.
 */

/** What the pointing becomes. The human picks in the pin's popover. */
export type PinDisposition = 'feedback' | 'new-task';

interface EvidencePinBase {
  /** "pin_<timestamp>". */
  id: string;
  projectId: string;
  /** The verification run whose evidence carries this pin. */
  runId: string;
  /** Run-relative evidence path, e.g. "screenshots/step-3.png". */
  evidencePath: string;
  comment: string;
  disposition: PinDisposition;
  /**
   * The task whose next builder prompt carries this pin (`feedback`), or the
   * task the pin created (`new-task`). Null when the verdict has no task —
   * a journey run — and the pin is filed against the project alone.
   */
  taskId: string | null;
  createdAt: string;
}

/** A pin placed on a rendered screenshot. */
export interface ImageEvidencePin extends EvidencePinBase {
  kind: 'image';
  /** 0..1 across the image's width and height. */
  x: number;
  y: number;
}

/**
 * A pin placed on a **record** — a transcript line, a bridge record, a stdout
 * capture. The shape a headless project's evidence actually has: there is no
 * picture to point at, so the pointing is a line index or a field reference
 * instead of a coordinate.
 *
 * Both may be null: pinning the record as a whole ("this response is wrong") is
 * a legitimate thing to point at, and inventing a line for it would be a lie.
 */
export interface RecordEvidencePin extends EvidencePinBase {
  kind: 'record';
  /** 0-based line within a JSONL/stdout capture. */
  line: number | null;
  /** Dotted field path into a JSON record, e.g. "response.status". */
  field: string | null;
}

export type EvidencePin = ImageEvidencePin | RecordEvidencePin;

/**
 * Pins written before records were pinnable carry no `kind` and are images.
 * One place normalizes them so no reader has to know that history.
 */
export function normalizeEvidencePin(
  raw: EvidencePin | (Omit<ImageEvidencePin, 'kind'> & { kind?: 'image' }),
): EvidencePin {
  return 'kind' in raw && raw.kind !== undefined
    ? (raw as EvidencePin)
    : { ...(raw as Omit<ImageEvidencePin, 'kind'>), kind: 'image' };
}

/** Where a pin points, said in words. The instruction block's provenance line. */
export function pinLocation(pin: EvidencePin): string {
  if (pin.kind === 'image') {
    return `${pin.evidencePath} at ${pctOf(pin.x)}% across, ${pctOf(pin.y)}% down`;
  }
  if (pin.line !== null) return `${pin.evidencePath} line ${pin.line + 1}`;
  if (pin.field !== null) return `${pin.evidencePath} field \`${pin.field}\``;
  return pin.evidencePath;
}

/**
 * Compile pins into one instruction block for a builder prompt. Empty in, empty
 * out — a task with no pins appends nothing.
 *
 * The wording mirrors the studio map's `buildEnrichedPrompt`: an explicit
 * "do not skip any" header, then one addressable item per pin carrying enough
 * provenance for the builder to open the evidence itself.
 */
export function compilePinInstructions(pins: EvidencePin[]): string {
  if (pins.length === 0) return '';
  const lines = [
    "## REQUIRED FIXES — pinned by the reviewer on this verdict's own evidence",
    '',
    'Each item below was pointed at directly in the evidence of a verification',
    'run — a screenshot, or a recorded request/response. Address every one; do',
    'not skip any.',
    '',
  ];
  pins.forEach((pin, i) => {
    lines.push(`${i + 1}. ${pin.comment.trim()}`);
    lines.push(`   — evidence: ${pinLocation(pin)} (run ${pin.runId})`);
  });
  return lines.join('\n');
}

function pctOf(value: number): number {
  return Math.round(value * 100);
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/**
 * `POST /api/projects/:id/evidence-pins`.
 *
 * `kind` defaults to `"image"` so the screenshot path is unchanged; a record pin
 * sends `kind: "record"` with `line` or `field` (or neither, to point at the
 * whole record) and no coordinates.
 */
export interface CreateEvidencePinRequest {
  runId: string;
  evidencePath: string;
  kind?: 'image' | 'record';
  /** Image pins only, 0..1. */
  x?: number;
  y?: number;
  /** Record pins only: 0-based line within the capture. */
  line?: number | null;
  /** Record pins only: dotted field path into a JSON record. */
  field?: string | null;
  comment: string;
  disposition: PinDisposition;
  /** Required for `feedback`: which task's next prompt carries it. */
  taskId?: string;
  /** For `new-task`: the title of the task to create. Defaults to the comment. */
  title?: string;
}

export interface EvidencePinListResponse {
  projectId: string;
  pins: EvidencePin[];
  /** The compiled block for `pins`, so a caller never re-derives it. */
  instruction: string;
}

/** `GET /api/tasks/:id/evidence-pins` — what the fix-task prompt builder reads. */
export interface TaskEvidencePinsResponse {
  taskId: string;
  pins: EvidencePin[];
  instruction: string;
}
