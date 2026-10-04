/**
 * [INPUT]: Depends on Intl.Locale and ordered host language preferences.
 * [OUTPUT]: Provides canonical five-language negotiation, including all Chinese scripts to zh-CN.
 * [POS]: Shared locale authority for native and browser presentation; English is the final fallback.
 */
export const APP_LOCALES = ["zh-CN", "en", "ja", "fr", "es"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const LANGUAGE_PREFERENCES = ["auto", ...APP_LOCALES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];
export const DEFAULT_APP_LOCALE: AppLocale = "en";
export function isAppLocale(value: unknown): value is AppLocale { return APP_LOCALES.includes(value as AppLocale); }
export function resolveAppLocale(preference: string, languages: readonly string[] = []): AppLocale {
  for (const value of preference === "auto" ? languages : [preference]) {
    try {
      const language = new Intl.Locale(value).language;
      if (language === "zh") return "zh-CN";
      if (isAppLocale(language)) return language;
    } catch { /* A malformed preference cannot suppress later supported languages. */ }
  }
  return DEFAULT_APP_LOCALE;
}
