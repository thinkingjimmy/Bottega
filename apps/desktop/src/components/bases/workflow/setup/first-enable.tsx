/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and live Base shape, production workflow defaults/enable bridges, Agent config names and shared dialogs.
 * [OUTPUT]: Provides FirstEnable: one confirmation with role defaults, Base changes and named recovery destinations.
 * [POS]: Desktop first-use surface shared by Base menus, row Run and Project settings; editing remains in setup-host.
 */
import { useEffect, useState } from "react";
import type { BaseSnapshot } from "@ai-chat/base-core/model/bases-ipc";
import { baseHasRoom, workflowBaseShape } from "@ai-chat/base-ui/ui/workflow/port";
import { PLAN_DEVELOP_REVIEW } from "@ai-chat/cloud-protocol/contracts/workflow/builtin";
import type { WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import type { WorkflowDefaults, WorkflowRolePreflight } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { agentConfigsBridge } from "@/lib/agent/agent-configs-client";
import { AgentBackendIcon, backendLabel } from "@/lib/agent/agent-backends";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";
import { builtinProviderCatalog, knownBackend } from "../../../../../shared/providers/catalog";
import { workflowsBridge } from "../bridge";
import { preflightReason } from "./refusals";

export function FirstEnable({ projectId, base, onEnabled, onClose }: {
  projectId: string; base: BaseSnapshot["meta"]; onEnabled?(binding: WorkflowBinding): Promise<void>; onClose(): void;
}) {
  const { t, i18n } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language), copy = workbench.setup;
  const shape = workflowBaseShape(base), room = baseHasRoom(shape);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const requestKey = JSON.stringify([projectId, shape.structureKey, room, revision]);
  const [result, setResult] = useState<{ key: string; defaults: WorkflowDefaults | null; names: Record<string, string>; failure: string | null } | null>(null);
  const [actionFailure, setActionFailure] = useState<{ key: string; reason: string } | null>(null);
  const current = result?.key === requestKey ? result : null;
  const loading = room && !current;
  const defaults = current?.defaults ?? null, names = current?.names ?? {};
  const failure = actionFailure?.key === requestKey ? actionFailure.reason : current?.failure ?? null;
  const bridge = workflowsBridge();
  useEffect(() => {
    let live = true;
    if (!room) return;
    void (async () => {
      if (!bridge) throw new Error("workflow-binding-not-found");
      const result = await bridge.defaults(projectId);
      const configs = await agentConfigsBridge()?.list() ?? [];
      if (live) setResult({ key: requestKey, defaults: result, names: Object.fromEntries(configs.map(config => [config.configId, config.payload?.name ?? ""])), failure: null });
    })().catch(cause => { if (live) setResult({ key: requestKey, defaults: null, names: {}, failure: errorMessage(cause) }); });
    return () => { live = false; };
  }, [bridge, projectId, requestKey, room]);
  const full = !room || failure === "base-column-limit";
  const recover = (problem?: Extract<WorkflowRolePreflight, { ready: false }>) => {
    onClose();
    if (full) location.hash = `#/bases/project/${encodeURIComponent(projectId)}`;
    else if (failure === "workflow-project-unavailable") location.hash = `#/projects/${encodeURIComponent(projectId)}/settings`;
    else if (failure === "workflow-plugin-disabled" || failure === "contract-missing" || problem?.refusal === "plugin-disabled" || problem?.refusal === "agent-config-provider-disabled") {
      requestSettingsSection({ section: "plugins", plugin: problem?.provider ?? "workflow" });
    } else if (problem?.refusal.startsWith("agent-config-") || problem?.refusal === "config-unavailable") requestSettingsSection({ section: "agent-configs" });
    else requestSettingsSection({ section: "providers", agent: problem?.provider ? knownBackend(builtinProviderCatalog, problem.provider) ?? undefined : undefined });
  };
  const enable = async () => {
    if (!defaults?.ready || !bridge || busy || !room) return;
    setBusy(true); setActionFailure(null);
    try {
      const labels = { plan: copy.stepPlan, develop: copy.stepDevelop, review: copy.stepReview, done: copy.stageDone };
      const binding = await bridge.enableWorkflow({ projectId,
        base: { ownerKey: `project:${projectId}`, ownerInstanceId: base.ownerInstanceId }, taskNameColumnId: base.columns[0]!.id,
        roles: defaults.roles, columnNames: { stage: copy.stageColumn, acceptanceCriteria: copy.acceptanceColumn, boardView: copy.boardView },
        stageLabels: PLAN_DEVELOP_REVIEW.stages.map(stage => ({ id: stage.id, label: labels[stage.id as keyof typeof labels] ?? stage.id })) });
      await onEnabled?.(binding);
      onClose();
    } catch (cause) { setActionFailure({ key: requestKey, reason: errorMessage(cause) }); }
    finally { setBusy(false); }
  };
  const missing = Math.max(1, shape.columnCount + shape.columnsNeeded - shape.columnLimit);
  const problems = defaults && !defaults.ready ? defaults.problems.filter((item): item is Extract<WorkflowRolePreflight, { ready: false }> => !item.ready) : [];
  const errorText = full ? formatWorkbench(missing === 1 ? copy.baseFull_one : copy.baseFull_other, { existing: shape.columnCount, limit: shape.columnLimit, count: missing })
    : failure === "workflow-project-unavailable" ? copy.projectUnavailable
    : failure === "workflow-plugin-disabled" ? workbench.run.startWorkflowOff
    : failure === "contract-missing" ? workbench.run.startWorkflowBlocked
    : failure ? copy.enableFailed : null;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AppDialogContent className="sm:max-w-lg" data-workflow-first-enable="" aria-busy={busy || loading}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{copy.enableTitle}</DialogTitle><DialogDescription>{copy.enableDescription}</DialogDescription></DialogHeader>
      <AppDialogBody className="mt-4 space-y-4">
        {loading && <p role="status" className="text-sm text-muted-foreground">{copy.checking}</p>}
        {defaults?.ready && <dl className="divide-y text-sm" data-workflow-default-provider={defaults.provider}>
          <div className="flex justify-between gap-3 py-3"><dt>{workbench.agentConfigs.provider}</dt><dd className="flex items-center gap-2"><AgentBackendIcon backend={defaults.provider} className="size-4" />{backendLabel(defaults.provider)}</dd></div>
          {(["plan", "develop", "review"] as const).map(role => <div key={role} className="flex justify-between gap-3 py-3">
            <dt>{{ plan: copy.stepPlan, develop: copy.stepDevelop, review: copy.stepReview }[role]}</dt>
            <dd className="min-w-0 text-right"><span className="break-words">{names[defaults.roles[role].configId]}</span>{role !== "develop" && <span className="ml-2 text-xs text-muted-foreground">{workbench.agentConfigs.workspaceReadOnly}</span>}</dd>
          </div>)}
        </dl>}
        {room && !full && <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm" data-workflow-base-preview="">
          <p>{shape.columnsNeeded ? formatWorkbench(shape.columnsNeeded === 1 ? copy.baseIntro_one : copy.baseIntro_other, { count: shape.columnsNeeded }) : copy.baseIntroEditing}</p>
          {shape.missing.map(column => <p key={column} className="text-muted-foreground">{column === "stage" ? copy.stageColumn : copy.acceptanceColumn}</p>)}
          {shape.board !== "none" && <p className="text-muted-foreground">{formatWorkbench(shape.board === "added" ? copy.baseBoardAdded : copy.baseBoardNoRoom, { view: copy.boardView, limit: shape.viewLimit })}</p>}
        </div>}
        {errorText && <div role="alert" className="space-y-2 text-sm" data-workflow-enable-error={full ? "base-column-limit" : failure}>
          <p>{errorText}</p><Button type="button" size="sm" variant="outline" onClick={() => recover()}>{full ? copy.openBase : failure === "workflow-project-unavailable" ? copy.openProject : copy.openSettings}</Button>
        </div>}
        {defaults && !defaults.ready && <div className="space-y-3" role="alert">
          <p className="text-sm font-medium">{copy.noReadyProvider}</p>
          {problems.map((problem, index) => <div key={index} className="space-y-2 rounded-lg border p-3 text-sm" data-workflow-refusal={problem.refusal}>
            <p>{preflightReason(problem, { config: workbench.agentConfigs.title, step: "", computer: workbench.plugins.thisComputer }, workbench, i18n.language)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => recover(problem)}>{copy.openSettings}</Button>
          </div>)}
          {!problems.length && <Button type="button" variant="outline" size="sm" onClick={() => recover()}>{copy.openSettings}</Button>}
        </div>}
      </AppDialogBody>
      <DialogFooter className="mt-5 gap-2">
        {!loading && (failure || defaults && !defaults.ready) && <Button type="button" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>{copy.checkAgain}</Button>}
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="button" disabled={loading || busy || full || !defaults?.ready} onClick={() => void enable()}>{onEnabled ? copy.enableAndRun : copy.enableTitle}</Button>
      </DialogFooter>
    </AppDialogContent>
  </Dialog>;
}
