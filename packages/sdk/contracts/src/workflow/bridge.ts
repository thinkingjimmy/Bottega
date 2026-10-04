/**
 * [INPUT]: Depends on Base references, workflow bindings, roles, run and confirmation contracts.
 * [OUTPUT]: Provides WorkflowsBridge and channel names, including defaults; typed setup/admission/resource refusals and ConfigApplySetting reports.
 * [POS]: Shared desktop IPC contract for workflow setup, execution, interventions and subscriptions.
 * Preflight distinguishes missing identity from unmeasured capabilities.
 */
import type { BaseRef } from "../model/resources";
import type { WorkflowBinding } from "./binding";
import type { WorkflowRoleName } from "./recipe";
import type { ReworkDraft } from "./rework";
import type { BLOCKED_REASON_KINDS, ConfirmInput, PROVIDER_AUTH_UNCERTAIN, REQUESTED_GUARANTEES, WorkflowRun } from "./run";

export const WORKFLOWS_CHANNEL = Object.freeze({
  enable: "workflows:enable", bindings: "workflows:bindings", setBindingEnabled: "workflows:set-binding-enabled",
  runsForRecord: "workflows:runs-for-record", run: "workflows:run", start: "workflows:start", confirm: "workflows:confirm",
  pause: "workflows:pause", resume: "workflows:resume", cancel: "workflows:cancel", forceStop: "workflows:force-stop", checkResult: "workflows:check-result",
  reworkDraft: "workflows:rework-draft", startRework: "workflows:start-rework", chatFor: "workflows:chat-for", needsYou: "workflows:needs-you",
  projectRunCount: "workflows:project-run-count", retryStep: "workflows:retry-step", preflight: "workflows:preflight",
  defaults: "workflows:defaults",
  evidence: "workflows:evidence",
  changed: "workflows:changed", openConfirmation: "workflows:open-confirmation",
} as const);

/** Stable codes a refused call carries as its Error message. */
export const WORKFLOW_BRIDGE_ERRORS = ["workflow-binding-not-found", "workflow-binding-not-enabled", "workflow-plugin-disabled", "contract-missing", "workflow-config-refused",
  "workflow-role-not-admitted", "workflow-run-not-found", "workflow-rework-not-requested", "workflow-rework-started", "workflow-rework-choice-unavailable",
  "stale-proposal", "already-resolved", "decision-not-allowed", "run-terminal", "not-paused", "not-running", "not-blocked", "workflow-project-archived",
  "workflow-project-unavailable", "base-column-limit", "workflow-evidence-unavailable"] as const;

/** A bounded page of evidence owned by a run; bytes are base64url to keep JSON inside the 8 KiB result budget. */
export type WorkflowEvidencePage = { kind: "diff" | "report"; offset: number; nextOffset: number | null; totalBytes: number;
  chunk: string; digest: string; truncated: boolean };

export type WorkflowRecordRef = Readonly<{ base: BaseRef; rowId: string }>;
/** Turning the workflow on for a Base: its two columns are added once (named in the interface language), then the binding is saved and enabled. */
export type EnableWorkflowInput = Readonly<{ projectId: string; base: BaseRef; taskNameColumnId: string;
  roles: Readonly<Record<WorkflowRoleName, { configId: string }>>; columnNames: Readonly<{ stage: string; acceptanceCriteria: string; boardView: string }>;
  stageLabels: readonly Readonly<{ id: string; label: string }>[] }>;
/**
 * Something waiting for the person, across Projects: the desktop list and the phone's bell read the same items.
 * `agent-waiting`: the Agent of a running step asked for a permission or an answer in its workflow Chat, which no Chat list
 * shows; `role` names that Chat (open it with chatFor).
 */
export type NeedsYouItem = Readonly<{ runId: string; bindingId: string; projectId: string; record: WorkflowRecordRef; recordTitle: string | null;
  kind: "confirm-plan" | "confirm-result" | "paused" | "result-unknown" | "agent-waiting"; role?: WorkflowRoleName; since: number }>;
export type WorkflowsChangedEvent = Readonly<{ runId?: string; bindingId?: string }>;
/** Why a role's configuration cannot run its step on this computer now: a freeze refusal, or an admission kind. */
/** Why an Agent configuration cannot be frozen into a run (the agent-config payload decides; the contract names the reasons).
    `agent-config-memory-write-unsupported`: workflow Memory requests may only read, never capture.
    `agent-config-scope-unsupported`: implicit resource scope or unsupported individual tool selection. */
export type FreezeRefusal = "agent-config-deleted" | "agent-config-not-enabled" | "agent-config-provider-mismatch" | "agent-config-provider-disabled"
  | "agent-config-memory-write-unsupported" | "agent-config-selection-unsupported" | "agent-config-scope-unsupported" | "agent-config-skill-unavailable" | "agent-config-mcp-unavailable" | "agent-config-mcp-read-only";
