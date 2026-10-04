/**
 * [INPUT]: Depends on React, the i18n provider, SettingsPage and Settings primitives, the Dock settings store, and the settings/dock sections.
 * [OUTPUT]: Provides DockSettingsView, reusable DockSettingsContent for the plugin detail, and DockPluginSetupDialog; all use the original owner, sections and setup confirmation. Sync and recovery remain visible while off.
 * [POS]: apps/desktop/src/views/settings/dock; Settings layer's legacy Dock page and the Dock plugin's settings content; main applies every command and reports the authoritative outcome.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsPage } from "@/components/page-shell";
import { SettingsAlert, SettingsButton, SettingsCanvas } from "@/components/settings/settings-layout";
import { dockSettingsStore, type DockSettingsCommand } from "@/lib/platform/system-dock-settings-client";
import { DockLayoutSection } from "@/components/settings/dock/layout-section";
import { DockAppearance, DockBehavior, DockPlacement } from "@/components/settings/dock/preferences";
import { DockSetupDialog, type DockSetupFlow } from "@/components/settings/dock/setup";
import { DockMaster, DockRecovery, DockUnsupported } from "@/components/settings/dock/status";
import { DockSync } from "@/components/settings/dock/sync";
import { DOCK_CONSENT_VERSION } from "../../../../shared/system-dock/local-state";

const FAILURE_KEYS: Record<DockSettingsCommand, string> = {
  setup: "systemDock.settings.confirmFailed", preference: "systemDock.settings.failedPreference", mode: "systemDock.settings.failedMode",
  disable: "systemDock.settings.failedDisable", restore: "systemDock.settings.failedRestore", resume: "systemDock.settings.failedResume",
  reset: "systemDock.settings.failedReset", resolve: "systemDock.settings.failedResolve", import: "systemDock.settings.failedImport",
};

export function DockSettingsView() {
  const { t } = useAppTranslation();
  return <SettingsPage title={t("systemDock.settings.title")}>
    <SettingsCanvas><DockSettingsContent /></SettingsCanvas>
  </SettingsPage>;
}

function useDockSettings() {
  const state = useSyncExternalStore(dockSettingsStore.subscribe, dockSettingsStore.getSnapshot);
  useEffect(() => { dockSettingsStore.load(); }, []);
  return state;
}

/** The plugin header owns its switch; the settings themselves remain the original Dock controls. */
export function DockSettingsContent({ plugin = false }: { plugin?: boolean }) {
  const { t } = useAppTranslation();
  const state = useDockSettings();
  const [setup, setSetup] = useState<DockSetupFlow | null>(null);
  const snapshot = state.snapshot;
  if (plugin && !window.systemDockSettings) return null;
  return <div className="space-y-8" data-dock-settings="">
    {state.failed && state.failed !== "setup" && <SettingsAlert>
      <span className="flex flex-wrap items-center justify-between gap-2">{t(FAILURE_KEYS[state.failed])}
        <SettingsButton variant="ghost" onClick={() => dockSettingsStore.dismissFailure()}>{t("common.close")}</SettingsButton></span>
    </SettingsAlert>}
    {!snapshot ? state.loadFailed ? <SettingsAlert>
      <span className="flex flex-wrap items-center justify-between gap-2">{t("systemDock.settings.loadFailed")}
        <SettingsButton variant="outline" onClick={() => dockSettingsStore.load()}>{t("common.retry")}</SettingsButton></span>
    </SettingsAlert> : <Skeleton data-testid="dock-settings-loading" className="h-40 w-full rounded-lg" /> : <>
      {!snapshot.capability.supported ? <DockUnsupported capability={snapshot.capability} /> : <>
        <DockMaster snapshot={snapshot} pending={state.pending} showToggle={!plugin} onTurnOn={() => setSetup("full")} onSwitchToReplace={() => {
          if (snapshot.state.consentVersion === DOCK_CONSENT_VERSION) void dockSettingsStore.setMode("replace"); else setSetup("consent");
        }} />
        <DockPlacement state={state} />
        {snapshot.state.enabled && <>
          <DockAppearance state={state} />
          <DockBehavior state={state} />
          <DockLayoutSection state={state} />
        </>}
        <DockSetupDialog capability={snapshot.capability} flow={setup} onExit={() => setSetup(null)} />
      </>}
      <DockSync state={state} />
      <DockRecovery snapshot={snapshot} pending={state.pending} />
    </>}
  </div>;
}

/** A card can start setup before the plugin detail has loaded. */
export function DockPluginSetupDialog({ onExit }: { onExit(): void }) {
  const { t } = useAppTranslation();
  const state = useDockSettings();
  const snapshot = state.snapshot;
  if (!snapshot) return state.loadFailed ? <SettingsAlert>
    <span className="flex flex-wrap items-center justify-between gap-2">{t("systemDock.settings.loadFailed")}
      <SettingsButton variant="outline" onClick={() => dockSettingsStore.load()}>{t("common.retry")}</SettingsButton></span>
  </SettingsAlert> : null;
  if (!snapshot.capability.supported) return <DockUnsupported capability={snapshot.capability} />;
  return <DockSetupDialog capability={snapshot.capability} flow="full" onExit={onExit} />;
}
