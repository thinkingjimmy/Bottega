/**
 * [INPUT]: Depends on the shared section registry, runtime extension registration and dynamic English Memory/Dock catalogs.
 * [OUTPUT]: Provides CatalogSection, loadSection, loadRequestedSections and sectionsReady for renderer routes and language changes.
 * [POS]: Renderer-only section loading entry; English fallback stays behind each page's dynamic boundary. Main uses the registry directly.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { hasCatalogExtension, registerCatalogExtension } from "./runtime";
import { loadLocalizedSection, requestSection, type CatalogSection } from "./section-registry";

export { loadRequestedSections, sectionsReady, type CatalogSection } from "./section-registry";

const ENGLISH_LOADERS: Record<CatalogSection, () => Promise<Record<string, unknown>>> = {
  memory: async () => (await import("./locales/memory/lazy/en")).memoryLazyEn,
  systemDock: async () => (await import("./locales/system-dock/lazy/en")).systemDockLazyEn,
};

async function loadEnglishSection(section: CatalogSection) {
  if (hasCatalogExtension("en", section)) return;
  registerCatalogExtension("en", { [section]: await ENGLISH_LOADERS[section]() }, section);
}

/** A page awaits fallback and localized copy before rendering; later language changes repeat the same loading contract. */
export async function loadSection(section: CatalogSection, locale: AppLocale) {
  requestSection(section, (nextLocale) => loadSection(section, nextLocale));
  await Promise.all([loadEnglishSection(section), loadLocalizedSection(section, locale)]);
}
