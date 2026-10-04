/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and the Base snapshot provider, the workflow bridge (`window.workflows`) and the Project's binding, the
 *          shared run tag / details surfaces, the lazy setup host, the shared toast and workbench-copy.
 * [OUTPUT]: Provides WorkflowRunsHost (default export, loaded lazily) — for one Project Base: a Run tag per record with a run
 *           and the run details it opens, the ▶ chooser (start the Project's workflow, or set one up in place) and the record's
 *           Workflow block; a step whose Agent waits in its hidden Chat reads Needs you, with Open Chat in the details; a blocked
 *           step's next step opens the Provider's settings, Plugins & Apps or the setup's Who does what, and Retry this step;
 *           a clicked confirmation reminder for one of its runs opens that run's details; a run waiting for the workspace (A-07)
 *           names the task of the run holding it and opens that run.
 * First enablement keeps the clicked row and starts it immediately after confirmation.
 * Disabled Workflow choices expose their reason and Plugins & Apps action; built-in recipe names are localized by id.
 * [POS]: The desktop host of U04/U05 behind the workbench flag; it never wraps the workbench (it reports its surface through onSurface), so its lazy arrival cannot remount the workbench (T16). Runs are read per record (runsForRecord) and re-read on
 *        change; the next snapshot is the truth, the surfaces never edit a run. A refused start says why in a toast.
 */
import { workflowRecipeName } from "@ai-chat/ui/lib/workbench-copy";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PLAN_DEVELOP_REVIEW } from "@ai-chat/cloud-protocol/contracts/workflow/builtin";
import { stepChain } from "@ai-chat/base-ui/ui/workflow/run-chooser";
import type { WorkflowsBridge } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import type { WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { baseCellText, cellValue, createBaseCellContext } from "@ai-chat/base-core/model/bases-ipc";
import { RunDetailsSheet, RunStatusBadge } from "@ai-chat/base-ui/ui/workflow/run-details";
import type { WorkflowRunPort } from "@ai-chat/base-ui/ui/workflow/run-port";
import type { WorkflowRoleName } from "@ai-chat/base-ui/ui/workflow/port";
import type { WorkflowRunsSurface } from "@ai-chat/base-ui/ui/workflow/runs-context";
import { RecordWorkflowSection } from "@ai-chat/base-ui/ui/workflow/record-section";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { backendLabel } from "@/lib/agent/agent-backends";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useBaseSnapshots } from "@/components/providers/content/bases-provider";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useChatDevices } from "@/lib/cloud/chat/access/devices";
import { pendingRunToOpen, useProjectBinding, workflowsBridge } from "./bridge";
import { useTurnedOffPlugins } from "@/components/settings/plugins/turned-off";
import { WorkflowSetupHost } from "./entry";

/** A refused start, by its code: Electron wraps IPC errors ("Error invoking remote method …: Error: <code>"), so the code is read
 *  through errorMessage, never by comparing the raw message. */
export const startRefusal = (error: unknown, copy: { startWorkflowOff: string; startWorkflowBlocked: string; startFailed: string }) =>
  errorMessage(error) === "workflow-plugin-disabled" ? copy.startWorkflowOff : errorMessage(error) === "contract-missing" ? copy.startWorkflowBlocked : copy.startFailed;

/** The holding run may still have a writer (A-07): it is cancelling (confirmed or not), or a step is blocked on an unknown
 *  outcome whose cleanup failed or was cut by a restart. Force stop or Check result on that run frees the workspace. */
const mayStillWrite = (run: WorkflowRun) => run.state === "cancelling" || run.steps.some(step => {
  const last = step.attempts.at(-1);
  return step.state === "blocked" && last?.outcome === "unknown" && (last.detail === "cleanup-failed" || last.detail === "interrupted");
});

/** `onRun` opens the run an action produced: a rework is a new run, and the details follow it there. */
function portOf(bridge: WorkflowsBridge, onRun: (runId: string) => void, onChooseConfig: () => void): WorkflowRunPort {
  return {
    confirm: async (runId, stepId, input) => { await bridge.confirm(runId, stepId, input); },
    pause: async runId => { await bridge.pause(runId); },
    resume: async runId => { await bridge.resume(runId); },
    cancel: async runId => { await bridge.cancel(runId); },
    forceStop: async runId => { await bridge.forceStop(runId); },
    checkResult: async runId => { await bridge.checkResult(runId); },
    reworkDraft: runId => bridge.reworkDraft(runId),
    startRework: async (runId, choice) => { onRun((await bridge.startRework(runId, choice)).runId); },
    retryStep: (runId, stepId) => bridge.retryStep(runId, stepId),
    evidence: (runId, stepId, kind, offset) => bridge.evidence(runId, stepId, kind, offset),
    openAgentSetup: provider => requestSettingsSection({ section: "providers", agent: provider as AgentBackendId }),
    openPlugins: pluginId => requestSettingsSection({ section: "plugins", plugin: pluginId }),
    chooseConfig: onChooseConfig,
    openRun: onRun,
    openChat: (runId, role) => void bridge.chatFor({ runId }, role).then(chat => { if (chat) location.hash = `#/chat/${chat.chatId}`; }),
  };
}

