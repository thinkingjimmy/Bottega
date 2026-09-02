/**
 * [INPUT]: Depends on Electron app/dialog ports, shared i18n translation, current AppLocale, and injected reversible/terminal shutdown operations
 * [OUTPUT]: Installs the before-quit fence, user-visible recovery notice, and SafeQuitCoordinator terminal handoff
 * [POS]: Electron lifecycle adapter around safe-quit.ts; service ownership and close order remain explicit in index.ts
 */

import type { app, dialog } from "electron";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";
import {
  SafeQuitCoordinator,
  type SafeQuitPorts,
} from "./safe-quit";

export function installApplicationQuit(
  application: Pick<typeof app, "on" | "quit">,
  dialogs: Pick<typeof dialog, "showErrorBox">,
  ports: Omit<SafeQuitPorts, "notify" | "quit">,
  locale: () => AppLocale = () => "en"
) {
  const safeQuit = new SafeQuitCoordinator({
    ...ports,
    notify: (recovered) =>
      dialogs.showErrorBox(
        translate(locale(), "settings.native.quitFailureTitle"),
        recovered
          ? translate(locale(), "settings.native.quitRecovered")
          : translate(locale(), "settings.native.quitUnrecovered")
      ),
    quit: () => application.quit(),
  });
  application.on("before-quit", (event) => {
    if (safeQuit.finished) return;
    event.preventDefault();
    void safeQuit.prepare("quit").then((ready) => {
      if (ready) application.quit();
    });
  });
  return safeQuit;
}
