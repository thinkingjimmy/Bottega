/**
 * [INPUT]: Matching five-language component catalogs and optional host labels.
 * [OUTPUT]: uiTextResolver with regional language negotiation and English fallback.
 * [POS]: Shared text boundary used by desktop locale catalogs and the whole browser workspace.
 */
import { uiTextEn } from "./en";
import { uiTextZhCn } from "./zh-cn";
import { uiTextJa } from "./ja";
import { uiTextFr } from "./fr";
import { uiTextEs } from "./es";
const catalogs: Record<string, Record<keyof typeof uiTextEn, string>> = { en: uiTextEn, zh: uiTextZhCn, ja: uiTextJa, fr: uiTextFr, es: uiTextEs };
export function uiTextResolver(locale: string, overrides: Record<string, string> = {}) {
  const catalog = catalogs[locale.toLowerCase().split("-")[0]!] ?? uiTextEn;
  return (key: string, fallback: string) => overrides[key] ?? catalog[key as keyof typeof uiTextEn] ?? uiTextEn[key as keyof typeof uiTextEn] ?? fallback;
}
