/**
 * [INPUT]: The English encrypted-sync catalog, the other four by dynamic import, and the shared locale resolver.
 * [OUTPUT]: Provides the Web's getCloudEncryptionCopy (synchronous; English until its language loads) and loadCloudEncryptionCopy.
 * [POS]: Web-only lazy twin of index.ts (O31-4): only English stays in the first load. The Web awaits the load inside its locale gate
 *        (loadCloudCopy); the desktop keeps the eager index, whose settings views read synchronously.
 */
import { resolveAppLocale, type AppLocale } from "../../locale";
import { en, type CloudEncryptionCopy } from "./en";

const copies: Partial<Record<AppLocale, CloudEncryptionCopy>> = { en };
const loaders = {
  "zh-CN": () => import("./zh-cn").then(module => module.zhCN), ja: () => import("./ja").then(module => module.ja),
  fr: () => import("./fr").then(module => module.fr), es: () => import("./es").then(module => module.es),
};
const flights = new Map<AppLocale, Promise<void>>();
export function loadCloudEncryptionCopy(language: string): Promise<void> {
  const locale = resolveAppLocale(language);
  if (locale === "en" || copies[locale]) return Promise.resolve();
  const prior = flights.get(locale); if (prior) return prior;
  const flight = loaders[locale]().then(copy => { copies[locale] = copy; }).finally(() => flights.delete(locale));
  flights.set(locale, flight); return flight;
}
export const getCloudEncryptionCopy = (locale: string) => copies[resolveAppLocale(locale)] ?? en;
export type { CloudEncryptionCopy };
