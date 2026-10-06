/**
 * [INPUT]: Native clipboard/shell, current error diagnostics, localized copy and the owned desktop surface.
 * [OUTPUT]: Equally styled Copy error details / Report actions with honest inline acknowledgement and no diagnostic viewer or automatic submission.
 * [POS]: Reused by startup and quit error windows; timers and late results belong to one window only.
 */
import { clipboard, shell } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../../shared/i18n/native";
import { desktopCopy } from "../copy";
import type { DesktopDialog } from "./window";
import type { DesktopDialogButton } from "./types";

export const supportActions = (locale: AppLocale): DesktopDialogButton[] => [
  { id:"copy", label:translate(locale, "settings.native.copyTechnicalDetails"), quiet:true },
  { id:"report", label:desktopCopy(locale, "report"), quiet:true },
];

export function dialogFeedback(surface: DesktopDialog, locale: AppLocale, diagnostics: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, revision = 0;
  void surface.closed.then(() => { closed = true; revision++; clearTimeout(timer); });
  return async (action: string) => {
    if (closed) return;
    if (action === "copy") {
      const current = ++revision;
      clearTimeout(timer);
      try {
        const text = diagnostics();
        clipboard.writeText(text);
        if (clipboard.readText() !== text) throw new Error("CLIPBOARD_WRITE_UNCONFIRMED");
        await surface.label("copy", desktopCopy(locale, "copied"));
        if (!closed && current === revision) timer = setTimeout(() => {
          if (!closed && current === revision) void surface.label("copy", translate(locale, "settings.native.copyTechnicalDetails")).catch(() => {});
        }, 2400);
      } catch (error) {
        console.warn("[desktop-dialog] copy failed", error);
        if (!closed && current === revision) await surface.label("copy", desktopCopy(locale, "copyFailed")).catch(() => {});
      }
    } else if (action === "report") {
      await shell.openExternal("https://github.com/thinkingjimmy/Bottega/issues/new").catch(error => console.warn("[desktop-dialog] feedback unavailable", error));
    }
  };
}
