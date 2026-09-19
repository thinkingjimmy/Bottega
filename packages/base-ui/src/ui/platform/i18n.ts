/**
 * [INPUT]: Depends on host i18next context and the canonical English Base catalog.
 * [OUTPUT]: Provides Base translation, isolated lazy browser language instances and BaseLanguageProvider.
 * [POS]: Presentation boundary; never changes the application's global language or catalog instance.
 */
import { createElement, useContext, type ReactNode } from "react";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider, I18nContext, getI18n, useTranslation } from "react-i18next";
import { basesEn } from "../../i18n/en";
const fallback = createInstance();
void fallback.init({ lng: "en", fallbackLng: "en", initAsync: false, returnNull: false,
  interpolation: { escapeValue: false }, resources: { en: { translation: { bases: basesEn, common: { save: "Save", cancel: "Cancel" } } } } });
export function useAppTranslation() {
  const host = useContext(I18nContext);
  return useTranslation(undefined, { i18n: host?.i18n ?? getI18n() ?? fallback });
}
export async function createBaseLanguage(locale: string, common: { save: string; cancel: string }) {
  const code = locale.toLowerCase().split("-")[0];
  const bases = code === "zh" ? (await import("../../i18n/zh-cn")).basesZhCN : code === "ja" ? (await import("../../i18n/ja")).basesJa :
    code === "fr" ? (await import("../../i18n/fr")).basesFr : code === "es" ? (await import("../../i18n/es")).basesEs : basesEn;
  const language = createInstance();
  await language.init({ lng: locale, fallbackLng: "en", initAsync: false, returnNull: false, interpolation: { escapeValue: false },
    resources: { [locale]: { translation: { bases, common } }, en: { translation: { bases: basesEn, common: { save: "Save", cancel: "Cancel" } } } } });
  return language;
}
export function BaseLanguageProvider({ language, children }: { language: i18n; children: ReactNode }) {
  return createElement(I18nextProvider, { i18n: language }, children);
}
