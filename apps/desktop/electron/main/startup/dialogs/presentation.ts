/**
 * [INPUT]: Current build/quit facts and main-only five-language catalogs.
 * [OUTPUT]: Human startup and quit explanations showing only the current blocking failure.
 * [POS]: Native dialog presentation independent of Electron, process control and raw diagnostic formatting.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/native";
import { desktopCopy } from "./copy";

export function startupPresentation(error: Error, packaged: boolean, locale: AppLocale) {
  const developmentRefused = !packaged && error.message.includes("ERR_CONNECTION_REFUSED");
  return {
    title: translate(locale, developmentRefused ? "settings.native.startupDevTitle" : "settings.native.startupWindowTitle"),
    message: translate(locale, developmentRefused ? "settings.native.startupDevMessage" : "settings.native.startupWindowMessage"),
  };
}

export type QuitFacts = { tasks: number; processes: number; draftsSaved: boolean; unconfirmedWindows: readonly string[]; draftTimedOut?: boolean };
export function quitPresentation(locale: AppLocale, facts: QuitFacts) {
  if (!facts.draftsSaved) return {
    title:desktopCopy(locale, facts.draftTimedOut ? "draftTimeoutTitle" : "draftFailedTitle"),
    detail:facts.unconfirmedWindows.length ? desktopCopy(locale, facts.draftTimedOut ? "draftTimeoutMessage" : "draftFailedMessage",
      { windows:facts.unconfirmedWindows.map(title => `“${title}”`).join(locale === "zh-CN" || locale === "ja" ? "、" : ", ") }) : desktopCopy(locale, "draftUnknown"),
  };
  return {
    title:desktopCopy(locale, "quitFailedTitle"),
    detail:facts.tasks > 0 ? desktopCopy(locale, "quitTasks", { count:facts.tasks })
      : desktopCopy(locale, facts.processes > 0 ? "quitProcesses" : "quitOther"),
  };
}
