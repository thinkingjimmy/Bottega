/**
 * [INPUT]: Depends on React, the i18n provider, the canonical settingsStore, PageShell and the Settings row/list/switch primitives
 * [OUTPUT]: Provides LabSettingsView: the Lab preamble and the "Keep Agent connections" switch, default off
 * [POS]: Settings layer's Lab view; holds no snapshot of its own and never shows connection state (agent-connections PRD Q6)
 */

import { useEffect, useSyncExternalStore } from "react";
import { FlaskConical } from "lucide-react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import {
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings-store";

/* 实验区不分组：一条开关不值得一个 section 标题，页头已经写着 Lab 了。
   前言说清这里的东西随时会变，用户据此决定要不要打开。 */
export function LabSettingsView() {
  const { t } = useAppTranslation();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);
  return (
    <PageShell title={t("settings.lab.title")} icon={<FlaskConical />}>
      <SettingsCanvas>
        <div className="space-y-4">
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            {t("settings.lab.preamble")}
          </p>
          <SettingsList>
            <SettingsRow
              label={t("settings.lab.agentConnections")}
              htmlFor="agent-connections"
              description={t("settings.lab.agentConnectionsDescription")}
              control={
                settings ? (
                  <SettingsSwitch
                    id="agent-connections"
                    label={t("settings.lab.agentConnections")}
                    describedBy="agent-connections-description"
                    checked={settings.agentConnectionsEnabled}
                    onToggle={(agentConnectionsEnabled) =>
                      void settingsStore.update(
                        { agentConnectionsEnabled },
                        t("settings.lab.saveAgentConnectionsFailed")
                      )
                    }
                  />
                ) : (
                  <Skeleton
                    data-testid="agent-connections-loading"
                    className="h-6 w-11 rounded-full"
                  />
                )
              }
            />
          </SettingsList>
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
