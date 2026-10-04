/**
 * [INPUT]: Depends on the Settings layout primitives, workbench-copy, the Base snapshots, the Project's workflow binding and
 *          the lazy setup host, the Agent-configuration bridge, the Agent config list and dialog, and Projects.
 * [OUTPUT]: Provides ProjectWorkflowsSection — Project settings › Workflows (Q28): the workflows set up in this Project (On,
 *           who does each role, which computer runs them, Edit / Add workflow into the same dialog) and the Agent configs
 *           offered only in some Projects including this one.
 * Built-in workflow names are localized by stable recipe id.
 * [POS]: Reached only with the workbench build flag. A workflow runs on the Project's Base: without one, the same place offers
 *        Create Base (createProjectBase, as General does) and Add workflow opens once it exists — turning on never makes one;
 *        the row shows the binding the runtime stored (On, or Off with the setup to fix).
 */
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Plus, Workflow } from "lucide-react";
import { PLAN_DEVELOP_REVIEW } from "@ai-chat/cloud-protocol/contracts/workflow/builtin";
import type { AgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import { workflowRecipeName, formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useProjectBinding } from "@/components/bases/workflow/bridge";
import { WorkflowSetupHost } from "@/components/bases/workflow/entry";
import { useBaseSnapshots, useBasesNavigation } from "@/components/providers/content/bases-provider";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { AgentConfigDialog } from "@/components/settings/agent-configs/dialog-entry";
import { AgentConfigList } from "@/components/settings/agent-configs/config-list";
import { SettingsBadge, SettingsButton, SettingsCanvas, SettingsEmpty, SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-layout";
import { agentConfigsBridge } from "@/lib/agent/agent-configs-client";
import { providerOrder } from "@/lib/agent/agent-backends";
import { settingsStore } from "@/lib/settings/store/settings-store";
import type { Project } from "../../../../../shared/ipc/workspace/projects-ipc";

export function ProjectWorkflowsSection({ project }: { project: Project }) {
  const { t, i18n } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language), copy = workbench.projectWorkflows;
  const binding = useProjectBinding(project.id);
  // Asked directly: the Base may exist before anything in this window has shown it.
  const ownerKey = `project:${project.id}`, { snapshots, get } = useBaseSnapshots();
  const [found, setFound] = useState(false);
  useEffect(() => {
    let live = true;
    void get(ownerKey).then(snapshot => { if (live) setFound(Boolean(snapshot)); }, () => { if (live) setFound(false); });
    return () => { live = false; };
  }, [get, ownerKey]);
  const hasBase = found || Boolean(snapshots[ownerKey]);
  const { createProjectBase } = useBasesNavigation();
  const [creating, setCreating] = useState(false);
  const createBase = async () => {
    setCreating(true);
    try { await createProjectBase(project.id); setFound(true); } catch { /* BasesProvider owns the user-facing failure state. */ } finally { setCreating(false); }
  };
  const { projects: allProjects } = useProjects();
  const projects = allProjects.filter(item => !item.archivedAt && item.role !== "base-custody").map(item => ({ id: item.id, name: item.name }));
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const [setup, setSetup] = useState<"new" | "edit" | null>(null);
  const [configs, setConfigs] = useState<AgentConfigView[]>([]);
  const [editing, setEditing] = useState<AgentConfigView | null>(null);
  const bridge = agentConfigsBridge();
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const load = () => void bridge.offeredIn(project.id).then(list => { if (live) setConfigs(list); }, () => undefined);
    load();
    const stop = bridge.onChanged(load);
    return () => { live = false; stop(); };
  }, [bridge, project.id]);
  const projectConfigs = configs.filter(config => !config.deleted && config.payload && config.payload.availableIn !== "all");
  const nameOf = (configId: string) => configs.find(config => config.configId === configId)?.payload?.name ?? "—";
  const save = async (payload: AgentConfigPayload, configId?: string) => { if (bridge && configId) await bridge.update(configId, payload); };

  return (
    <SettingsCanvas>
      <SettingsSection title={copy.tab} description={copy.description}
        action={<SettingsButton disabled={!hasBase} onClick={() => setSetup("new")}><Plus />{copy.addWorkflow}</SettingsButton>}>
        {binding ? (
          <SettingsList>
            <div data-project-workflow={binding.recipe.recipeId}>
              <SettingsRow leading={<Workflow className="size-5 shrink-0" />} label={workflowRecipeName(PLAN_DEVELOP_REVIEW, workbench.setup)}
                badge={<SettingsBadge tone="neutral">{binding.state === "enabled" ? copy.on : copy.off}</SettingsBadge>}
                description={[...Object.values(binding.roles).map(role => nameOf(role.configId)),
                  formatWorkbench(copy.runsOn, { computer: workbench.plugins.thisComputer })].join(" · ")}
                control={<SettingsButton variant="outline" onClick={() => setSetup("edit")}>{workbench.agentConfigs.edit}</SettingsButton>} />
            </div>
          </SettingsList>
        ) : <SettingsEmpty icon={<Workflow />} title={workbench.setup.newTitle} hint={hasBase ? copy.description : (
          <>
            <span className="block">{copy.needsBase}</span>
            <SettingsButton className="mt-3" disabled={creating} onClick={() => void createBase()} data-create-base="">{t("projectSettings.general.baseCreate")}</SettingsButton>
          </>
        )} />}
      </SettingsSection>
      <SettingsSection title={copy.configsTitle} description={copy.configsHint}>
        {projectConfigs.length ? <AgentConfigList configs={projectConfigs} projects={projects} workbench={workbench} onEdit={setEditing} />
          : <p className="text-muted-foreground text-xs">{workbench.agentConfigs.someProjectsDescription}</p>}
      </SettingsSection>
      {setup && (
        <Suspense fallback={null}>
          {WorkflowSetupHost && <WorkflowSetupHost projectId={project.id} editing={setup === "edit"} onClose={() => setSetup(null)} />}
        </Suspense>
      )}
      {editing?.payload && (
        <AgentConfigDialog open editing={{ configId: editing.configId, payload: editing.payload }} providers={providerOrder(settings)}
          projects={projects} workbench={workbench} onOpenChange={open => { if (!open) setEditing(null); }} onSave={save} />
      )}
    </SettingsCanvas>
  );
}
