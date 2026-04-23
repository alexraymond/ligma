/**
 * Renderer-safe basename. Node's `path` module isn't available in the
 * sandbox, so we do a tiny string split — good enough for display-only
 * uses (workspace chip, breadcrumb labels).
 */
export function basename(pathLike: string): string {
  if (pathLike.length === 0) return '';
  const trimmed = pathLike.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