/* The host never wraps the workbench: it arrives lazily, and wrapping would mount the workbench a second time when it
   does, dropping whatever the person did meanwhile (T16). It hands its surface up and renders only its own sheets. */
export default function WorkflowRunsHost({ ownerKey, onSurface }: { ownerKey: string; onSurface(surface: WorkflowRunsSurface | null): void }) {
  const bridge = workflowsBridge();
  return bridge ? <RunsHost bridge={bridge} ownerKey={ownerKey} onSurface={onSurface} /> : null;
}

function RunsHost({ bridge, ownerKey, onSurface }: { bridge: WorkflowsBridge; ownerKey: string; onSurface(surface: WorkflowRunsSurface | null): void }) {
  const { i18n } = useAppTranslation();
  const workbench = useWorkbenchCopy(i18n.language);
  const snapshot = useBaseSnapshots().snapshots[ownerKey];
  const projectId = ownerKey.startsWith("project:") ? ownerKey.slice("project:".length) : null;
  const binding = useProjectBinding(projectId);
  const disabled = useTurnedOffPlugins().has("workflow");
  const port = useMemo(() => portOf(bridge, runId => setOpenRunId(runId), () => setSettingUp({ kind: "who" })), [bridge]);
  const [latest, setLatest] = useState<ReadonlyMap<string, { run: WorkflowRun; count: number }>>(new Map());
  /* runId → the role whose Agent waits on a permission or a question in its Chat (`agent-waiting`). */
  const [waiting, setWaiting] = useState<ReadonlyMap<string, WorkflowRoleName>>(new Map());
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  /* A-07: the task of each run another run of this Base waits for (it writes the same workspace). */
  const [holders, setHolders] = useState<ReadonlyMap<string, { title: string; stuck: boolean }>>(new Map());
  /* "new" from ▶ without a workflow; "who" when a blocked step asks for another config (Edit on Who does what). */
  const [settingUp, setSettingUp] = useState<{ kind: "new" | "who"; rowId?: string } | null>(null);
  const rowIds = snapshot?.rows.map(row => row.id).join(",") ?? "";
  /* A clicked reminder for a run of this Base opens its details (navigation only). */
  useEffect(() => {
    const take = () => {
      const runId = pendingRunToOpen.peek();
      if (runId) void bridge.run(runId).then(run => { if (run?.record.base.ownerKey === ownerKey && pendingRunToOpen.take() === runId) setOpenRunId(runId); }, () => undefined);
    };
    take();
    return pendingRunToOpen.subscribe(take);
  }, [bridge, ownerKey]);
  useEffect(() => {
    if (!snapshot) return;
    let live = true;
    const base = { ownerKey: ownerKey as `project:${string}`, ownerInstanceId: snapshot.meta.ownerInstanceId };
    const load = () => {
      void Promise.all(snapshot.rows.map(async row => [row.id, await bridge.runsForRecord({ base, rowId: row.id })] as const)).then(entries => {
        if (live) setLatest(new Map(entries.flatMap(([rowId, list]) => list.length ? [[rowId, { run: list[0]!, count: list.length }] as const] : [])));
      }, () => undefined);
      void bridge.needsYou().then(items => {
        if (live) setWaiting(new Map(items.flatMap(item => item.kind === "agent-waiting" && item.role && item.record.base.ownerKey === ownerKey ? [[item.runId, item.role] as const] : [])));
      }, () => undefined);
    };
    load();
    const stop = bridge.onChanged(load);
    return () => { live = false; stop(); };
  }, [bridge, ownerKey, rowIds, snapshot?.meta.ownerInstanceId]);
  const titleOfRow = (rowId: string) => {
    const row = snapshot?.rows.find(item => item.id === rowId);
    return row && snapshot ? baseCellText(snapshot.meta.columns[0]!, cellValue(row, snapshot.meta.columns[0]!, createBaseCellContext({ columns: snapshot.meta.columns, rows: snapshot.rows }))) : null;
  };
  const heldBy = [...latest.values()].flatMap(entry => entry.run.workspaceWait ? [entry.run.workspaceWait.heldByRunId] : []).join(",");
  useEffect(() => {
    let live = true;
    void Promise.all((heldBy ? heldBy.split(",") : []).map(async runId => [runId, await bridge.run(runId)] as const)).then(entries => {
      if (!live) return;
      setHolders(new Map(entries.flatMap(([runId, held]) => {
        const title = held ? titleOfRow(held.record.rowId) : null;
        return title && held ? [[runId, { title, stuck: mayStillWrite(held) }] as const] : [];
      })));
    }, () => undefined);
    return () => { live = false; };
  }, [bridge, heldBy, snapshot]);
  const open = openRunId ? [...latest.values()].find(entry => entry.run.runId === openRunId) ?? null : null;
  const active = (rowId: string) => { const run = latest.get(rowId)?.run; return run && !["succeeded", "failed", "cancelled"].includes(run.state) ? run : null; };
  /* Start (or, with an active run, open it): one active run per record (06 §8). Needs the Project's workflow turned on. */
  const startFor = async (rowId: string, bindingId = binding?.bindingId) => {
    if (!bindingId || disabled) return;
    try {
      const { run } = await bridge.start({ bindingId, rowId });
      setOpenRunId(run.runId);
    } catch (error) {
      toast.error(startRefusal(error, workbench.run));
    }
  };
  const surface = useMemo(() => ({
    tag: (rowId: string) => {
      const entry = latest.get(rowId);
      return entry ? <RunStatusBadge run={entry.run} forced={entry.run.forcedStop} agentWaiting={waiting.has(entry.run.runId)} onOpen={() => setOpenRunId(entry.run.runId)} /> : null;
    },
    chooser: (rowId: string) => {
      if (disabled) return { choices: [], start: () => undefined, unavailable: workbench.run.startWorkflowOff,
        openPlugins: () => requestSettingsSection({ section: "plugins", plugin: "workflow" }) };
      const chain = stepChain(PLAN_DEVELOP_REVIEW, workbench.setup);
      return { choices: binding ? [{ id: binding.bindingId, name: workflowRecipeName(PLAN_DEVELOP_REVIEW, workbench.setup), chain }] : [],
        start: () => void startFor(rowId), setUp: () => setSettingUp({ kind: "new", rowId }) };
    },
    recordSection: (rowId: string) => {
      if (!binding || !snapshot) return null;
      const entry = latest.get(rowId);
      const record = { base: { ownerKey: ownerKey as `project:${string}`, ownerInstanceId: snapshot.meta.ownerInstanceId }, rowId };
      const wait = entry?.run.workspaceWait ?? null;
      return <RecordWorkflowSection run={entry?.run ?? null} onOpenRun={entry ? () => setOpenRunId(entry.run.runId) : undefined}
        waitingFor={wait ? holders.get(wait.heldByRunId)?.title ?? null : null} waitingForStuck={wait ? holders.get(wait.heldByRunId)?.stuck ?? false : false}
        onOpenHoldingRun={wait ? () => setOpenRunId(wait.heldByRunId) : undefined}
        onRun={disabled || active(rowId) ? undefined : () => void startFor(rowId)}
        onOpenChat={role => void bridge.chatFor({ record }, role).then(chat => { if (chat) location.hash = `#/chat/${chat.chatId}`; })} />;
    },
  }), [latest, waiting, holders, binding, disabled, snapshot, ownerKey, bridge, workbench]);
  const row = open && snapshot?.rows.find(item => item.id === open.run.record.rowId);
  // T21-b: another signed-in device's name for "Already handled on …"; this computer and unknown devices stay unnamed.
  const { devices } = useChatDevices();
  const title = row && snapshot ? baseCellText(snapshot.meta.columns[0]!, cellValue(row, snapshot.meta.columns[0]!, createBaseCellContext({ columns: snapshot.meta.columns, rows: snapshot.rows }))) : "";
  useEffect(() => { onSurface(surface); }, [onSurface, surface]);
  useEffect(() => () => onSurface(null), [onSurface]);
  return (
    <>
      {open && <RunDetailsSheet run={open.run} port={port} agentWaiting={waiting.get(open.run.runId) ?? null}
        recordVersion={row ? JSON.stringify(row.values) : ""} onOpenChange={next => { if (!next) setOpenRunId(null); }}
        facts={{ runLabel: formatWorkbench(workbench.run.label, { number: open.count }), taskTitle: title, computer: workbench.plugins.thisComputer, activeProvider: null, providerLabel: backendLabel,
          waitingFor: open.run.workspaceWait ? holders.get(open.run.workspaceWait.heldByRunId)?.title ?? null : null,
          waitingForStuck: open.run.workspaceWait ? holders.get(open.run.workspaceWait.heldByRunId)?.stuck ?? false : false,
          deviceName: id => devices?.find(device => device.deviceId === id && !device.current)?.name ?? null }} />}
      {settingUp && projectId && <Suspense fallback={null}>
        {WorkflowSetupHost && <WorkflowSetupHost projectId={projectId} editing={settingUp.kind === "who"} initialStage={settingUp.kind === "who" ? "who" : undefined} onEnabled={settingUp.rowId ? enabled => startFor(settingUp.rowId!, enabled.bindingId) : undefined} onClose={() => setSettingUp(null)} />}
      </Suspense>}
    </>
  );
}
