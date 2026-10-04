/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and the built-in recipe contract, the workflow bridge and the Project's binding, the Base snapshot provider,
 *          the main window's Agent-configuration bridge, the guarantee reading and workbench-copy.
 * [OUTPUT]: Provides WorkflowSetupHost: first enablement uses one confirmation; existing bindings use the shared editing dialog for one
 * Preflight names outdated Providers and unavailable Skill/MCP selections.
 *           Project's Base, opening as Edit when the Project has a binding. E2-04: sign-in-not-confirmed refusals say which (unknown, checking, error, timeout), never "signed out". preflightReason names a partial apply's settings with the Agent configs list's settingsList (field labels, Intl.ListFormat in the interface language), or says so generically (T21-c).
 * Projects the named missing-measurements refusal into the five-language catalog.
 * [POS]: Candidates are real (configs offered in the Project; role admission applies mandatory read-only scope) and
 *        each is asked the runtime's preflight, so one that cannot run is greyed with why. The check is that same preflight for
 *        the chosen roles (E-03): each role reads ready or why not, and Turn on / Save wait for all of them.
 *        Turn on and Save call the runtime's enableWorkflow, which adds the two columns once, saves the binding and enables
 *        it. The binding id is the runtime's, never made here.
 */
import { useEffect, useMemo } from "react";
import { PLAN_DEVELOP_REVIEW } from "@ai-chat/cloud-protocol/contracts/workflow/builtin";
import type { WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import type { WorkflowsBridge } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import type { WorkflowRoleName } from "@ai-chat/base-ui/ui/workflow/port";
import { workflowBaseShape, type WorkflowSetupInput, type WorkflowSetupPort } from "@ai-chat/base-ui/ui/workflow/port";
import type { BaseSnapshot } from "@ai-chat/base-core/model/bases-ipc";
import { WorkflowSetupDialog, type WorkflowSetupStage } from "@ai-chat/base-ui/ui/workflow/setup-dialog";
import { formatWorkbench, useWorkbenchCopy, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useBaseSnapshots } from "@/components/providers/content/bases-provider";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { agentConfigsBridge } from "@/lib/agent/agent-configs-client";
import { FirstEnable } from "./setup/first-enable";
import { preflightReason } from "./setup/refusals";
export { preflightReason } from "./setup/refusals";
import { backendLabel } from "@/lib/agent/agent-backends";
import { useProjectBinding, workflowsBridge } from "./bridge";

function createDesktopWorkflowSetupPort({ projectId, base, workbench, locale }: { projectId: string; base: BaseSnapshot["meta"]; workbench: WorkbenchCopy; locale: string }): WorkflowSetupPort {
  const ownerKey = `project:${projectId}` as const;
  const configs = agentConfigsBridge(), setup = workbench.setup;
  const offered = async () => (configs ? await configs.offeredIn(projectId) : []).filter(view => !view.deleted && view.payload);
  const stageLabel = { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview, done: setup.stageDone } as Record<string, string>;
  const roleLabel = { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview };
  const computer = workbench.plugins.thisComputer;
  const preflight = async (roles: Parameters<WorkflowsBridge["preflight"]>[0]) => {
    const bridge = workflowsBridge();
    return bridge ? await bridge.preflight(roles, projectId) : {};
  };
  return {
    recipes: async () => [PLAN_DEVELOP_REVIEW],
    candidates: async role => Promise.all((await offered()).map(async view => {
      const quick = view.unavailable === "provider-disabled"
        ? formatWorkbench(workbench.agentConfigs.providerTurnedOff, { provider: backendLabel(view.payload!.provider) })
        : null;
      // A config that passes the quick reading is asked what a run would do; one that cannot run is greyed with why.
      const answer = quick === null ? (await preflight({ [role]: view.configId }))[role] : undefined;
      const reason = quick ?? (answer ? preflightReason(answer, { step: roleLabel[role], config: view.payload!.name, computer }, workbench, locale) : null);
      return { configId: view.configId, name: view.payload!.name, provider: view.payload!.provider, available: reason === null, reason };
    })),
    check: async input => {
      const views = await offered();
      const answers = await preflight(Object.fromEntries(Object.entries(input.roles).map(([role, value]) => [role, value.configId])));
      const items = (Object.keys(input.roles) as WorkflowRoleName[]).map(role => {
        const view = views.find(item => item.configId === input.roles[role].configId);
        const answer = answers[role] ?? { ready: false as const, refusal: "config-unavailable" as const, provider: null, guarantee: null };
        const values = { step: roleLabel[role], config: view?.payload?.name ?? "", computer };
        const why = preflightReason(answer, values, workbench, locale);
        return why === null
          ? { label: formatWorkbench(setup.roleReady, { ...values, provider: backendLabel(view?.payload?.provider ?? "") }), ok: true }
          : { label: formatWorkbench(setup.roleProblem, { step: roleLabel[role], reason: why }), ok: false };
      });
      return { computer, online: true, items };
    },
    save: async input => {
      const bridge = workflowsBridge(), task = base.columns[0];
      if (!bridge || !task) throw new Error("workflow-binding-not-found");
      await bridge.enableWorkflow({ projectId, base: { ownerKey, ownerInstanceId: base.ownerInstanceId },
        taskNameColumnId: task.id, roles: input.roles, columnNames: input.columnNames,
        stageLabels: PLAN_DEVELOP_REVIEW.stages.map(stage => ({ id: stage.id, label: stageLabel[stage.id] ?? stage.id })) });
    },
  };
}

/** The dialog edits what the runtime stored; the two columns keep the names they have in the Base now. */
function editingInput(binding: WorkflowBinding, base: BaseSnapshot["meta"], setup: WorkbenchCopy["setup"]): WorkflowSetupInput {
  const nameOf = (id: string, fallback: string) => base.columns.find(column => column.id === id)?.name ?? fallback;
  return { bindingId: binding.bindingId, recipe: binding.recipe, roles: binding.roles,
    columnNames: { stage: nameOf(binding.base.stageColumnId, setup.stageColumn), acceptanceCriteria: nameOf(binding.base.acceptanceCriteriaColumnId, setup.acceptanceColumn),
      boardView: setup.boardView } };
}

export default function WorkflowSetupHost({ projectId, editing = true, initialStage, onEnabled, onClose }: {
  projectId: string; /** false opens New even when a binding exists (Add workflow). */ editing?: boolean;
  /** The tab Edit opens on. */ initialStage?: WorkflowSetupStage; onEnabled?(binding: WorkflowBinding): Promise<void>; onClose(): void;
}) {
  const { i18n } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language);
  const ownerKey = `project:${projectId}`;
  const { snapshots, get } = useBaseSnapshots();
  const base = snapshots[ownerKey]?.meta;
  const binding = useProjectBinding(projectId);
  // Project settings can open this before the Base was ever shown; a Project without a Base has nothing to turn on.
  useEffect(() => { if (!base) void get(ownerKey).then(snapshot => { if (!snapshot) onClose(); }, onClose); }, [base, get, ownerKey]);
  const port = useMemo(() => base && createDesktopWorkflowSetupPort({ projectId, base, workbench, locale: i18n.language }), [projectId, base, workbench, i18n.language]);
  if (!base || !port || binding === undefined) return null;
  if (!editing || !binding) return <FirstEnable projectId={projectId} base={base} onEnabled={onEnabled} onClose={onClose} />;
  return <WorkflowSetupDialog port={port} editing={editing && binding ? editingInput(binding, base, workbench.setup) : undefined}
    baseShape={workflowBaseShape(base)} initialStage={initialStage} onOpenChange={open => { if (!open) onClose(); }} />;
}
