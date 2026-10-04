/**
 * [INPUT]: A BCP-47 locale string and the five matching catalogs of one copy group.
 * [OUTPUT]: Provides pickCloudLocale, the single language ladder every cloud copy subpath uses.
 * [POS]: Shared selector for the cloud copy catalogs; English is the only fallback.
 */
import { resolveAppLocale } from "../locale";
export function pickCloudLocale<T>(locale: string, catalogs: { en: T; zhCN: T; ja: T; fr: T; es: T }): T {
  const key = resolveAppLocale(locale);
  return key === "zh-CN" ? catalogs.zhCN : catalogs[key];
}
