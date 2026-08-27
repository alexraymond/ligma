/**
 * Client-side helpers shared by the References screenshot upload and the
 * Design Files upload — same caps the daemon enforces (`references/_id/route.ts`,
 * `references/_id/design-files/route.ts`), checked here first so a user finds
 * out a file is too big before spending the upload.
 */

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_DESIGN_FILE_BYTES = 10_000_000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `null` when the file is within the cap, else the message to show the user. */
export function validateFileSize(file: { size: number }, maxBytes: number): string | null {
  if (file.size > maxBytes) {
    return `${formatBytes(file.size)} exceeds the ${formatBytes(maxBytes)} cap`;
  }
  return null;
}

/** `Blob` covers both `File` (browser) and anything File-like in tests. */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
