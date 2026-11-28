export type SpellcheckLanguage = 'es' | 'es-ar' | 'en';

export const SPELLCHECK_LANGUAGES: readonly SpellcheckLanguage[] = ['es', 'es-ar', 'en'];

export interface SpellcheckPreferences {
  enabled: boolean;
  language: SpellcheckLanguage;
  /** Opt-in: it rewrites what was typed, unlike the underline which only suggests. */
  autoAccent: boolean;
}
