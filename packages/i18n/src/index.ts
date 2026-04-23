/**
 * i18n entry point for ligma.
 *
 * Currently English-only. The plumbing remains in place — adding a locale
 * means registering its JSON under `./locales/` and extending `resources` +
 * `availableLocales`. We do NOT silently swallow missing keys: in dev they
 * render as `⟦key⟧` so they're visible in the UI, and a `console.warn` records
 * every miss. (Principle §10: no silent fallbacks.)
 */

import i18next from 'i18next';
import { useCallback } from 'react';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';

export const availableLocales = ['en'] as const;
export type Locale = (typeof availableLocales)[number];

const DEFAULT_LOCALE: Locale = 'en';

const resources = {
  en: { translation: en },
} as const;

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return value === 'en';
}

export function normalizeLocale(_value: string | undefined | null): Locale {
  return DEFAULT_LOCALE;
}

let initialized = false;

function detectIsDev(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.['NODE_ENV'] !== 'production';
}

export async function initI18n(locale: string | undefined): Promise<Locale> {
  const target = normalizeLocale(locale);
  if (initialized) return target;

  const isDev = detectIsDev();

  await i18next.use(initReactI18next).init({
    resources,
    lng: target,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...availableLocales],
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: (lngs, ns, key) => {
      const lang = Array.isArray(lngs) ? lngs.join(',') : String(lngs);
      console.warn(
        `[i18n] missing translation key "${key}" in namespace "${ns}" for locale "${lang}"`,
      );
    },
    parseMissingKeyHandler: (key) => {
      if (isDev) return `\u27E6${key}\u27E7`;
      return key;
    },
    react: { useSuspense: false },
  });

  initialized = true;
  return target;
}

export async function setLocale(locale: string): Promise<Locale> {
  const target = normalizeLocale(locale);
  if (!initialized) {
    return initI18n(target);
  }
  return target;
}

export function getCurrentLocale(): Locale {
  return normalizeLocale(i18next.language);
}

export function useT(): (key: string, options?: Record<string, unknown>) => string {
  const { t, i18n } = useTranslation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity must track locale, not `t`.
  return useCallback((key, options) => t(key, options ?? {}) as string, [i18n.language]);
}

export { i18next as i18n };
export { useTranslation } from 'react-i18next';
