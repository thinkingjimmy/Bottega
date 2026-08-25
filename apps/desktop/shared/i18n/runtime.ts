/**
 * [INPUT]: Depends on i18next, locale Element Group with static English directory (all other languages are registered by the caller)
 * [OUTPUT]: Provides directory registry register Catalog/hasCatalog, synchronized i18n instance factory with main available translate
 * [POS]: the sole holder of the boundary and directory when running desktop i18n; English permanent, non-English by main Full-size pitch or renderer Registration on request
 */

import i18next, { type i18n, type TOptions } from "i18next";
import { APP_LOCALES, type AppLocale } from "./locale";
import { en, type Catalog } from "./locales/en";

/* 英文在此静态常驻，不只是因为它是 fallbackLng——它让「目录尚未注册」
   这个特殊情况彻底消失：未注册的语言不会退化成裸 key，而是沿用与
   fallbackLng 完全相同的那一条规则落到英文。于是注册时序不再是任何人
   需要记住的契约，只是「何时从英文升级为母语」的问题。 */
const catalogs = new Map<AppLocale, Catalog>([["en", en]]);
const instances = new Map<AppLocale, i18n>();

export function registerCatalog(locale: AppLocale, catalog: Catalog) {
  if (catalogs.get(locale) === catalog) return;
  catalogs.set(locale, catalog);
  /* 目录换代，缓存实例即刻作废——否则先用后注册的语言会被钉死在英文。 */
  instances.delete(locale);
}

export function hasCatalog(locale: AppLocale) {
  return catalogs.has(locale);
}

export function catalogOf(locale: AppLocale) {
  return catalogs.get(locale);
}

export function createAppI18n(locale: AppLocale): i18n {
  const instance = i18next.createInstance();
  const catalog = catalogs.get(locale);
  void instance.init({
    lng: locale,
    fallbackLng: "en",
    supportedLngs: APP_LOCALES,
    resources: {
      en: { translation: en },
      ...(catalog ? { [locale]: { translation: catalog } } : {}),
    },
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

export function translate(
  locale: AppLocale,
  key: string,
  options?: TOptions
): string {
  let instance = instances.get(locale);
  if (!instance) {
    instance = createAppI18n(locale);
    instances.set(locale, instance);
  }
  return instance.t(key, options);
}