/** A configuration setting that can fail to take effect on a computer; the interface names it with its field label. */
export type ConfigApplySetting = "permissions" | "skills" | "tools" | "instructions" | "model";
/** `agent-config-partially-applied`: some of the configuration's own settings would not take effect on this computer. */
export type WorkflowPreflightRefusal = FreezeRefusal | "agent-config-partially-applied" | Extract<(typeof BLOCKED_REASON_KINDS)[number], "provider-signed-out" | "provider-not-installed" | "provider-measurements-unavailable"
  | "provider-version-too-old" | "plugin-disabled" | "not-measured" | "provider-cannot" | "config-unavailable" | "guarantee-unavailable" | (typeof PROVIDER_AUTH_UNCERTAIN)[number]>;
/** One role's answer, from exactly what a run would do (freeze the latest revision, readiness, role admission). A partial apply names its settings. */
export type WorkflowRolePreflight = Readonly<{ ready: true }> | Readonly<{ ready: false; refusal: WorkflowPreflightRefusal; provider: string | null;
  guarantee: (typeof REQUESTED_GUARANTEES)[number] | null; settings?: readonly ConfigApplySetting[] }>;
export type WorkflowDefaults = { ready: true; provider: string; roles: EnableWorkflowInput["roles"] }
  | { ready: false; problems: WorkflowRolePreflight[] };

export interface WorkflowsBridge {
  defaults(projectId: string): Promise<WorkflowDefaults>;
  enableWorkflow(input: EnableWorkflowInput): Promise<WorkflowBinding>;
  bindings(projectId?: string): Promise<WorkflowBinding[]>;
  setBindingEnabled(bindingId: string, enabled: boolean): Promise<WorkflowBinding>;
  /** Newest first; at most one of them is active. */
  runsForRecord(record: WorkflowRecordRef): Promise<WorkflowRun[]>;
  run(runId: string): Promise<WorkflowRun | null>;
  /** A second start on a record with an active run answers that run with `started: false`. */
  start(input: { bindingId: string; rowId: string }): Promise<{ started: boolean; run: WorkflowRun }>;
  /** The operator, device and time are filled in by the host from the verified session; the input names none of them. */
  confirm(runId: string, stepId: string, input: ConfirmInput): Promise<WorkflowRun>;
  pause(runId: string): Promise<WorkflowRun>;
  resume(runId: string): Promise<WorkflowRun>;
  cancel(runId: string): Promise<WorkflowRun>;
  /** Only while cancelling; the run ends cancelled with `forcedStop` and the workspace should be checked. */
  /**
   * Kills the running step's whole process tree first; the run ends cancelled with `forcedStop` only once the tree is confirmed
   * gone, otherwise it stays cancelling with `forceStopUnconfirmedAt` (a process may still be running; Force stop again).
   */
  forceStop(runId: string): Promise<WorkflowRun>;
  /** A step whose outcome is unknown is checked against its Chat and turn first, never re-sent. */
  checkResult(runId: string): Promise<WorkflowRun>;
  /** From a fresh read of the record; null unless the run ended with a rework request. */
  reworkDraft(runId: string): Promise<ReworkDraft | null>;
  startRework(runId: string, choice: "keep-plan" | "replan"): Promise<WorkflowRun>;
  /** The persistent Chat of one role for a record (one per record × role, reused by rework runs). */
  chatFor(target: Readonly<{ runId: string }> | Readonly<{ record: WorkflowRecordRef }>, role: WorkflowRoleName): Promise<{ chatId: string } | null>;
  needsYou(): Promise<NeedsYouItem[]>;
  /** How many runs a Project's workflows have made: the Project archive/delete/detach dialogs name the workflow Chats they take along. */
  projectRunCount(projectId: string): Promise<number>;
  /**
   * "Retry this step" (by hand only) on the blocked step named by `run.blockedReason`: admission runs again first; a new attempt
   * begins only once the cause is fixed, otherwise the run comes back still blocked with its reason as it is now (`not-blocked` if it isn't).
   */
  retryStep(runId: string, stepId: string): Promise<WorkflowRun>;
  evidence(runId: string, stepId: string, kind: "diff" | "report", offset: number): Promise<WorkflowEvidencePage>;
  /**
   * Before a workflow is turned on: per role, whether its configuration can run here now, by the same freeze, readiness
   * and role admission a run uses (admission may probe measurements on demand). Only a role answered `ready` should be offered as ready.
   */
  /** `projectId`: the Project setup is for; its workspace decides what the Provider there offers (a Project's own model config). */
  preflight(roles: Readonly<Partial<Record<WorkflowRoleName, string>>>, projectId?: string): Promise<Partial<Record<WorkflowRoleName, WorkflowRolePreflight>>>;
  onChanged(listener: (event: WorkflowsChangedEvent) => void): () => void;
  /** A confirmation reminder was clicked: show that confirmation in its run's details. Opening it decides nothing. */
  onOpenConfirmation(listener: (target: Readonly<{ runId: string; stepId: string }>) => void): () => void;
}
