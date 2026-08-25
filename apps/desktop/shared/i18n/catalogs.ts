/**
 * [INPUT]: Depends on locale type, static English directory and runtime catalogOf/registerCatalog
 * [OUTPUT]: Provides loadCatalog Plug in and register a single language directory as needed
 * [POS]: The i18n on the renderer side at the installation point as required; The two teams are playing against each other in the same runtime register
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
