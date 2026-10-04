/**
 * [INPUT]: Depends on Electron's message box and Notification, the native translation catalog and the App's display name.
 * [OUTPUT]: Provides nativeConsentPorts: the broker's ask (the extension dialog on a visible window, closable by abort) and notify (a
 *           notification that opens nothing by itself; clicking it activates Bottega, whose window then asks).
 * [POS]: apps/service/consent's Electron edge; the broker holds every decision rule.
 */
import { dialog, Notification, type BrowserWindow } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../../shared/i18n/native";
import type { ConsentPorts } from "./broker";

export function nativeConsentPorts(deps: Readonly<{ window(): BrowserWindow | null; locale(): AppLocale }>): Pick<ConsentPorts, "ask" | "notify"> {
  return {
    ask(record, details, signal) {
      const window = deps.window();
      // A hidden window (Bottega kept in the background) shows nobody the dialog: that is the no-window case.
      if (!window || window.isDestroyed() || !window.isVisible()) return null;
      const locale = deps.locale();
      return dialog.showMessageBox(window, {
        type: "warning", signal, defaultId: 0, cancelId: 0,
        buttons: [translate(locale, "settings.native.disableExtensions"), translate(locale, "settings.native.enableExtensions")],
        title: translate(locale, "settings.native.extensionTitle"),
        message: translate(locale, "settings.native.extensionMessage", { name: record.displayName }),
        detail: [...details, "", translate(locale, "settings.native.extensionDetail")].join("\n"),
      }).then(result => result.response === 1);
    },
    notify(record) {
      if (!Notification.isSupported()) return;
      const locale = deps.locale();
      new Notification({ title: translate(locale, "settings.native.extensionNotifyTitle", { name: record.displayName }),
        body: translate(locale, "settings.native.extensionNotifyBody") }).show();
    },
  };
}
