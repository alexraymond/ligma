import { describe, expect, it, vi } from 'vitest';
import {
  availableLocales,
  getCurrentLocale,
  initI18n,
  isSupportedLocale,
  normalizeLocale,
  setLocale,
} from './index';

describe('normalizeLocale', () => {
  it('always returns en (single-locale build)', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });
});

describe('isSupportedLocale', () => {
  it('matches exactly the available locales', () => {
    for (const code of availableLocales) {
      expect(isSupportedLocale(code)).toBe(true);
    }
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});

describe('initI18n + setLocale', () => {
  it('boots and serves translated strings for en', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    expect(i18n.t('chat.placeholder')).toBe('Describe what to design…');
    expect(i18n.t('common.send')).toBe('Send');
  });

  it('warns and surfaces a visible marker when a key is missing', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = i18n.t('common.thisKeyDoesNotExist');
    expect(value).toContain('thisKeyDoesNotExist');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('setLocale always resolves to en', async () => {
    await initI18n('en');
    expect(getCurrentLocale()).toBe('en');
    expect(await setLocale('fr-FR')).toBe('en');
    expect(getCurrentLocale()).toBe('en');
  });
});

describe('onboarding i18n keys (Welcome / PasteKey / ChooseModel)', () => {
  it('returns correct English strings for all onboarding screens', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');

    expect(i18n.t('onboarding.welcome.title')).toBe('Design with any model.');
    expect(i18n.t('onboarding.welcome.tryFree')).toBe('Try free now');
    expect(i18n.t('onboarding.welcome.useKey')).toBe('Use my API key');
    expect(i18n.t('onboarding.welcome.whereToGetKey')).toBe('Where to get a key');

    expect(i18n.t('onboarding.paste.title')).toBe('Paste your API key');
    expect(i18n.t('onboarding.paste.back')).toBe('Back');
    expect(i18n.t('onboarding.paste.continue')).toBe('Continue');
    expect(i18n.t('onboarding.paste.connectionTest.button')).toBe('Test');
    expect(i18n.t('onboarding.paste.connectionTest.ok')).toBe('Connected');

    expect(i18n.t('onboarding.choose.title')).toBe('Pick default models');
    expect(i18n.t('onboarding.choose.finish')).toBe('Finish');
    expect(i18n.t('onboarding.choose.back')).toBe('Back');
  });
});
