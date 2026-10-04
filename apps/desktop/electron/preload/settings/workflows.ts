/**
 * [INPUT]: Depends on Electron IPC, the workflows channels and bridge contract (type only), and the top-frame subscription adapter.
 * [OUTPUT]: Installs `window.workflows` (WorkflowsBridge): turn a workflow on, bindings, runs, start, confirm, pause, resume, cancel, force stop, check result, rework, the Chat of a role, what needs the person, and a change subscription.
 * Exposes the defaults request on WorkflowsBridge.
 * [POS]: Workflow preload leaf for the main window; main parses every argument and fills in the operator of a confirmation.
 */
import { contextBridge, ipcRenderer } from "electron";
import { WORKFLOWS_CHANNEL, type WorkflowsBridge, type WorkflowsChangedEvent } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";

/* Each bridge method is one invoke on its channel (the arguments pass through; main parses them): generated, not spelled out. */
const METHODS = { enableWorkflow: "enable", bindings: "bindings", setBindingEnabled: "setBindingEnabled", runsForRecord: "runsForRecord", run: "run",
  start: "start", confirm: "confirm", pause: "pause", resume: "resume", cancel: "cancel", forceStop: "forceStop", checkResult: "checkResult",
  reworkDraft: "reworkDraft", startRework: "startRework", chatFor: "chatFor", needsYou: "needsYou", projectRunCount: "projectRunCount", retryStep: "retryStep", preflight: "preflight",
  defaults: "defaults", evidence: "evidence" } as const satisfies Record<Exclude<keyof WorkflowsBridge, "onChanged" | "onOpenConfirmation">, keyof typeof WORKFLOWS_CHANNEL>;

export function installWorkflowsBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  const changed = subscribe<WorkflowsChangedEvent>(WORKFLOWS_CHANNEL.changed);
  const bridge = Object.fromEntries(Object.entries(METHODS).map(([method, channel]) =>
    [method, (...args: unknown[]) => ipcRenderer.invoke(WORKFLOWS_CHANNEL[channel], ...args)])) as Omit<WorkflowsBridge, "onChanged" | "onOpenConfirmation">;
  const opens = subscribe<{ runId: string; stepId: string }>(WORKFLOWS_CHANNEL.openConfirmation);
  contextBridge.exposeInMainWorld("workflows", { ...bridge, onChanged: (listener) => changed((event) => listener(event)),
    onOpenConfirmation: (listener) => opens((target) => listener(target)) } satisfies WorkflowsBridge);
}
