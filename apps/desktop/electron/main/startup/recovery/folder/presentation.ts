/**
 * [INPUT]: Recovery state, discovered paths, timestamps and five-language copy.
 * [OUTPUT]: One consistent dialog model, with inline new-location consent and at most two footer actions.
 * [POS]: Folder recovery presentation independent of filesystem writes and Electron lifecycle.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { desktopCopy } from "../../dialogs/copy";
import type { DesktopDialogCandidate, DesktopDialogModel } from "../../dialogs/surface/types";
import type { FolderSelection } from "./selection";

export type RecoveryState = { screen:"searching" | "multiple" | "missing" | "offline" | "wrong" | "locked";
  title:string; message:string; candidates?:DesktopDialogCandidate[]; selection?:string; previous?:string; retryPath?:string };

export function recoveryModel(locale: AppLocale, state: RecoveryState, newFolder: FolderSelection | null, busy = false): DesktopDialogModel {
  const t = (key:Parameters<typeof desktopCopy>[1]) => desktopCopy(locale, key);
  const candidates = [...(state.candidates ?? []), ...(newFolder ? [{ id:"new", path:newFolder.path, detail:t("newNote"), isNew:true }] : [])];
  const selection = newFolder ? "new" : state.selection;
  const choose = { id:"choose", label:t(state.screen === "searching" && !newFolder ? "manual" : "choose"),
    primary:!newFolder && (state.screen === "missing" || state.screen === "wrong") };
  return { screen:state.screen, title:state.title, message:state.message, busy,
    retry:state.screen === "searching" ? undefined : t("search"), candidates, selection,
    cancelNew:newFolder ? t("cancelNew") : undefined,
    previous:state.previous && state.screen !== "searching" ? { label:t("previous"), path:state.previous } : undefined,
    actions:newFolder ? [choose, { id:"use", label:t("use"), primary:true, requiresSelection:true }]
      : state.screen === "multiple" ? [choose, { id:"open", label:t("open"), primary:true, requiresSelection:true }]
      : state.screen === "offline" || state.screen === "locked" ? [choose, { id:"retry", label:t("retry"), primary:true }] : [choose],
  };
}
