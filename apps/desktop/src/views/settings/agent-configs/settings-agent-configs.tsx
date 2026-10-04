/**
 * [INPUT]: Depends on SettingsPage, the Settings layout primitives, Projects, Settings (Provider order), workbench-copy and
 *          the main window's Agent-configuration bridge and settings/agent-configs (list, dialog, ordered list state).
 * [OUTPUT]: Provides AgentConfigsSettingsView with grouped configurations, distinct load/refresh failures and recovery.
 * [POS]: apps/desktop/src/views/settings/agent-configs; Workbench Settings page; its state hook retains canonical records while the dialog owns unsaved edits.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LoaderCircle, Plus, UserCog } from "lucide-react";
import { useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { AgentConfigDialog } from "@/components/settings/agent-configs/dialog-entry";
import { AgentConfigList } from "@/components/settings/agent-configs/config-list";
import { useAgentConfigsState } from "@/components/settings/agent-configs/state/use-agent-configs-state";
import type { AgentConfigBridge, AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import { agentConfigsBridge } from "@/lib/agent/agent-configs-client";
import { SettingsAlert, SettingsButton, SettingsCanvas, SettingsEmpty, SettingsSection } from "@/components/settings/settings-layout";
import { providerOrder } from "@/lib/agent/agent-backends";
import { settingsStore } from "@/lib/settings/store/settings-store";

export function AgentConfigsSettingsView({ bridge = agentConfigsBridge() }: { bridge?: AgentConfigBridge | null }) {
  const { i18n, t } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language);
  const copy = workbench.agentConfigs;
  const { projects: allProjects } = useProjects();
  const projects = useMemo(() => allProjects.filter(project => !project.archivedAt && project.role !== "base-custody")
    .map(project => ({ id: project.id, name: project.name })), [allProjects]);
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  useEffect(() => { settingsStore.ensureLoaded(); }, []);
  const { configs, loading, error, retry, save } = useAgentConfigsState(bridge);
  const [dialog, setDialog] = useState<{ key: number; editing?: AgentConfigView } | null>(null);
  const live = configs?.filter(config => !config.deleted && config.payload) ?? null;
  const everywhere = live?.filter(config => config.payload!.availableIn === "all") ?? [];
  const somewhere = live?.filter(config => config.payload!.availableIn !== "all") ?? [];
  const open = (editing?: AgentConfigView) => setDialog(current => ({ key: (current?.key ?? 0) + 1, editing }));
  const newButton = <SettingsButton disabled={!bridge || configs === null} onClick={() => open()}><Plus />{copy.newConfig}</SettingsButton>;
  const errorCopy = error === "unavailable" ? copy.unavailable : error === "refresh" ? copy.refreshFailed : copy.loadFailed;
  return (
    <SettingsPage title={copy.title} actions={newButton}>
      <SettingsCanvas>
        <div aria-busy={loading || undefined} className="space-y-6">
          <SettingsSection title={copy.allProjects} description={copy.description}>
            {error && <div className="space-y-2">
              <SettingsAlert>{errorCopy}</SettingsAlert>
              <SettingsButton variant="outline" disabled={loading} onClick={retry}>{t("common.retry")}</SettingsButton>
            </div>}
            {loading && <p role="status" className={live ? "sr-only" : "flex items-center gap-2 text-xs text-muted-foreground"}>
              {!live && <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />}{copy.loading}
            </p>}
            {live && live.length === 0 ? <SettingsEmpty icon={<UserCog />} title={copy.emptyTitle} hint={copy.emptyBody} />
              : everywhere.length > 0 ? <AgentConfigList configs={everywhere} projects={projects} workbench={workbench} onEdit={open} />
                : live ? <p className="text-muted-foreground text-xs">{copy.allProjectsHint}</p> : null}
          </SettingsSection>
          {somewhere.length > 0 && (
            <SettingsSection title={copy.someProjects} description={copy.someProjectsDescription}>
              <AgentConfigList configs={somewhere} projects={projects} workbench={workbench} onEdit={open} />
            </SettingsSection>
          )}
        </div>
      </SettingsCanvas>
      {dialog && (
        <AgentConfigDialog key={dialog.key} open editing={dialog.editing?.payload ? { configId: dialog.editing.configId, payload: dialog.editing.payload } : undefined} providers={providerOrder(settings)} projects={projects}
          workbench={workbench} onOpenChange={next => { if (!next) setDialog(null); }} onSave={save} />
      )}
    </SettingsPage>
  );
}
