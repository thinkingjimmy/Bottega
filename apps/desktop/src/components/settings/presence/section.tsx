/**
 * [INPUT]: Depends on shared settings controls and the confirmation dialog, localized copy, main-owned presence capabilities/commands, and the optional Dock settings bridge snapshot.
 * [OUTPUT]: Provides one background switch (confirming that turning it off also ends an enabled Bottega Dock when the last window closes) and an independent menu bar/tray visibility switch.
 * [POS]: General settings presence section; login, retention and native icon visibility remain independent.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { presenceStore } from "@/lib/clients/presence-client";
import type { PresenceReason } from "../../../../shared/ipc/agent/presence-ipc";

const reasonKey: Record<NonNullable<PresenceReason>, string> = {
  platform: "platform", development: "development", approval: "approvalReason", "system-disabled": "systemDisabled",
  "login-failed": "loginFailed", "save-failed": "saveFailed", "tray-unavailable": "trayUnavailable",
};
export function PresenceSettings() {
  const { t } = useAppTranslation();
  const state = useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot);
  const value = state.presence;
  const busy = Object.values(state.commands).some((command) => command?.status === "pending");
  const unavailable = !value || !window.presence || busy || value.quitting;
  useEffect(() => { presenceStore.load(); }, []);
  const copy = (key: string) => t(`settings.presence.${key}`);
  /* Without background residence the last closed window quits Bottega, which also ends Bottega Dock
     and restores the system Dock; that consequence is confirmed, never discovered afterwards. */
  const [confirmDockOff, setConfirmDockOff] = useState(false);
  const toggle = async (field: "login" | "retention" | "menuBar", enabled: boolean) => {
    if (field === "retention" && !enabled) {
      const dock = await window.systemDockSettings?.snapshot().catch(() => null);
      if (dock?.state.enabled) { setConfirmDockOff(true); return; }
    }
    void presenceStore.set(field, enabled);
  };
  return <SettingsSection title={copy("title")} description={copy("notice")}>
    <SettingsList>{(["login", "retention", "menuBar"] as const).map((field) => {
      const command = state.commands[field];
      const status = command ?? value?.[field];
      const preference = field === "login" ? value?.preferences.launchAtLogin : field === "menuBar" ? value?.preferences.showInMenuBar : value?.preferences.keepRunningInBackground;
      const pending = status?.status === "pending";
      const reason = status?.reason ? copy(reasonKey[status.reason]) : null;
      return <SettingsRow key={field} label={copy(field)} htmlFor={`presence-${field}`} description={<>
        <span>{copy(field === "menuBar" ? "menuBarDescription" : field === "retention" ? "retentionDescription" : "loginDescription")}</span>
        {reason && <span className="mt-1 block" role="status">{reason}</span>}
        {(status?.status === "failed" || status?.status === "blocked") && <span className="mt-2 flex gap-2">
          {status.reason === "approval" || status.reason === "system-disabled" ? <SettingsButton variant="outline" onClick={() => void window.presence?.openSystemSettings()}>{copy("systemSettings")}</SettingsButton> :
            <SettingsButton variant="outline" disabled={unavailable} onClick={() => void presenceStore.set(field, command?.target ?? value?.[field].retryTarget ?? Boolean(preference))}>{copy("retry")}</SettingsButton>}
        </span>}
      </>} control={<SettingsSwitch id={`presence-${field}`} checked={Boolean(preference)}
        label={copy(field)} describedBy={`presence-${field}-description`} disabled={unavailable || value?.[field].status === "unsupported" || pending}
        onToggle={(enabled) => void toggle(field, enabled)} />} />;
    })}
    </SettingsList>
    {value?.quitting && <p role="status">{copy("quitting")}</p>}
    <ConfirmationDialog open={confirmDockOff} onOpenChange={setConfirmDockOff} title={t("systemDock.presence.retentionOffTitle")}
      description={t("systemDock.presence.retentionOffBody")} confirmLabel={t("systemDock.presence.retentionOffConfirm")} confirmTone="destructive"
      onConfirm={() => { setConfirmDockOff(false); void presenceStore.set("retention", false); }} />
  </SettingsSection>;
}
