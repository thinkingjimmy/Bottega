/**
 * [INPUT]: Depends on the standard Intl.Locale, not dependent on Electron or the browser overall
 * [OUTPUT]: Provides AppLocale/LanguagePreference constants, AppLocale validation, and automatic locale detection
 * [POS]: The desktop i18n language is a single truth source, shared with the settings, main, preload and renderer
 */

export const APP_LOCALES = ["zh-CN", "en", "ja", "fr", "es"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const LANGUAGE_PREFERENCES = ["auto", ...APP_LOCALES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "en";

export function isAppLocale(value: unknown): value is AppLocale {
  return APP_LOCALES.includes(value as AppLocale);
}

function detectedLocale(value: string): AppLocale | null {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(value).maximize();
  } catch {
    return null;
  }
  if (locale.language === "zh") {
    return locale.script === "Hans" ? "zh-CN" : null;
  }
  if (locale.language === "en") return "en";
  if (locale.language === "ja") return "ja";
  if (locale.language === "fr") return "fr";
  if (locale.language === "es") return "es";
  return null;
}

/** Auto 按用户的语言优先序命中第一种受支持语言，整列未命中才回落英语。 */
export function resolveAppLocale(
  preference: LanguagePreference,
  preferredLanguages: readonly string[]
): AppLocale {
  if (preference !== "auto") return preference;
  for (const language of preferredLanguages) {
    const locale = detectedLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_APP_LOCALE;
}
