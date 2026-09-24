/**
 * [INPUT]: Depends on Electron shell, the Git runner, the progress window, i18n, the erase finisher and completeRelocation.
 * [OUTPUT]: Provides prepareFolderAtStartup: retires an erased profile's folder and carries out a pending move, returning the one sentence the person should read afterwards as a deferred translation.
 * [POS]: The composition root's single call before LibraryService.initialize; it adapts relocation to Electron and decides nothing about content.
 */
import { shell } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/runtime";
import { runGit } from "../../projects/git/git-runner";
import { finishErase } from "../../profile-maintenance/erase";
import type { LibrarySplash } from "../../startup/library-splash";
import { completeRelocation, type RelocationPorts } from "./run";

async function moveToTrash(path: string) {
  try { await shell.trashItem(path); return true; }
  catch (cause) { console.warn(`[library] could not move to the Trash: ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); return false; }
}

/** Translated only when it is shown: the active catalog is not loaded yet when this runs. */
export type FolderNotice = (locale: AppLocale) => string;

export async function prepareFolderAtStartup(input: { userData: string; locale: () => AppLocale; settings: RelocationPorts["settings"] }): Promise<FolderNotice | null> {
  await finishErase(input.userData, moveToTrash);
  /* A copy across volumes is the only step long enough to need a window; a rename never opens one. */
  let splash: Promise<LibrarySplash | null> | null = null;
  const outcome = await completeRelocation({
    userData: input.userData, settings: input.settings, trash: moveToTrash,
    repairWorktree: async (worktree) => { await runGit(worktree, ["worktree", "repair"]); },
    progress: (completed, total) => {
      splash ??= import("../../startup/library-splash").then(module => module.openLibrarySplash({ locale: input.locale(), total, purpose: "moving" }));
      void splash.then(window => window?.update(completed, total));
    },
  });
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
    case "failed":
      console.warn(`[library] folder move failed: ${outcome.error}`);
      { const path = outcome.root; return (locale) => translate(locale, "settings.native.libraryMoveFailed", { path }); }
  }
}
