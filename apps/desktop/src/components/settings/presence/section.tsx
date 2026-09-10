/**
 * [INPUT]: Depends on shared settings controls, Select sizing and inherited menu typography, localized copy, and main-owned presence capabilities/commands.
 * [OUTPUT]: Provides one background switch and a conditional macOS display selector with hardware-aware availability, a shortcut hint, and stable descriptions while saving.
 * [POS]: General settings presence section; login remains separate from background display selection.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { presenceStore } from "@/lib/presence-client";
import { useShortcutKeys } from "@/lib/shortcuts";
import type { PresenceDisplayMode, PresenceReason } from "../../../../shared/presence-ipc";

const reasonKey: Record<NonNullable<PresenceReason>, string> = {
  "shortcut-unavailable": "shortcutUnavailable", platform: "platform", development: "development", approval: "approvalReason", "system-disabled": "systemDisabled",
  "login-failed": "loginFailed", "save-failed": "saveFailed", "tray-unavailable": "trayUnavailable",
  "panel-unavailable": "panelUnavailable", "screen-unavailable": "screenUnavailable", "native-unavailable": "nativeUnavailable", "no-notch": "noNotch",
};
export function PresenceSettings() {
  const { t } = useAppTranslation();
  const keys = useShortcutKeys("taskPanel");
  const state = useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot);
  const value = state.presence;
  const busy = Object.values(state.commands).some((command) => command?.status === "pending");
  const unavailable = !value || !window.presence || busy || value.quitting;
  useEffect(() => { presenceStore.load(); }, []);
  const copy = (key: string) => t(`settings.presence.${key}`);
  const displayCommand = state.commands.display;
  const display = displayCommand ?? value?.display;
  const mode = value?.effectiveDisplayMode ?? (value?.preferences.showTaskStatusAtTop ? "notch" : "icon");
  const notch = value?.capabilities.notch;
  const panelActive = mode === "notch" && value?.top.status === "enabled";
  const displayReason = display?.reason ?? (panelActive ? value?.top.reason : notch?.reason);
  return <SettingsSection title={copy("title")} description={copy("notice")}>
    <SettingsList>{(["login", "retention"] as const).map((field) => {
      const command = state.commands[field];
      const status = command ?? value?.[field];
      const preference = field === "login" ? value?.preferences.launchAtLogin : value?.preferences.keepRunningInBackground;
      const pending = status?.status === "pending";
      const reason = status?.reason ? copy(reasonKey[status.reason]) : null;
      return <SettingsRow key={field} label={copy(field)} htmlFor={`presence-${field}`} description={<>
        <span>{copy(field === "retention" ? (value?.capabilities.displayModeSelection ? "retentionDescription" : "retentionDescriptionTray") : "loginDescription")}</span>
        {reason && <span className="mt-1 block" role="status">{reason}</span>}
        {(status?.status === "failed" || status?.status === "blocked") && <span className="mt-2 flex gap-2">
          {status.reason === "approval" || status.reason === "system-disabled" ? <SettingsButton variant="outline" onClick={() => void window.presence?.openSystemSettings()}>{copy("systemSettings")}</SettingsButton> :
            <SettingsButton variant="outline" disabled={unavailable} onClick={() => void presenceStore.set(field, command?.target ?? value?.[field].retryTarget ?? Boolean(preference))}>{copy("retry")}</SettingsButton>}
        </span>}
      </>} control={<SettingsSwitch id={`presence-${field}`} checked={Boolean(preference)}
        label={copy(field)} describedBy={`presence-${field}-description`} disabled={unavailable || value?.[field].status === "unsupported" || pending}
        onToggle={(enabled) => void presenceStore.set(field, enabled)} />} />;
    })}
    {value?.preferences.keepRunningInBackground && value.capabilities.displayModeSelection && <SettingsRow
      label={copy("displayMode")} htmlFor="presence-display" description={<>
        <span>{copy(panelActive ? "notchDescription" : "iconDescription")}</span>
        {displayReason && <span className="mt-1 block" role="status">{copy(reasonKey[displayReason])}</span>}
        {display?.status === "failed" && <span className="mt-2 flex gap-2"><SettingsButton variant="outline" disabled={unavailable}
          onClick={() => void presenceStore.setDisplayMode(displayCommand?.target ?? value.display.retryTarget ?? mode)}>{copy("retry")}</SettingsButton></span>}
        {panelActive && keys && <span className="mt-2 block text-xs">{keys.join("")}</span>}
      </>} control={<Select value={mode} disabled={unavailable} onValueChange={(next) => void presenceStore.setDisplayMode(next as PresenceDisplayMode)}>
        <SelectTrigger id="presence-display" aria-label={copy("displayMode")} aria-describedby="presence-display-description" size="lg" className="max-w-[40vw]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="text-sm"><SelectItem value="icon">{copy("iconMode")}</SelectItem>
          <SelectItem value="notch" disabled={notch?.status !== "available"}>{copy("notchMode")}</SelectItem></SelectContent>
      </Select>} />}
    </SettingsList>
    {value?.quitting && <p role="status">{copy("quitting")}</p>}
  </SettingsSection>;
}
