/**
 * [INPUT]: Depends on Electron shell, the Git runner, the progress window, i18n, shared folder admission, the erase finisher and completeRelocation.
 * [OUTPUT]: Provides prepareFolderAtStartup: retires an erased profile's folder and carries out a pending move (cancellable from its window across volumes), returning the one sentence the person should read afterwards as a deferred translation.
 * [POS]: The composition root's single call before LibraryService.initialize; it adapts relocation to Electron and decides nothing about content.
 */
import { shell } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/native";
import { runGit } from "../../projects/git/git-runner";
import { finishErase, sweepErasedProfile } from "../../profile-maintenance/erase";
import type { LibrarySplash } from "../../startup/library/library-splash";
import { markRelocationCancelled, readRelocation } from "./journal";
import { completeRelocation, type RelocationPorts } from "./run";
import { acquireLibraryAccess } from "../safety/open";
import { DeviceIdentityStore } from "../../chats/device-identity/device-identity";
import { machineIdFor } from "../../machine/machine-id";

async function moveToTrash(path: string) {
  try { await shell.trashItem(path); return true; }
  catch (cause) { console.warn(`[library] could not move to the Trash: ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); return false; }
}

/** Translated only when it is shown: the active catalog is not loaded yet when this runs. */
export type FolderNotice = (locale: AppLocale) => string;

export async function prepareFolderAtStartup(input: { userData: string; locale: () => AppLocale; settings: RelocationPorts["settings"] }): Promise<FolderNotice | null> {
  await finishErase(input.userData, moveToTrash);
  /* Deleting a large erased profile must not hold the first window; it runs alongside startup (F-23). */
  void sweepErasedProfile(input.userData).catch(cause => console.warn("[erase] sweep failed", cause));
  /* A copy across volumes is the only step long enough to need a window; a rename never opens one. */
  let splash: Promise<LibrarySplash | null> | null = null;
  let lastProgress = 0;
  /* Cancel is recorded durably before the copy stops, so a crash in between finishes the cancel instead of resuming. */
  const cancel = new AbortController();
  const onCancel = () => { void markRelocationCancelled(input.userData).catch(cause => console.warn("[library] cancel not recorded", cause)).finally(() => cancel.abort()); };
  // Revalidate recovered data on the next launch before any recorded paths are rewritten.
  const journal = await readRelocation(input.userData);
  const admission = journal?.kind === "adopt" ? await acquireLibraryAccess({ root:journal.to,
    installationId:await new DeviceIdentityStore(input.userData).loadOrCreate(), userData:input.userData,
    expectedId:journal.libraryId, requireIdentity:true, machineIdHash:machineIdFor("cloud") }) : null;
  const outcome = await completeRelocation({
    userData: input.userData, settings: input.settings, trash: moveToTrash, signal: cancel.signal,
    repairWorktree: async (worktree) => { await runGit(worktree, ["worktree", "repair"]); },
    progress: (completed, total) => {
      splash ??= import("../../startup/library/library-splash").then(module => module.openLibrarySplash({ locale: input.locale(), total, purpose: "moving", onCancel }));
      /* One update per file flooded the splash with IPC; ten a second is as smooth to read (F-24). */
      const now = Date.now();
      if (completed !== total && completed !== 0 && now - lastProgress < 100) return;
      lastProgress = now;
      void splash.then(window => window?.update(completed, total));
    },
  }).finally(() => admission?.lock.close());
  void (splash as Promise<LibrarySplash | null> | null)?.then(window => window?.close());
  switch (outcome.status) {
    case "none": return null;
    case "moved":
      console.info(`[library] folder moved to ${outcome.root}`);
      if (!outcome.sourceLeft) return null;
      { const path = outcome.sourceLeft; return (locale) => translate(locale, "settings.native.libraryMoveSourceLeft", { path }); }
    case "deferred":
      console.warn(`[library] folder move deferred: ${outcome.reasons.join(", ")}`);
      return (locale) => translate(locale, "settings.native.libraryMoveDeferred");
    case "cancelled":
      console.info("[library] folder move cancelled");
      { const path = outcome.root; return (locale) => translate(locale, "settings.native.libraryMoveCancelled", { path }); }
    case "failed":
      console.warn(`[library] folder move failed: ${outcome.error}`);
      { const path = outcome.root; return (locale) => translate(locale, "settings.native.libraryMoveFailed", { path }); }
  }
}
