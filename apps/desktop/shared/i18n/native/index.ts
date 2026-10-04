/**
 * [INPUT]: Depends on catalogs.loadCatalog, the shared section registry, runtime registration and native/section catalogs (English static, the rest lazy)
 * [OUTPUT]: Provides translate (re-exported; importing it here keeps English native, memory and systemDock copy resident), loadMainCatalogs (shared + native + every section, what main awaits), loadNativeCatalog (registers `settings.native.*` for English plus one locale) and withNative (test-side merge into a full catalog)
 * [POS]: Main-only entry of shared/i18n/native; main awaits it beside loadCatalog, the renderer never imports it (check-renderer-bundle enforces that)
 */

import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { loadCatalog } from "../catalogs";
import { loadLocalizedSection } from "../section-registry";
import { memoryLazyEn } from "../locales/memory/lazy/en";
import { systemDockLazyEn } from "../locales/system-dock/lazy/en";
import { registerCatalogExtension } from "../runtime";
import { nativeEn, type NativeCatalog } from "./en";

const LOADERS: Record<AppLocale, () => Promise<NativeCatalog>> = {
  en: async () => nativeEn,
  "zh-CN": async () => (await import("./zh-cn")).nativeZhCN,
  ja: async () => (await import("./ja")).nativeJa,
  fr: async () => (await import("./fr")).nativeFr,
  es: async () => (await import("./es")).nativeEs,
};

const extension = (native: NativeCatalog) => ({ settings: { native } });
const english = extension(nativeEn);
/* Same rule as runtime.ts: English is resident from the moment main imports this, so copy read before the active locale
   loads is English, never a raw key. */
registerCatalogExtension("en", english);
// Main shows Memory and Dock copy (menus, dialogs, shutdown) at any moment, so their English halves are resident here too.
registerCatalogExtension("en", { memory: memoryLazyEn }, "memory");
registerCatalogExtension("en", { systemDock: systemDockLazyEn }, "systemDock");

/** Like loadCatalog, `translate()` stays synchronous, so main must await this before any native dialog or menu copy. */
export async function loadNativeCatalog(locale: AppLocale) {
  if (locale !== "en") registerCatalogExtension(locale, extension(await LOADERS[locale]()));
}

/** Main's whole catalog set for a locale: the shared catalog and the main-only native copy, loaded together. */
export const loadMainCatalogs = (locale: AppLocale) =>
  Promise.all([loadCatalog(locale), loadNativeCatalog(locale), loadLocalizedSection("memory", locale), loadLocalizedSection("systemDock", locale)]);

/* Main code that shows `settings.native.*` imports translate from here, so importing it is what makes English resident. */
export { translate } from "../runtime";

export const withNative = <T extends { settings: object }>(catalog: T, native: NativeCatalog) =>
  ({ ...catalog, settings: { ...catalog.settings, native } });
