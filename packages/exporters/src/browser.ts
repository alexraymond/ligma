/**
 * The one way this package gets a browser: the user's own installed Chrome,
 * driven through `puppeteer-core`.
 *
 * Extracted when image export landed beside PDF export — both need the same
 * discovery + launch flags, and two copies of "which Chrome, with which
 * sandbox args" is exactly the pair that drifts. Still lazy-imported, so
 * `puppeteer-core` only enters the module graph when somebody actually
 * exports (PRINCIPLES §1).
 */

export async function launchChrome(chromePath?: string) {
  const { findSystemChrome } = await import('./chrome-discovery');
  const puppeteer = (await import('puppeteer-core')).default;

  // The page we are about to render is model-authored HTML with live network
  // access, so the renderer sandbox stays ON. `--no-sandbox` is only kept for
  // the one case where Chrome genuinely refuses to sandbox — running as uid 0
  // (CI containers) — instead of being handed out unconditionally (P20).
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  return puppeteer.launch({
    executablePath: chromePath ?? (await findSystemChrome()),
    headless: true,
    args: [...(runningAsRoot ? ['--no-sandbox'] : []), '--disable-dev-shm-usage'],
  });
}
