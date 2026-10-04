/**
 * [INPUT]: Depends on the process-global renderer IPC registrar, the workflows bridge channels and contract schemas, and the composed workflow runtime.
 * [OUTPUT]: Provides registerWorkflows: the main window's `workflows:*` handlers behind window.workflows and the `changed` push; enableInputSchema, the strict turn-on request (renderer-supplied names are bounded and free of control and format characters). preflight takes the Project setup is for.
 * The defaults channel accepts one validated Project id; known refusal codes survive Electron error serialization.
 * [POS]: The workflow runtime's renderer boundary (W12); the runtime is composed off the startup path, so each call waits for it: only the main window's top frame may call it; every argument is parsed here, and a confirmation carries only the strict client input — the operator is filled in by main.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { baseRefSchema } from "@ai-chat/cloud-protocol/contracts/resources";
import { WORKFLOWS_CHANNEL, WORKFLOW_BRIDGE_ERRORS } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { WORKFLOW_ROLES } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { confirmInputSchema } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { rendererIpc } from "../../../registration/ipc-registrar";
import type { WorkflowRuntime } from "../composition";

const id = z.string().min(1).max(160);
const role = z.enum(WORKFLOW_ROLES);
const record = z.object({ base: baseRefSchema, rowId: id }).strict();
/* A name the renderer supplies for main to store as a column, view or option name: no control or format characters (no RTL override or
   zero-width spoofing); stored as given, never interpreted. */
const label = z.string().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]*$/u);
export const enableInputSchema = z.object({ projectId: id, base: baseRefSchema, taskNameColumnId: id,
  roles: z.object({ plan: z.object({ configId: id }).strict(), develop: z.object({ configId: id }).strict(), review: z.object({ configId: id }).strict() }).strict(),
  columnNames: z.object({ stage: label, acceptanceCriteria: label, boardView: label }).strict(),
  stageLabels: z.array(z.object({ id: z.string().min(1).max(32), label }).strict()).max(16) }).strict();

export function registerWorkflows(ready: Promise<WorkflowRuntime>, window: BrowserWindow, rendererUrl: string) {
  /* The runtime is composed off the startup path; a call that arrives first waits for it. */
  const when = <T>(run: (runtime: WorkflowRuntime) => T) => ready.then(run).catch((cause: unknown) => {
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
    if (typeof code === "string" && (WORKFLOW_BRIDGE_ERRORS as readonly string[]).includes(code)) throw new Error(code);
    throw cause;
  });
  rendererIpc(rendererUrl, "workflows are available to the main window only")
    .roles("main")
    .handle(WORKFLOWS_CHANNEL.defaults, (projectId) => when(runtime => runtime.defaults(id.parse(projectId))))
    .handle(WORKFLOWS_CHANNEL.enable, (input) => when(runtime => runtime.enableWorkflow(enableInputSchema.parse(input))))
    .handle(WORKFLOWS_CHANNEL.bindings, (projectId) => when(runtime => runtime.bindings(projectId === undefined ? undefined : id.parse(projectId))))
    .handle(WORKFLOWS_CHANNEL.setBindingEnabled, (bindingId, enabled) => when(runtime => runtime.setBindingEnabled(id.parse(bindingId), z.boolean().parse(enabled))))
    .handle(WORKFLOWS_CHANNEL.runsForRecord, (input) => when(runtime => runtime.runsForRecord(record.parse(input))))
    .handle(WORKFLOWS_CHANNEL.run, (runId) => when(runtime => runtime.run(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.start, (input) => when(runtime => runtime.start(z.object({ bindingId: id, rowId: id }).strict().parse(input))))
    .handle(WORKFLOWS_CHANNEL.confirm, (runId, stepId, input) => when(runtime => runtime.confirm(id.parse(runId), id.parse(stepId), confirmInputSchema.parse(input))))
    .handle(WORKFLOWS_CHANNEL.pause, (runId) => when(runtime => runtime.pause(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.resume, (runId) => when(runtime => runtime.resume(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.cancel, (runId) => when(runtime => runtime.cancel(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.forceStop, (runId) => when(runtime => runtime.forceStop(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.checkResult, (runId) => when(runtime => runtime.checkResult(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.reworkDraft, (runId) => when(runtime => runtime.reworkDraft(id.parse(runId))))
    .handle(WORKFLOWS_CHANNEL.startRework, (runId, choice) => when(runtime => runtime.startRework(id.parse(runId), z.enum(["keep-plan", "replan"]).parse(choice))))
    .handle(WORKFLOWS_CHANNEL.chatFor, (target, which) => when(runtime => runtime.chatFor(z.union([z.object({ runId: id }).strict(), z.object({ record }).strict()]).parse(target), role.parse(which))))
    .handle(WORKFLOWS_CHANNEL.needsYou, () => when(runtime => runtime.needsYou()))
    .handle(WORKFLOWS_CHANNEL.retryStep, (runId, stepId) => when(runtime => runtime.retryStep(id.parse(runId), id.parse(stepId))))
    .handle(WORKFLOWS_CHANNEL.evidence, (runId, stepId, kind, offset) => when(runtime => runtime.evidence(id.parse(runId), id.parse(stepId),
      z.enum(["diff", "report"]).parse(kind), z.number().int().min(0).max(65_535).parse(offset))))
    .handle(WORKFLOWS_CHANNEL.preflight, (roles, projectId) => when(runtime => runtime.preflight(z.object({ plan: id.optional(), develop: id.optional(), review: id.optional() }).strict().parse(roles),
      id.optional().parse(projectId))))
    .handle(WORKFLOWS_CHANNEL.projectRunCount, (projectId) => when(runtime => runtime.projectRunCount(id.parse(projectId))));
  void ready.then(value => {
    const release = value.onChanged((event) => { if (!window.isDestroyed()) window.webContents.send(WORKFLOWS_CHANNEL.changed, event); });
    /* A clicked reminder brings the window forward and shows the confirmation; it decides nothing. */
    const releaseOpen = value.onOpenConfirmation((target) => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
      window.webContents.send(WORKFLOWS_CHANNEL.openConfirmation, target);
    });
    window.once("closed", () => { release(); releaseOpen(); });
  }).catch(() => undefined);
}
