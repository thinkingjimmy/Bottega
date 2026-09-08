/**
 * [INPUT]: Depends on Settings controls, localized copy, platform presentation, and the persistent presence command/state owner.
 * [OUTPUT]: Provides General presence controls with persistent retry state, manual panel access, and shortcut availability.
 * [POS]: General settings section following Appearance; main decides every effective capability.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { presenceStore } from "@/lib/presence-client";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { useShortcutKeys } from "@/lib/shortcuts";
import { isApplePlatform } from "@/lib/platform";
import type { PresenceReason } from "../../../../shared/presence-ipc";

const reasonKey: Record<NonNullable<PresenceReason>, string> = {
  "shortcut-unavailable": "shortcutUnavailable", platform: "platform", development: "development", approval: "approvalReason", "system-disabled": "systemDisabled",
  "login-failed": "loginFailed", "save-failed": "saveFailed", "tray-unavailable": "trayUnavailable",
  "panel-unavailable": "panelUnavailable", "screen-unavailable": "screenUnavailable", "native-unavailable": "nativeUnavailable",
};
export function PresenceSettings() {
  const { t } = useAppTranslation();
  const keys = useShortcutKeys("taskPanel");
  const state = useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot);
  const value = state.presence;
  const busy = Object.values(state.commands).some((command) => command?.status === "pending");
  useEffect(() => { presenceStore.load(); }, []);
  const copy = (key: string) => t(`settings.presence.${key}`);
  const fields = isApplePlatform() ? ["login", "retention", "top"] as const : ["login", "retention"] as const;
  return <SettingsSection title={copy("title")} description={copy("notice")}>
    <SettingsList>{fields.map((field) => {
      const command = state.commands[field];
      const status = command ?? value?.[field];
      const preference = field === "login" ? value?.preferences.launchAtLogin : field === "retention" ? value?.preferences.keepRunningInBackground : value?.preferences.showTaskStatusAtTop;
      const pending = status?.status === "pending";
      const failure = status?.status === "failed";
      const reason = status?.reason ? copy(reasonKey[status.reason]) : null;
      return <SettingsRow key={field} label={copy(field)} htmlFor={`presence-${field}`} description={<>
        <span>{copy(`${field}Description`)}</span>
        {field === "top" && preference && <span className="mt-2 flex items-center gap-2">
          <SettingsButton variant="outline" disabled={busy || value?.quitting || value?.top.status !== "enabled"}
            onClick={() => void presenceStore.openPanel().catch(() => toast.error(copy("panelUnavailable")))}>{copy("openPanel")}</SettingsButton>
          {keys && <span className="text-xs">{keys.join("")}</span>}
        </span>}
        {(pending || reason) && <span className="mt-1 block" role="status">{pending ? copy("applying") : reason}</span>}
        {(failure || status?.status === "blocked") && <span className="mt-2 flex gap-2">
          {status?.reason === "approval" || status?.reason === "system-disabled" ? <SettingsButton variant="outline" onClick={() => void window.presence?.openSystemSettings()}>{copy("systemSettings")}</SettingsButton> :
            <SettingsButton variant="outline" disabled={busy || value?.quitting} onClick={() => void presenceStore.set(field, command?.target ?? value?.[field].retryTarget ?? Boolean(preference), copy("saveFailed"))}>{copy("retry")}</SettingsButton>}
        </span>}
      </>} control={<SettingsSwitch id={`presence-${field}`} checked={Boolean(preference)}
        label={copy(field)} describedBy={`presence-${field}-description`} disabled={!value || !window.presence || busy || value.quitting || value[field].status === "unsupported" || pending}
        onToggle={(enabled) => void presenceStore.set(field, enabled, copy("saveFailed"))} />} />;
    })}</SettingsList>
    {value?.quitting && <p role="status">{copy("quitting")}</p>}
  </SettingsSection>;
}
