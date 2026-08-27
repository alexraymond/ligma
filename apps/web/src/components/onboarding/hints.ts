/**
 * Milestone-scoped one-shot onboarding — persistence logic (UX spec §11
 * "onboarding funnel (milestone-scoped one-shot hints)").
 *
 * DOM-free on purpose (same reasoning as `components/studio/api.ts`): a
 * `Storage`-shaped parameter instead of importing `window.localStorage`
 * directly is what lets the node-environment vitest suite cover the one-shot
 * rule without a browser.
 *
 * `"first-visit"` keeps the bare legacy key (`mc-onboarded`) rather than
 * `mc-onboarded:first-visit` — it is the literal replacement for the old
 * onboarding modal, and every e2e spec already seeds
 * `localStorage.setItem("mc-onboarded", "true")` in a `beforeEach` to
 * suppress it. Keeping the key identical means that seed line keeps working
 * unchanged; it now suppresses the hint instead of the dialog.
 */
export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function hintStorageKey(id: string): string {
  return id === 'first-visit' ? 'mc-onboarded' : `mc-onboarded:${id}`;
}

export function isHintSeen(storage: HintStorage, id: string): boolean {
  return storage.getItem(hintStorageKey(id)) === 'true';
}

export function markHintSeen(storage: HintStorage, id: string): void {
  storage.setItem(hintStorageKey(id), 'true');
}
