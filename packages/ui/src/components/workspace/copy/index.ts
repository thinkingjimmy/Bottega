/**
 * [INPUT]: No runtime dependencies; All locales workspace presentation vocabulary.
 * [OUTPUT]: Provides workspaceCopy for shared Chat actions, Project settings and Archive.
 * [POS]: Language leaf imported directly by desktop and selected by Web.
 */
import { workspaceCopy as en } from "./en";
import { resolveAppLocale } from "../../../lib/locale";
import type { AppLocale } from "../../../lib/locale";
const copies: Partial<Record<AppLocale, typeof en>> = { en };
const loaders = { "zh-CN": () => import("./zh-cn"), ja: () => import("./ja"), fr: () => import("./fr"), es: () => import("./es") };
const flights = new Map<AppLocale, Promise<void>>();
export function loadWorkspaceCopy(language: string): Promise<void> {
  const locale = resolveAppLocale(language);
  if (locale === "en" || copies[locale]) return Promise.resolve();
  const prior = flights.get(locale); if (prior) return prior;
  const flight = loaders[locale]().then(module => { copies[locale] = module.workspaceCopy; }).finally(() => flights.delete(locale));
  flights.set(locale, flight); return flight;
}
export const workspaceCopy = (locale: string) => copies[resolveAppLocale(locale)] ?? en;
