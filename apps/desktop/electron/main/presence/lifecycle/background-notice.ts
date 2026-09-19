/**
 * [INPUT]: Electron native notifications, profile path, the current locale and the shared i18n catalogs.
 * [OUTPUT]: Publishes one nonblocking background-close notice per profile.
 * [POS]: Presentation-only lifecycle helper; it never grants retention or delays close.
 */
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Notification } from "electron";
import { translate } from "../../../../shared/i18n/runtime";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
export async function backgroundNotice(userData: string, locale: AppLocale) {
  if (!Notification.isSupported()) return;
  const file = await open(join(userData, "background-notice-shown"), "wx", 0o600).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null; throw error;
  });
  if (!file) return;
  await file.sync(); await file.close();
  new Notification({ title: "Bottega", body: translate(locale, "settings.presence.backgroundNotice"), silent: true }).show();
}
