import type { Locale } from '@ligma/i18n';
import { normalizeLocale } from '@ligma/i18n';
import { enDemos } from './locales/en';

export { SYSTEM_PROMPTS, type SystemPromptId } from './system/index';
export {
  EXAMPLES,
  getExample,
  getExamples,
  type Example,
  type ExampleCategory,
  type ExampleContent,
  type LocalizedExample,
} from './examples/index';

export interface DemoTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

const REGISTRY: Record<Locale, DemoTemplate[]> = {
  en: enDemos,
};

export function getDemos(locale: string | undefined): DemoTemplate[] {
  return REGISTRY[normalizeLocale(locale)];
}

export function getDemo(id: string, locale?: string): DemoTemplate | undefined {
  return getDemos(locale).find((d) => d.id === id);
}

/**
 * @deprecated Use `getDemos(locale)`. Kept as an English-only alias so existing
 * imports do not break while the renderer migrates to the locale-aware API.
 */
export const BUILTIN_DEMOS: DemoTemplate[] = enDemos;
