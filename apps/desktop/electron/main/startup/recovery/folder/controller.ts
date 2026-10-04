/**
 * [INPUT]: Recorded folder identity, bounded cancellable search, native folder picker and shared normal admission.
 * [OUTPUT]: Native-framed recovery with automatic single-match adoption, explicit duplicate choice and inline new-folder consent.
 * [POS]: Startup recovery state owner; obsolete search/picker results cannot update or reopen a closed window.
 */
import { app, dialog } from "electron";
import { stat } from "node:fs/promises";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../../shared/i18n/native";
import { DeviceIdentityStore } from "../../../chats/device-identity/device-identity";
import { libraryErrorCode, libraryErrorHost } from "../../../library/errors";
import { readLibraryIdentity } from "../../../library/identity";
import { findLibraryCandidates } from "../../../library/recovery/discovery";
import { disconnectedLibraryVolume } from "../../../library/recovery/location";
import { describeLibraryOwner } from "../../../library/recovery/ownership";
import { desktopCopy } from "../../dialogs/copy";
import { openDesktopDialog, type DesktopDialog } from "../../dialogs/surface/window";
import type { DesktopDialogAction } from "../../dialogs/surface/types";
import type { StartupRecoveryLibrary } from "../interface";
import { adoptFolder, classifyFolder, type FolderSelection } from "./selection";
import { recoveryModel, type RecoveryState } from "./presentation";

export async function recoverFolder(input: { error:Error; library:StartupRecoveryLibrary; userData:string; locale:AppLocale }) {
  const { library, locale } = input, recorded = library.settings.get();
  const t = (key:Parameters<typeof desktopCopy>[1], values?:Record<string, string | number>) => desktopCopy(locale, key, values);
  const lifetime = new AbortController();
  let search: AbortController | undefined, generation = 0, busy = false, newFolder:FolderSelection | null = null;
  let state:RecoveryState = { screen:"searching", title:t("searchingTitle"), message:t("searchingMessage"), previous:recorded.libraryRoot ?? undefined };
  const active = () => !lifetime.signal.aborted;
  const cancelSearch = () => { generation++; search?.abort(); };
  const stop = () => { cancelSearch(); lifetime.abort(); };
  const render = () => active() ? surface.update(recoveryModel(locale, state, newFolder, busy)) : Promise.resolve();
  const installationId = await new DeviceIdentityStore(input.userData).loadOrCreate();

  async function failure(error: unknown, path?:string) {
    if (!active()) return;
    console.warn("[recovery] folder unavailable", error);
    const code = libraryErrorCode(error);
    const previous = recorded.libraryRoot ?? undefined;
    if (code === "locked") state = { screen:"locked", title:t("lockedTitle"), message:t("lockedMessage"), previous, retryPath:path };
    else {
      let message = translate(locale, code ? `settings.native.library.${code}` : "settings.native.folderUnavailable");
      if (code === "identity-changed" && path) {
        const identity = await readLibraryIdentity(path);
        const owner = identity ? await describeLibraryOwner(path, identity.libraryId, app.getPath("appData")) : null;
        message = owner?.installation || owner?.host ? t("wrongOwner", { owner:owner.installation ?? owner.host! }) : t("wrongUnknown");
      } else if (code === "owned-elsewhere") {
        const host = libraryErrorHost(error);
        message = host ? t("wrongOwner", { owner:host }) : t("wrongUnknown");
      }
      if (!active()) return;
      state = { screen:"wrong", title:t("wrongTitle"), message, previous };
    }
    newFolder = null;
    await render();
  }

  async function open(selection:FolderSelection) {
    if (!active() || busy) return;
    busy = true; cancelSearch(); await render();
    try { await adoptFolder({ selection, library, userData:input.userData, installationId, signal:lifetime.signal }); }
    catch (error) { if (active()) await failure(error, selection.path); }
    finally { busy = false; await render(); }
  }

  async function discover() {
    cancelSearch(); newFolder = null;
    const pass = generation, current = () => active() && pass === generation;
    const volume = await disconnectedLibraryVolume(input.userData, recorded.libraryRoot, recorded.libraryId);
    if (!current()) return;
    if (volume) {
      state = { screen:"offline", title:t("offlineTitle", { volume }), message:t("offlineMessage"), previous:recorded.libraryRoot ?? undefined };
      await render(); return;
    }
    state = { screen:"searching", title:t("searchingTitle"), message:t("searchingMessage"), previous:recorded.libraryRoot ?? undefined };
    await render();
    search = new AbortController();
    const result = recorded.libraryId ? await findLibraryCandidates({ libraryId:recorded.libraryId, signal:search.signal }) : { candidates:[] };
    if (!current()) return;
    if (result.candidates.length === 1) {
      const path = result.candidates[0]!.path;
      await open({ kind:"existing", path, picked:path }); return;
    }
    state = { screen:result.candidates.length ? "multiple" : "missing", title:t(result.candidates.length ? "multipleTitle" : "missingTitle"),
      message:t(result.candidates.length ? "multipleMessage" : "missingMessage"), previous:recorded.libraryRoot ?? undefined,
      candidates:result.candidates.map((candidate, index) => ({ id:String(index), path:candidate.path,
        detail:t("modified", { date:new Intl.DateTimeFormat(locale, { dateStyle:"medium", timeStyle:"short" }).format(candidate.modifiedAt) }) })) };
    await render();
  }

  async function choose() {
    cancelSearch(); busy = true; await render();
    try {
      const result = await dialog.showOpenDialog(surface.window, { title:t("choose"), properties:["openDirectory", "createDirectory"] });
      if (!active()) return;
      if (result.canceled || !result.filePaths[0]) { busy = false; if (state.screen === "searching" && !newFolder) await discover(); return; }
      const selection = await classifyFolder(result.filePaths[0]);
      if (!active()) return;
      busy = false;
      if (selection.kind === "existing") await open(selection);
      else newFolder = selection;
    } catch (error) { if (active()) await failure(error); }
    finally { busy = false; await render(); }
  }

  async function action({ id, selection }:DesktopDialogAction) {
    if (!active() || busy) return;
    if (id === "select") {
      if (selection !== "new") { newFolder = null; state.selection = selection; }
      await render(); return;
    }
    if (id === "choose") return choose();
    if (id === "search") return discover();
    if (id === "cancel-new") { newFolder = null; if (state.screen === "searching") await discover(); else await render(); return; }
    if (id === "use" && newFolder && selection === "new") return open(newFolder);
    if (id === "open") {
      const candidate = state.candidates?.find(item => item.id === selection);
      if (candidate) await open({ kind:"existing", path:candidate.path, picked:candidate.path });
    }
    if (id === "retry") {
      const path = state.retryPath ?? recorded.libraryRoot;
      if (path && await stat(path).then(info => info.isDirectory(), () => false)) await open({ kind:"existing", path, picked:path });
      else await discover();
    }
  }

  const surface: DesktopDialog = await openDesktopDialog({ locale, model:recoveryModel(locale, state, null), onClose:stop,
    onAction:command => { void action(command).catch(error => failure(error)); } });
  const onQuit = () => { stop(); surface.close(); };
  app.once("before-quit", onQuit);
  try {
    const code = libraryErrorCode(input.error);
    if (code === "missing") await discover(); else await failure(input.error, recorded.libraryRoot ?? undefined);
    await surface.closed;
  } finally { stop(); app.removeListener("before-quit", onQuit); }
}
