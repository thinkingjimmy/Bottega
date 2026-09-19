/**
 * [INPUT]: Depends on locale type, static English directory, shared composer locale loading and runtime catalogOf/registerCatalog
 * [OUTPUT]: Provides loadCatalog, lazily importing and registering one locale's catalog on demand
 * [POS]: The i18n lazy-load point for both processes; each non-English locale is its own chunk, and main registers English plus the active locale through here while resources.ts stays the eager five-locale source for tests
 */

import { loadWorkspaceCopy } from "@ai-chat/ui/workspace-copy";
import { loadComposerCatalog } from "@ai-chat/chat-ui/composer-translation";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { en, type Catalog } from "./locales/en";
import { catalogOf, registerCatalog } from "./runtime";

/**
 * 首包只背英文，其余四语言各自成 chunk。它们服务的界面（Memory/Bases/
 * Archive 等）本就在懒路由之后，文案没有理由比代码更早到场。
 *
 * 主进程走同一条路，理由不同：它没有首包预算，但有常驻预算——五语言目录
 * 在主 isolate 里是 4 MB，而任何一次运行只用得上其中一种。
 */
const LOADERS: Record<AppLocale, () => Promise<Catalog>> = {
  en: async () => en,
  "zh-CN": async () => (await import("./locales/zh-cn")).zhCN,
  ja: async () => (await import("./locales/ja")).ja,
  fr: async () => (await import("./locales/fr")).fr,
  es: async () => (await import("./locales/es")).es,
};

export async function loadCatalog(locale: AppLocale): Promise<Catalog> {
  await Promise.all([loadComposerCatalog(locale), loadWorkspaceCopy(locale)]);
  const resident = catalogOf(locale);
  if (resident) return resident;
  const catalog = await LOADERS[locale]();
  registerCatalog(locale, catalog);
  return catalog;
}
