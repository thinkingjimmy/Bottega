/**
 * [INPUT]: Depends on shared AppLocale; Written in the current valid language by the renderer I18nProvider
 * [OUTPUT]: Provides snapshots of the current language, Intl locale mapping and subscription interface
 * [POS]: Non-React locale boundaries of the renderer, allowing pure formatting functions to use the same valid language as React
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

export function subscribeEffectiveLocale(listener: () => void) {
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
