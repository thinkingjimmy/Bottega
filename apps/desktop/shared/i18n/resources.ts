/**
 * [INPUT]: Depends on five locale directories, Catalog type and runtime register Catalog
 * [OUTPUT]: Provides I18N_RESOURCES Full set, TranslationCatalog and registerAllCatalogs to throw in
 * [POS]: The i18n full-volume injection source on the main side; The renderer cannot be referenced (it is registered on request via catalogs.ts, see README Depends on Borders)
 */

import { en, type Catalog } from "./locales/en";
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
  registerCatalog("en", en);
  registerCatalog("zh-CN", zhCN);
  registerCatalog("ja", ja);
  registerCatalog("fr", fr);
  registerCatalog("es", es);
}

export type TranslationCatalog = Catalog;
