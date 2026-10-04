/**
 * [INPUT]: Electron dialog/lifecycle ports, five-language presentation, live supervised activity, clipboard diagnostics and reversible/terminal shutdown operations.
 * [OUTPUT]: Installs the quit fence and task/process/draft-aware recovery dialogs; raw causes are clipboard-only, and returning resumes editing.
 * [POS]: Electron lifecycle adapter around safe-quit.ts; runtime.ts composes live admission ports; index.ts and terminal-owner-sequence.ts retain service ownership and close order
 */

import type { app, dialog } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { inspect } from "node:util";
import { translate } from "../../../../shared/i18n/native";
import { quitPresentation } from "../dialogs/presentation";
import {
  SafeQuitCoordinator,
  type SafeQuitPorts,
  type SafeQuitResult,
  type QuitFailure,
} from "./safe-quit";

export function installApplicationQuit(
  application: Pick<typeof app, "on" | "quit">,
  dialogs: Pick<typeof dialog, "showErrorBox"> & Partial<Pick<typeof dialog, "showMessageBox">>,
  ports: Omit<SafeQuitPorts, "notify" | "quit"> & { requestUserQuit?(): Promise<SafeQuitResult>;
    activity?(): { tasks: number; processes: number }; copyTechnicalDetails?(text: string): void;
    presentFailure?(failure: QuitFailure, canForce: boolean): Promise<boolean> },
  locale: () => AppLocale = () => "en"
) {
  const safeQuit = new SafeQuitCoordinator({
    ...ports,
    confirmForce: ports.presentFailure ? failure => ports.presentFailure!(failure, true) : dialogs.showMessageBox ? async failure => {
      for (;;) {
        const copy = quitPresentation(locale(), { ...failure, ...(ports.activity?.() ?? { tasks: 0, processes: 0 }) });
        const { response } = await dialogs.showMessageBox!({ type: "warning", title: copy.title, message: copy.title,
          detail: `${copy.detail}\n\n${translate(locale(), "settings.native.quitForceDetail")}`,
          buttons: [translate(locale(), "settings.native.quitReturn"), translate(locale(), "settings.native.quitForce"), translate(locale(), "settings.native.copyTechnicalDetails")],
          defaultId: 0, cancelId: 0, noLink: true });
        if (response !== 2) return response === 1;
        ports.copyTechnicalDetails?.(inspect(failure.cause, { depth: null }));
      }
    } : undefined,
    notify: async (recovered, failure) => {
      if (ports.presentFailure) { await ports.presentFailure(failure, false); return; }
      if (!dialogs.showMessageBox) return dialogs.showErrorBox(
        translate(locale(), "settings.native.quitFailureTitle"),
        recovered
          ? translate(locale(), "settings.native.quitRecovered")
          : translate(locale(), "settings.native.quitUnrecovered")
      );
      for (;;) {
        const copy = quitPresentation(locale(), { ...failure, ...(ports.activity?.() ?? { tasks: 0, processes: 0 }) });
        const { response } = await dialogs.showMessageBox({ type: "warning", title: copy.title, message: copy.title,
          detail: [copy.detail, recovered ? "" : translate(locale(), "settings.native.quitUnrecovered")].filter(Boolean).join("\n\n"),
          buttons: [translate(locale(), "settings.native.quitReturn"), translate(locale(), "settings.native.copyTechnicalDetails")], defaultId: 0, cancelId: 0, noLink: true });
        if (response !== 1) return;
        ports.copyTechnicalDetails?.(inspect(failure.cause, { depth: null }));
      }
    },
    quit: () => application.quit(),
  });
  application.on("before-quit", (event) => {
    if (safeQuit.finished) return;
    event.preventDefault();
    void (ports.requestUserQuit?.() ?? safeQuit.prepare("quit")).then((ready) => {
      if (ready === "ready") application.quit();
    });
  });
  return safeQuit;
}
