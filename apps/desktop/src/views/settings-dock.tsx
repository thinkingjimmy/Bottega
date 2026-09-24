/**
 * [INPUT]: Depends on React, the i18n provider, PageShell and Settings primitives, the Dock settings store, and the settings/dock sections.
 * [OUTPUT]: Provides DockSettingsView: the capability gate, the master section (one switch for on/off, mode, restore), the setup dialog it opens, and for an enabled Dock the appearance, behavior, layout, sync and recovery sections, with one retryable failure line for the last command.
 * [POS]: Settings layer's Bottega Dock page (macOS only; the sidebar entry exists only when the preload exposed the bridge); main applies every command and this page renders only what main reports.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { PanelBottom } from "lucide-react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import { SettingsAlert, SettingsButton, SettingsCanvas } from "@/components/settings/settings-layout";
import { dockSettingsStore, type DockSettingsCommand } from "@/lib/system-dock-settings-client";
import { DockLayoutSection } from "@/components/settings/dock/layout-section";
import { DockAppearance, DockBehavior } from "@/components/settings/dock/preferences";
import { DockSetupDialog, type DockSetupFlow } from "@/components/settings/dock/setup";
import { DockMaster, DockRecovery, DockUnsupported } from "@/components/settings/dock/status";
import { DockSync } from "@/components/settings/dock/sync";
import { DOCK_CONSENT_VERSION } from "../../shared/system-dock/local-state";

const FAILURE_KEYS: Record<DockSettingsCommand, string> = {
  setup: "systemDock.settings.confirmFailed", preference: "systemDock.settings.failedPreference", mode: "systemDock.settings.failedMode",
  disable: "systemDock.settings.failedDisable", restore: "systemDock.settings.failedRestore", resume: "systemDock.settings.failedResume",
  reset: "systemDock.settings.failedReset", resolve: "systemDock.settings.failedResolve", import: "systemDock.settings.failedImport",
};

export function DockSettingsView() {
  const { t } = useAppTranslation();
  const state = useSyncExternalStore(dockSettingsStore.subscribe, dockSettingsStore.getSnapshot);
  const [setup, setSetup] = useState<DockSetupFlow | null>(null);
  useEffect(() => { dockSettingsStore.load(); }, []);
  const snapshot = state.snapshot;
  return <PageShell title={t("systemDock.settings.title")} icon={<PanelBottom />}>
    <SettingsCanvas>
      <div className="space-y-8">
        {state.failed && state.failed !== "setup" && <SettingsAlert>
          <span className="flex flex-wrap items-center justify-between gap-2">{t(FAILURE_KEYS[state.failed])}
            <SettingsButton variant="ghost" onClick={() => dockSettingsStore.dismissFailure()}>{t("common.close")}</SettingsButton></span>
        </SettingsAlert>}
        {!snapshot ? state.loadFailed ? <SettingsAlert>{t("systemDock.settings.loadFailed")}</SettingsAlert>
          : <Skeleton data-testid="dock-settings-loading" className="h-40 w-full rounded-lg" />
          : !snapshot.capability.supported ? <DockUnsupported capability={snapshot.capability} />
            : <>
              <DockMaster snapshot={snapshot} pending={state.pending} onTurnOn={() => setSetup("full")} onSwitchToReplace={() => {
                // Replacement needs the recorded consent; a Dock that already agreed switches directly (INV-01).
                if (snapshot.state.consentVersion === DOCK_CONSENT_VERSION) void dockSettingsStore.setMode("replace"); else setSetup("consent");
              }} />
              {snapshot.state.enabled && <>
                <DockAppearance state={state} />
                <DockBehavior state={state} />
                <DockLayoutSection state={state} />
                <DockSync state={state} />
                <DockRecovery snapshot={snapshot} />
              </>}
              <DockSetupDialog capability={snapshot.capability} flow={setup} onExit={() => setSetup(null)} />
            </>}
      </div>
    </SettingsCanvas>
  </PageShell>;
}
