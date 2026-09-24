/**
 * [INPUT]: Depends on Electron native dialogs, local diagnostics, typed startup failures, folder identity and the closed SQLite recovery owner.
 * [OUTPUT]: Keeps startup failures actionable without an automatic exit, an unrelated database reset or a folder the user cannot reach again, including a folder that belongs to another computer; a located folder is adopted through the relocation journal so recorded paths follow it; recoverStartupFailure is the composition root's single exit.
 * [POS]: Pre-renderer recovery surface; rebuilding and adopting a new folder are explicit final user actions after the impact is displayed.
 */
import { realpath } from "node:fs/promises";
import { app, clipboard, dialog, shell } from "electron";
import { libraryErrorCode, libraryErrorHost } from "../../library/errors";
import { readLibraryIdentity } from "../../library/identity";
import { writeRelocation } from "../../library/relocation/journal";
import { libraryRecoveryCopy, recoveryCopy } from "./copy";
import { canRebuildFromFolder, preserveClosedDatabase } from "./sqlite";

/** The folder branch writes settings and restarts; it never resumes a startup chain that already failed. */
export type StartupRecoveryLibrary = {
  settings: {
    get(): { libraryRoot?: string | null; libraryId?: string | null };
    setTrusted(patch: { libraryRoot?: string | null; libraryId?: string | null; chatHomesRoot?: string | null }): Promise<unknown>;
  };
  retry(): Promise<void>;
};

export async function showStartupRecovery(input: { error: Error; userData: string; libraryRoot: string | null; locale: string;
  closeDatabase(): Promise<void>; library?: StartupRecoveryLibrary | null }) {
  const code = libraryErrorCode(input.error);
  if (input.library) {
    if (code === "locked") return showLockedFolder(input.library, input.locale);
    /* A folder published by another computer is not broken and not lost, so it gets the same two exits as a
       folder that moved — locate the one this installation was using, or start a new one — under its own sentence. */
    if (code === "owned-elsewhere") return showMissingFolder(input.library, input.userData, input.locale, libraryErrorHost(input.error));
    if (code === "missing" || code === "identity-changed" || code === "control-invalid") {
      return showMissingFolder(input.library, input.userData, input.locale);
    }
  }
  const copy = recoveryCopy(input.locale), rebuild = await canRebuildFromFolder(input.error, input.libraryRoot);
  const technical = `${input.error.name}: ${input.error.message}\n\n${input.error.stack ?? ""}`;
  let detail = technical;
  for (;;) {
    const buttons = [copy.open, copy.copy, copy.report, ...(rebuild ? [copy.rebuild] : []), copy.close];
    const result = await dialog.showMessageBox({ type: "error", title: copy.title, message: copy.message, detail, buttons,
      defaultId: 0, cancelId: buttons.length - 1, noLink: true });
    try {
      if (result.response === 0) { const error = await shell.openPath(input.userData); if (error) detail = error + "\n\n" + technical; }
      else if (result.response === 1) clipboard.writeText(technical);
      else if (result.response === 2) await shell.openExternal("https://github.com/thinkingjimmy/Bottega/issues/new");
      else if (rebuild && result.response === 3) {
        const confirmation = await dialog.showMessageBox({ type: "warning", title: copy.confirm, message: copy.disclosure,
          buttons: [copy.cancel, copy.rebuild], defaultId: 0, cancelId: 0, noLink: true });
        if (confirmation.response !== 1) continue;
        await input.closeDatabase(); await preserveClosedDatabase(input.userData);
        app.relaunch(); app.exit(0); return;
      } else { app.quit(); return; }
    } catch (error) { detail = String(error) + "\n\n" + technical; }
  }
}

/* Reinstalling does not clear userData, so without these two actions a folder that was
   deleted, renamed or left on an unmounted volume has no exit at all. */
async function showMissingFolder(library: StartupRecoveryLibrary, userData: string, locale: string, ownedBy?: string) {
  const copy = libraryRecoveryCopy(locale);
  const title = ownedBy === undefined ? copy.missingTitle : copy.ownedTitle;
  const message = ownedBy === undefined ? copy.missingMessage : copy.ownedMessage.replace("{host}", ownedBy);
  let detail = library.settings.get().libraryRoot ?? "";
  for (;;) {
    const buttons = [copy.locate, copy.startNew, copy.quit];
    const result = await dialog.showMessageBox({ type: "error", title, message, detail,
      buttons, defaultId: 0, cancelId: 2, noLink: true });
    try {
      if (result.response === 0) {
        const chosen = await chooseFolder(copy.locate, false);
        if (!chosen) continue;
        const { libraryRoot: previous, libraryId: expected } = library.settings.get(), identity = await readLibraryIdentity(chosen);
        if (!identity || (expected && identity.libraryId !== expected)) { detail = copy.differentFolder; continue; }
        /* The folder moved without Bottega; the paths this profile recorded inside it have to follow it,
           which the next launch does before opening it. Settings alone would leave every Chat Home behind. */
        if (previous && previous !== chosen) await writeRelocation(userData, { kind: "adopt", from: previous, to: chosen, libraryId: identity.libraryId });
        else await library.settings.setTrusted({ libraryRoot: chosen, chatHomesRoot: chosen, libraryId: identity.libraryId });
        return library.retry();
      }
      if (result.response === 1) {
        const confirmation = await dialog.showMessageBox({ type: "warning", title: copy.startNewConfirm, message: copy.startNewDisclosure,
          buttons: [copy.cancel, copy.startNew], defaultId: 0, cancelId: 0, noLink: true });
        if (confirmation.response !== 1) continue;
        const chosen = await chooseFolder(copy.startNew, true);
        if (!chosen) continue;
        // The new folder mints its own identity on the next launch; keeping the old one would reject it.
        await library.settings.setTrusted({ libraryRoot: chosen, chatHomesRoot: chosen, libraryId: null });
        return library.retry();
      }
      app.quit(); return;
    } catch (error) { detail = String(error); }
  }
}

async function showLockedFolder(library: StartupRecoveryLibrary, locale: string) {
  const copy = libraryRecoveryCopy(locale);
  const detail = library.settings.get().libraryRoot ?? "";
  for (;;) {
    const result = await dialog.showMessageBox({ type: "warning", title: copy.lockedTitle, message: copy.lockedMessage, detail,
      buttons: [copy.retry, copy.quit], defaultId: 0, cancelId: 1, noLink: true });
    if (result.response !== 0) { app.quit(); return; }
    await library.retry();
  }
}

async function chooseFolder(title: string, create: boolean) {
  const result = await dialog.showOpenDialog({ title, properties: create ? ["openDirectory", "createDirectory"] : ["openDirectory"] });
  const selected = result.filePaths[0];
  return result.canceled || !selected ? null : realpath(selected);
}

/* Only a relaunch can re-run a failed startup chain: later members were never built, so resuming in
   place would leave a half-built process. Settings are persisted before the restart. */
export async function recoverStartupFailure(input: { error: Error; userData: string; locale: string;
  settings: StartupRecoveryLibrary["settings"] | null; closeDatabase(): Promise<void> }) {
  const retry = async () => { await input.closeDatabase(); app.relaunch(); app.exit(0); };
  await showStartupRecovery({ error: input.error, userData: input.userData, libraryRoot: input.settings?.get().libraryRoot ?? null,
    locale: input.locale, closeDatabase: input.closeDatabase, library: input.settings ? { settings: input.settings, retry } : null });
}
