/**
 * [INPUT]: Depends on the five locale catalogs, AppLocale, and runtime registerCatalog
 * [OUTPUT]: Provides the I18N_RESOURCES five-locale set and registerAllCatalogs, which feeds every entry of it into the runtime registry
 * [POS]: Main-side i18n eager-load source; registers all five catalogs upfront since main has no first-bundle budget. The renderer must not import this file — it registers catalogs on demand via catalogs.ts instead
 */

import type { AppLocale } from "./locale";
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
 * main 无首包预算，所以一次性投喂全部五语言，`translate()` 因而保持同步。
 * 显式调用而非 import 副作用：副作用式注册是隐形依赖，谁都看不出少了它
 * 会怎样——而少了它只会退化成英文，正是最难被测试抓住的那种沉默失败。
 */
export function registerAllCatalogs() {
  for (const [locale, { translation }] of Object.entries(I18N_RESOURCES)) {
    registerCatalog(locale as AppLocale, translation);
  }
}
