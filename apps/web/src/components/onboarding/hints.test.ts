import { describe, expect, it } from 'vitest';
import { type HintStorage, hintStorageKey, isHintSeen, markHintSeen } from './hints';

function memoryStorage(): HintStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('hintStorageKey', () => {
  it('first-visit keeps the bare legacy key so existing e2e seeding still suppresses it', () => {
    expect(hintStorageKey('first-visit')).toBe('mc-onboarded');
  });

  it('every other milestone gets its own namespaced key', () => {
    expect(hintStorageKey('first-project')).toBe('mc-onboarded:first-project');
    expect(hintStorageKey('first-design')).toBe('mc-onboarded:first-design');
  });
});

describe('isHintSeen / markHintSeen', () => {
  it('is unseen until marked', () => {
    const storage = memoryStorage();
    expect(isHintSeen(storage, 'first-project')).toBe(false);
    markHintSeen(storage, 'first-project');
    expect(isHintSeen(storage, 'first-project')).toBe(true);
  });

  it('marking one milestone does not seed another — no shared state', () => {
    const storage = memoryStorage();
    markHintSeen(storage, 'first-design');
    expect(isHintSeen(storage, 'first-promote')).toBe(false);
  });

  it("a stray truthy-looking value that isn't the literal 'true' does not count as seen", () => {
    const storage = memoryStorage();
    storage.setItem(hintStorageKey('first-verdict'), '1');
    expect(isHintSeen(storage, 'first-verdict')).toBe(false);
  });
});
