/**
 * [INPUT]: English UI text, dynamic locale catalogs and locale negotiation.
 * [OUTPUT]: loadUiTextCopy and uiTextResolver for the browser locale gate.
 * [POS]: Browser-only catalog entry; desktop synchronous lookup stays in index.ts.
 */
import { resolveAppLocale, type AppLocale } from "../locale";
import { uiTextEn } from "./en";
type Copy = Record<keyof typeof uiTextEn, string>;
const copies: Partial<Record<AppLocale, Copy>> = { en: uiTextEn };
const loaders = {
  "zh-CN": () => import("./zh-cn").then(module => module.uiTextZhCn),
  ja: () => import("./ja").then(module => module.uiTextJa),
  fr: () => import("./fr").then(module => module.uiTextFr),
  es: () => import("./es").then(module => module.uiTextEs),
};
export async function loadUiTextCopy(language: string) {
  const locale = resolveAppLocale(language);
  if (locale !== "en" && !copies[locale]) copies[locale] = await loaders[locale]();
}
export function uiTextResolver(locale: string, overrides: Record<string, string> = {}) {
  const catalog = copies[resolveAppLocale(locale)] ?? uiTextEn;
  return (key: string, fallback: string) => overrides[key] ?? catalog[key as keyof Copy] ?? uiTextEn[key as keyof Copy] ?? fallback;
}
