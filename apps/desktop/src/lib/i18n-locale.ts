/**
 * [INPUT]: Depends on shared AppLocale; set by the renderer I18nProvider to the current effective locale
 * [OUTPUT]: Provides the current-locale snapshot, Intl locale mapping (intlLocale), and a subscription interface (useEffectiveLocale)
 * [POS]: Non-React locale boundary in the renderer; lets pure formatting functions read the same effective locale as React components
 */

import type { AppLocale } from "../../shared/i18n/locale";
import { useSyncExternalStore } from "react";

const INTL_LOCALES: Record<AppLocale, string> = {
  "zh-CN": "zh-CN",
  en: "en-US",
  ja: "ja-JP",
  fr: "fr-FR",
  es: "es-ES",
};

let currentLocale: AppLocale = "en";
const listeners = new Set<() => void>();

export function setEffectiveLocale(locale: AppLocale) {
  if (currentLocale === locale) return;
  currentLocale = locale;
  for (const listener of listeners) listener();
}

export function effectiveLocale() {
  return currentLocale;
}

export function intlLocale(locale = currentLocale) {
  return INTL_LOCALES[locale];
}

function subscribeEffectiveLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEffectiveLocale() {
  return useSyncExternalStore(
    subscribeEffectiveLocale,
    effectiveLocale,
    effectiveLocale
  );
}
