/**
 * [INPUT]: Native clipboard/shell, current error diagnostics, localized copy and the owned desktop surface.
 * [OUTPUT]: Shared Copy/Report actions, startup-only Download latest actions and localized inline feedback with a single in-flight fixed Release-page open.
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

export const startupSupportActions = (locale: AppLocale): DesktopDialogButton[] => [
  { id:"download", label:desktopCopy(locale, "downloadLatest"), quiet:true },
  ...supportActions(locale),
];

export function dialogFeedback(surface: DesktopDialog, locale: AppLocale, diagnostics: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, revision = 0;
  let openingLatest = false;
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
    } else if (action === "download" && !openingLatest) {
      openingLatest = true;
      let opened = false;
      try {
        await shell.openExternal("https://github.com/thinkingjimmy/Bottega/releases/latest");
        opened = true;
      } catch (error) {
        console.warn("[desktop-dialog] release page unavailable", error);
      } finally {
        if (!closed) await surface.label("download", desktopCopy(locale, opened ? "downloadLatest" : "downloadFailed")).catch(() => {});
        openingLatest = false;
      }
    }
  };
}
