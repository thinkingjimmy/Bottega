/**
 * [INPUT]: Depends on React, the i18n provider and Settings primitives, the Dock settings store, and the settings/dock sections.
 * [OUTPUT]: Provides DockSettingsContent for the plugin detail page and DockPluginSetupDialog for the catalog card. The Display section groups mode and placement. Focus return refreshes background approval. The content includes setup, sync decisions and localized command failures.
 * [POS]: apps/desktop/src/views/settings/dock; the Dock plugin's settings content, hosted by views/settings/plugins and components/plugins; main applies every command and reports the authoritative outcome.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsAlert, SettingsButton } from "@/components/settings/settings-layout";
import { dockSettingsStore, type DockSettingsCommand } from "@/lib/platform/system-dock-settings-client";
import { DockLayoutSection } from "@/components/settings/dock/layout-section";
import { DockAppearance, DockBehavior, DockDisplaySettings } from "@/components/settings/dock/preferences";
import { DockSetupDialog, type DockSetupFlow } from "@/components/settings/dock/setup";
import { DockMaster, DockUnsupported } from "@/components/settings/dock/status";
import { DockSync } from "@/components/settings/dock/sync";
import { DOCK_CONSENT_VERSION } from "../../../../shared/system-dock/local-state";

const FAILURE_KEYS: Record<DockSettingsCommand, string> = {
  "app-pin": "apps.dock.pinFailed",
  setup: "systemDock.settings.confirmFailed", preference: "systemDock.settings.failedPreference", mode: "systemDock.settings.failedMode",
  disable: "systemDock.settings.failedDisable", resume: "systemDock.settings.failedResume",
  reset: "systemDock.settings.failedReset", resolve: "systemDock.settings.failedResolve", import: "systemDock.settings.failedImport",
};

function useDockSettings() {
  const state = useSyncExternalStore(dockSettingsStore.subscribe, dockSettingsStore.getSnapshot);
  useEffect(() => {
    const refresh = () => dockSettingsStore.load();
    refresh(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
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
    {state.failed && state.failed !== "setup" && <SettingsAlert title={t(FAILURE_KEYS[state.failed])}
      action={<>
        <SettingsButton variant="outline" onClick={() => void dockSettingsStore.load()}>{t("common.retry")}</SettingsButton>
        <SettingsButton variant="ghost" onClick={() => dockSettingsStore.dismissFailure()}>{t("common.close")}</SettingsButton>
      </>}/>}
    {!snapshot ? state.loadFailed ? <SettingsAlert title={t("systemDock.settings.loadFailed")}
      action={<SettingsButton variant="outline" onClick={() => dockSettingsStore.load()}>{t("common.retry")}</SettingsButton>}
    /> : <Skeleton data-testid="dock-settings-loading" className="h-40 w-full rounded-lg" /> : <>
      {!snapshot.capability.supported ? <DockUnsupported capability={snapshot.capability} /> : <>
        <DockMaster snapshot={snapshot} pending={state.pending} showToggle={!plugin} onTurnOn={() => setSetup("full")} />
        <DockDisplaySettings state={state} onSwitchToReplace={() => {
          if (snapshot.state.consentVersion === DOCK_CONSENT_VERSION) void dockSettingsStore.setMode("replace"); else setSetup("consent");
        }} />
        {snapshot.state.enabled && <>
          <DockAppearance state={state} />
          <DockBehavior state={state} />
          <DockLayoutSection state={state} />
        </>}
        <DockSetupDialog capability={snapshot.capability} layoutInitialized={snapshot.layoutInitialized} flow={setup} onExit={() => setSetup(null)} />
      </>}
      <DockSync state={state} />
    </>}
  </div>;
}

/** A card can start setup before the plugin detail has loaded. */
export function DockPluginSetupDialog({ onExit }: { onExit(): void }) {
  const { t } = useAppTranslation();
  const state = useDockSettings();
  const snapshot = state.snapshot;
  if (!snapshot) return state.loadFailed ? <SettingsAlert title={t("systemDock.settings.loadFailed")}
    action={<SettingsButton variant="outline" onClick={() => dockSettingsStore.load()}>{t("common.retry")}</SettingsButton>}
  /> : null;
  if (!snapshot.capability.supported) return <DockUnsupported capability={snapshot.capability} />;
  return <DockSetupDialog capability={snapshot.capability} layoutInitialized={snapshot.layoutInitialized} flow="full" onExit={onExit} />;
}
