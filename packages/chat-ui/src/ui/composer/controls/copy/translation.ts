/**
 * [INPUT]: English fallback, lazy locale catalogs and React subscriptions.
 * [OUTPUT]: Locale loading, synchronous interpolation and reactive composer translation.
 * [POS]: The loader beside the composer controls' locale catalogs; shared controls load only the selected language and native startup can await the same catalog.
 */
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { copy as en } from "./en";
type Catalog = typeof en;
const catalogs: Record<string, Catalog> = { en };
const loaders: Record<string, () => Promise<{ copy: Catalog }>> = {
  "zh-CN": () => import("./zh-cn"), ja: () => import("./ja"),
  fr: () => import("./fr"), es: () => import("./es"),
};
const flights = new Map<string, Promise<void>>(), listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function loadComposerCatalog(locale: string): Promise<void> {
  locale = resolveAppLocale(locale);
  if (catalogs[locale] || !loaders[locale]) return Promise.resolve();
  const previous = flights.get(locale); if (previous) return previous;
  const flight = loaders[locale]().then(({ copy }) => { catalogs[locale] = copy; listeners.forEach(listener => listener()); })
    .finally(() => { flights.delete(locale); });
  flights.set(locale, flight); return flight;
}
export type ComposerTranslate = (key: string, values?: Record<string, unknown>) => string;
export function composerTranslate(locale: string): ComposerTranslate {
  locale = resolveAppLocale(locale);
  return translateCatalog(catalogs[locale] ?? en);
}
function translateCatalog(catalog: Catalog): ComposerTranslate {
  return (key, values = {}) => {
    const read = (source: unknown) => key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, source);
    const value = read(catalog) ?? read(en);
    return (typeof value === "string" ? value : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
  };
}
export function useComposerTranslation(requestedLocale: string): ComposerTranslate {
  const locale = resolveAppLocale(requestedLocale);
  const catalog = useSyncExternalStore(subscribe, () => catalogs[locale] ?? en, () => en);
  useEffect(() => { void loadComposerCatalog(locale).catch(() => {}); }, [locale]);
  return useMemo(() => translateCatalog(catalog), [catalog]);
}
