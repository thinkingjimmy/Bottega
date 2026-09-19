/**
 * [INPUT]: Depends on the five locale catalogs, AppLocale, and runtime registerCatalog
 * [OUTPUT]: Provides the I18N_RESOURCES five-locale set and registerAllCatalogs, which feeds every entry of it into the runtime registry
 * [POS]: The eager five-locale source, kept for tests and integrity checks that need every catalog at once. Production code in either process registers on demand via catalogs.ts — five resident catalogs cost the main isolate 4 MB for four languages it will never render
 */

import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { ja } from "./locales/ja";
import { zhCN } from "./locales/zh-cn";
import { registerCatalog } from "./runtime";

export const I18N_RESOURCES = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
  ja: { translation: ja },
  fr: { translation: fr },
  es: { translation: es },
} as const;

/**
 * 一次性投喂全部五语言，供需要全目录在场的测试与完整性校验使用。
 * 显式调用而非 import 副作用：副作用式注册是隐形依赖，谁都看不出少了它
 * 会怎样——而少了它只会退化成英文，正是最难被测试抓住的那种沉默失败。
 */
export function registerAllCatalogs() {
  for (const [locale, { translation }] of Object.entries(I18N_RESOURCES)) {
    registerCatalog(locale as AppLocale, translation);
  }
}
