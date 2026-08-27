/**
 * Classify a failed export into the daemon's typed `EXPORTER_*` code, plus a
 * plain-language explanation for it (OD-115).
 *
 * Ported from open-design's `analytics/export-error-code.ts` — but that file
 * existed to *reverse-engineer* a code from a free-text `err.message`, because
 * the desktop export path only ever threw a generic `Error`. ligma's export
 * route already answers `{ error, code }` (see
 * `apps/daemon/.../designs/_did/export/route.ts`'s `exportFailure`), so the
 * only bug to fix is that `exportDesign()` in `./api.ts` was discarding
 * `body.code` on the way to the thrown `Error` (fixed there, alongside this
 * file). No regex message-sniffing needed — the code was always there.
 */

/** Mirrors the `EXPORTER_*` entries in `packages/shared/src/error-codes.ts`.
 *
 * ponytail: duplicated as a small local map rather than importing
 * `@ligma/shared` — apps/web doesn't depend on that package today, and
 * pulling a backend-oriented package (config schemas, provider errors, the
 * whole `ERROR_CODES` registry) into the browser bundle for six strings isn't
 * worth it. If apps/web ever needs more of `@ligma/shared`, delete this map
 * and import `ERROR_CODE_DESCRIPTIONS` instead — keep the two from drifting
 * by eye until then.
 */
const EXPORT_ERROR_EXPLANATIONS: Record<string, string> = {
  EXPORTER_UNKNOWN: 'Unknown export format was requested.',
  EXPORTER_NO_CHROME:
    'Chrome or Chromium was not found on the server. PDF export needs it installed.',
  EXPORTER_PDF_FAILED: 'PDF export failed. Ensure Chrome is installed and try again.',
  EXPORTER_IMAGE_FAILED: 'Image export failed. Ensure Chrome is installed and try again.',
  EXPORTER_PPTX_FAILED: 'PowerPoint export failed.',
  EXPORTER_ZIP_UNSAFE_PATH:
    'Export was blocked: a file path in the design would escape the ZIP archive.',
  EXPORTER_ZIP_FAILED: 'ZIP export failed.',
};

const UNKNOWN_EXPLANATION =
  'Export failed for an unrecognized reason. See the message below for details.';

/** The code a failed `exportDesign()` carries, or `"UNKNOWN"` if it has none. */
export function exportErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN';
}

/** Plain-language explanation for an export error code, for the diagnostics panel. */
export function explainExportError(code: string): string {
  return EXPORT_ERROR_EXPLANATIONS[code] ?? UNKNOWN_EXPLANATION;
}
