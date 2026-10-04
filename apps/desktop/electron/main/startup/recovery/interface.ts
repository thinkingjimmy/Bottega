/**
 * [INPUT]: Typed startup failures, bundled desktop dialogs, renderer development identity and explicit SQLite rebuild ownership.
 * [OUTPUT]: Pre-renderer recovery with durable saves, development restart instructions and packaged relaunch.
 * [POS]: The composition root's failure boundary; no development-server dependency or diagnostic text in the page.
 */
import { app, dialog } from "electron";
import { devRendererUrl } from "../../window/security/frame-guard";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { libraryErrorCode } from "../../library/errors";
import { recoveryCopy, socketBudgetMessage } from "./copy";
import { canRebuildFromFolder, preserveClosedDatabase } from "./sqlite";
import { MainWindowUnavailableError } from "../../presence/lifecycle/main-window-readiness";
import { UserDataSocketBudgetError } from "../../custody/socket-budget";
import { translate } from "../../../../shared/i18n/native";
import { startupPresentation } from "../dialogs/presentation";
import { openDesktopDialog } from "../dialogs/surface/window";
import { dialogFeedback, supportActions } from "../dialogs/surface/feedback";
import { recoverFolder } from "./folder/controller";

export type StartupRecoveryLibrary = {
  settings: {
    get(): { libraryRoot?: string | null; libraryId?: string | null };
    setTrusted(patch: { libraryRoot?: string | null; libraryId?: string | null; chatHomesRoot?: string | null }): Promise<unknown>;
  };
  retry(): Promise<void>;
};

async function finishRecovery(locale: AppLocale) {
  if (devRendererUrl(app.isPackaged)) {
    await dialog.showMessageBox({
      type: "info",
      title: translate(locale, "settings.native.desktop.recoverySavedTitle"),
      message: translate(locale, "settings.native.desktop.recoverySavedMessage"),
      buttons: [recoveryCopy(locale).close],
      noLink: true,
    });
  } else app.relaunch();
  // The startup owners may be only partly initialized; both paths have already closed SQLite.
  app.exit(0);
}

export async function showStartupRecovery(input: { error:Error; userData:string; libraryRoot:string | null; locale:string;
  closeDatabase():Promise<void>; library?:StartupRecoveryLibrary | null }) {
  const locale = input.locale as AppLocale;
  if (input.library && libraryErrorCode(input.error)) {
    await recoverFolder({ error:input.error, library:input.library, userData:input.userData, locale });
    app.quit(); return;
  }
  const socket = input.error instanceof UserDataSocketBudgetError ? input.error : null;
  const copy = recoveryCopy(locale), rebuild = !socket && await canRebuildFromFolder(input.error, input.libraryRoot);
  const startup = /MAIN_WINDOW_|ERR_CONNECTION_REFUSED/.test(input.error.message) ? startupPresentation(input.error, app.isPackaged, locale) : null;
  const title = socket ? copy.socketTitle : startup?.title ?? copy.title;
  let technical = `${input.error.name}: ${input.error.message}\n\n${input.error.stack ?? ""}`;
  const model = { screen:startup ? "startup-failed" : "recovery-failed", title,
    message:socket ? socketBudgetMessage(locale, socket.over) : startup?.message ?? copy.message,
    support:supportActions(locale), actions:rebuild ? [{ id:"rebuild", label:copy.rebuild, primary:true }] : [] };
  let rebuilding = false;
  const surface = await openDesktopDialog({ locale, model, onAction:action => {
    if (action.id === "copy" || action.id === "report") { void feedback(action.id); return; }
    if (action.id !== "rebuild" || !rebuild || rebuilding) return;
    rebuilding = true;
    void (async () => {
      // Rebuilding SQLite is a separate destructive operation, not folder-selection consent.
      const confirmation = await dialog.showMessageBox(surface.window, { type:"warning", title:copy.confirm, message:copy.disclosure,
        buttons:[copy.cancel, copy.rebuild], defaultId:0, cancelId:0, noLink:true });
      if (confirmation.response !== 1 || surface.window.isDestroyed()) return;
      await input.closeDatabase(); await preserveClosedDatabase(input.userData);
      await finishRecovery(locale);
    })().catch(async error => {
      technical += `\n\n${String(error)}`;
      await surface.update({ ...model, message:translate(locale, "settings.native.recoveryActionFailed") });
    }).finally(() => { rebuilding = false; });
  } });
  const feedback = dialogFeedback(surface, locale, () => technical);
  const onQuit = () => surface.close();
  app.once("before-quit", onQuit);
  await surface.closed;
  app.removeListener("before-quit", onQuit);
  app.quit();
}

export async function recoverStartupFailure(input: { error:Error; userData:string; locale:string;
  settings:StartupRecoveryLibrary["settings"] | null; closeDatabase():Promise<void>; quitting?:boolean }) {
  if (input.quitting && input.error instanceof MainWindowUnavailableError) {
    console.info("[main] startup ended by quit before the main window was ready"); return;
  }
  const retry = async () => { await input.closeDatabase(); await finishRecovery(input.locale as AppLocale); };
  await showStartupRecovery({ error:input.error, userData:input.userData, libraryRoot:input.settings?.get().libraryRoot ?? null,
    locale:input.locale, closeDatabase:input.closeDatabase, library:input.settings ? { settings:input.settings, retry } : null });
}
