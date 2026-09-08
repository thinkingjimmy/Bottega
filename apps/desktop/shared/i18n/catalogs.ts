/**
 * [INPUT]: Depends on locale type, static English directory and runtime catalogOf/registerCatalog
 * [OUTPUT]: Provides loadCatalog, lazily importing and registering one locale's catalog on demand
 * [POS]: Renderer-side i18n lazy-load point; each non-English locale ships as its own chunk after the English-only initial bundle, registered into the same runtime registry main populates eagerly via resources.ts
 */

import type { AppLocale } from "./locale";
import { en, type Catalog } from "./locales/en";
import { catalogOf, registerCatalog } from "./runtime";

/**
 * 首包只背英文，其余四语言各自成 chunk。它们服务的界面（Memory/Bases/
 * Archive 等）本就在懒路由之后，文案没有理由比代码更早到场。
 */
const LOADERS: Record<AppLocale, () => Promise<Catalog>> = {
  en: async () => en,
  "zh-CN": async () => (await import("./locales/zh-cn")).zhCN,
  ja: async () => (await import("./locales/ja")).ja,
  fr: async () => (await import("./locales/fr")).fr,
  es: async () => (await import("./locales/es")).es,
};

export async function loadCatalog(locale: AppLocale): Promise<Catalog> {
  const resident = catalogOf(locale);
  if (resident) return resident;
  const catalog = await LOADERS[locale]();
  registerCatalog(locale, catalog);
  return catalog;
}
