/**
 * [INPUT]: Depends on AppLocale, runtime catalog extension registration and non-English Memory/Dock section catalogs.
 * [OUTPUT]: Provides CatalogSection, localized section loading, requested-section loaders and readiness for language changes.
 * [POS]: Shared section lifecycle with no English loading strategy; renderer supplies lazy fallback loaders while native keeps English resident.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { hasCatalogExtension, registerCatalogExtension } from "./runtime";

export type CatalogSection = "memory" | "systemDock";
type TranslatedLocale = Exclude<AppLocale, "en">;
type SectionLoader = (locale: AppLocale) => Promise<void>;

const LOADERS: Record<CatalogSection, Record<TranslatedLocale, () => Promise<Record<string, unknown>>>> = {
  memory: {
    "zh-CN": async () => (await import("./locales/memory/lazy/zh-cn")).memoryLazyZhCN,
    ja: async () => (await import("./locales/memory/lazy/ja")).memoryLazyJa,
    fr: async () => (await import("./locales/memory/lazy/fr")).memoryLazyFr,
    es: async () => (await import("./locales/memory/lazy/es")).memoryLazyEs,
  },
  systemDock: {
    "zh-CN": async () => (await import("./locales/system-dock/lazy/zh-cn")).systemDockLazyZhCN,
    ja: async () => (await import("./locales/system-dock/lazy/ja")).systemDockLazyJa,
    fr: async () => (await import("./locales/system-dock/lazy/fr")).systemDockLazyFr,
    es: async () => (await import("./locales/system-dock/lazy/es")).systemDockLazyEs,
  },
};

const requested = new Map<CatalogSection, SectionLoader>();

export function requestSection(section: CatalogSection, loader: SectionLoader) {
  requested.set(section, loader);
}

/** English registration belongs to the process entry; both processes load translated sections through this path. */
export async function loadLocalizedSection(section: CatalogSection, locale: AppLocale) {
  if (locale === "en" || hasCatalogExtension(locale, section)) return;
  registerCatalogExtension(locale, { [section]: await LOADERS[section][locale]() }, section);
}

export const loadRequestedSections = (locale: AppLocale) =>
  Promise.all([...requested.values()].map((load) => load(locale))).then(() => undefined);

export const sectionsReady = (locale: AppLocale) =>
  [...requested.keys()].every((section) => hasCatalogExtension("en", section) && hasCatalogExtension(locale, section));
