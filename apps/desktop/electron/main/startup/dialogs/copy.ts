/**
 * [INPUT]: Five-language native catalogs and the active application locale.
 * [OUTPUT]: Typed desktopCopy lookups for shared recovery and quit controls.
 * [POS]: Main-only localized presentation helper; no diagnostic interpolation.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { NativeCatalog } from "../../../../shared/i18n/native/en";
import { translate } from "../../../../shared/i18n/native";

export const desktopCopy = (locale: AppLocale, key: keyof NativeCatalog["desktop"] | "quitTasks", values?: Record<string, string | number>) =>
  translate(locale, `settings.native.desktop.${key}`, values);
