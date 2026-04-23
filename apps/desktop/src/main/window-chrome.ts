import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { app } from './electron-runtime';

/**
 * Ligma window-chrome helpers. Extracted from main/index.ts so behaviour can
 * be unit-tested with mocked Electron — the source-grep assertions we shipped
 * first round didn't verify invocation, only string presence.
 *
 * This module stays inside the workstream's `region:window-chrome`: the two
 * exported functions are called from that region in main/index.ts.
 */
export const LIGMA_WINDOW_TITLE = 'Ligma';

/**
 * Pins the BrowserWindow title to `LIGMA_WINDOW_TITLE` both immediately and
 * on every subsequent `page-title-updated` event from the renderer. Electron
 * re-syncs the window title from `webContents.title` on navigation; without
 * the intercept it briefly reverts to the pre-load document title.
 */
export function applyLigmaWindowChrome(win: ElectronBrowserWindow): void {
  win.setTitle(LIGMA_WINDOW_TITLE);
  win.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(LIGMA_WINDOW_TITLE);
  });
}

/**
 * Registers the About-panel metadata for the app. On macOS the native "About
 * Ligma" panel reads from `app.setAboutPanelOptions`; everywhere else we at
 * least set `app.name` so `role: 'appMenu'` entries show the right label.
 */
export function registerLigmaAboutPanel(): void {
  if (process.platform === 'darwin' && typeof app.setAboutPanelOptions === 'function') {
    app.setAboutPanelOptions({
      applicationName: LIGMA_WINDOW_TITLE,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: `© ${new Date().getFullYear()} Ligma`,
    });
  }
  if (typeof app.setName === 'function') {
    app.setName(LIGMA_WINDOW_TITLE);
  }
}
