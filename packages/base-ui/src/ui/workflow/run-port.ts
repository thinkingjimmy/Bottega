/**
 * [INPUT]: Depends on ./port for the recipe view and role names.
 * [OUTPUT]: Provides pendingConfirmation (the one live-confirmation check) and pauseText, WorkflowRunView (the part of a `WorkflowRun` the interface reads; the cloud-protocol run satisfies it
 * BlockedKind and extractor reasons include provider-version-too-old.
 *           structurally), RunHostFacts (what only the host knows: computer, when cancelling began, a forced stop),
 *           WorkflowRunPort (every action a person takes on a run, and the host places a blocked step's next step opens),
 *           failureText (a refusal's line by its code, remote ones included; a not-admitted role named through notAdmittedText and
 *           nextAgentRole), causeText (a binding cause's line),
 *           BlockedReasonView, and the pure readers the run surfaces share: pendingConfirmation, resultUnknown, stepReport,
 *           stepReportDerived, roleOfStep, blockedStep and projectArchived, and lastDecision (who decided a confirmation, T21-b). AuthUnconfirmedKind / isAuthUnconfirmed (E2-04).
 * Includes provider-measurements-unavailable as a named role-admission block.
 * [POS]: The run half of ui/workflow's host boundary (06 §6–§8, U04/U05). Surfaces never mutate a run: they ask the port,
 *        and the next snapshot is the truth.
 */
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { WorkflowRecipeView, WorkflowRoleName } from "./port";
import type { WorkflowEvidencePage } from "@bottega/contracts/workflow/bridge";

/** The attempt detail when a restart, not the stop itself, confirmed a forced stop's processes gone. */
export const FORCE_STOP_CONFIRMED_AT_STARTUP = "force-stopped-confirmed-at-startup";

export type RunStateName = "queued" | "running" | "waiting-human" | "paused" | "blocked" | "cancelling" | "succeeded" | "failed" | "cancelled";
export type StepStateName = "pending" | "running" | "waiting-human" | "succeeded" | "failed" | "blocked" | "carried" | "not-run";
/** `shortened`: the phone / Web projection cut the result (4 KiB); the whole text is in the step's role Chat (`chatRef`). */
export type EvidenceSummary = { commit: string | null; changedCount: number; diffState: string | null; commandsRecorded: number | null };
export type StepReportView = { result: string; artifactRef?: string; evidenceRefs?: readonly string[]; shortened?: boolean; chatRef?: string; evidence?: EvidenceSummary };
/** Why a step (or, for a suspended binding, the run) is held; each kind has one next step (06 §8). */
export type BlockedKind = "provider-signed-out" | "provider-not-installed" | "provider-measurements-unavailable" | "provider-version-too-old" | "plugin-disabled" | "not-measured" | "provider-cannot" | "config-unavailable"
  | "binding-suspended" | "no-valid-report" | "dispatch-failed" | "base-action-failed" | "attempts-exhausted" | "guarantee-unavailable" | AuthUnconfirmedKind;
/** E2-04: the Provider's sign-in is not confirmed — no answer, still checking, the check failed, or it did not answer in time. Not "signed out". */
export type AuthUnconfirmedKind = "provider-auth-unknown" | "provider-auth-checking" | "provider-auth-error" | "provider-auth-timeout";
export const isAuthUnconfirmed = (kind: string | null | undefined): kind is AuthUnconfirmedKind => typeof kind === "string" && kind.startsWith("provider-auth-");
export type BindingCause = "instance-changed" | "task-name-missing" | "stage-missing" | "acceptance-criteria-missing" | "record-missing";
export type BlockedReasonView = { kind: BlockedKind; provider: string | null; role: WorkflowRoleName | null; cause: BindingCause | null;
  /** Only for base-action-failed: which Base step and how it failed. */
  action: "read" | "set-stage" | "write-summary" | null; failure: "base-unavailable" | "write-refused" | "conflict" | "unknown" | null;
  /** Only for no-valid-report repaired through the format extractor (Claude): why it could not repair the report. */
  extractor?: "plugin-disabled" | "provider-not-installed" | "provider-version-too-old" | "provider-signed-out" | "not-measured" | "failed" | AuthUnconfirmedKind | null;
  /** Only for guarantee-unavailable: which guarantee the role's configuration asks for and cannot have here. */
  guarantee?: "workspace-read-only" | "network-off" | null };
export type WorkflowRunView = {
  runId: string;
  revision?: number;
  state: RunStateName;
  /** A pause was asked for while a step runs; the run pauses when that step ends. */
  pauseRequested?: boolean;
  pauseReason: { kind: "user" | "binding-suspended" | "plugin-disabled" | "confirmation-timeout"; detail: string | null } | null;
  businessOutcome: "accepted" | "accepted-with-exceptions" | "ended-by-user" | "rework-requested" | "cancelled" | "failed" | null;
  reworkReason: "task-changed" | "acceptance-criteria-changed" | "user-chose-replan" | null;
  createdAt: number;
  /** When cancelling began (Force stop appears 30 seconds later) and whether the run ended by force (Q20). */
  cancelRequestedAt: number | null;
  forcedStop: boolean;
  /** Force stop could not confirm the step's processes gone: still cancelling, a process may be running, Force stop again. */
  forceStopUnconfirmedAt: number | null;
  recipe: WorkflowRecipeView;
  blockedReason: BlockedReasonView | null;
  /** A-07: this run's Develop waits while another run writes the same workspace; it starts on its own when that one is done. */
  workspaceWait?: { heldByRunId: string; since: number } | null;
  steps: readonly { stepId: string; state: StepStateName; blockedReason: BlockedReasonView | null; output?: unknown;
    attempts: readonly { outcome: "open" | "succeeded" | "failed" | "blocked" | "unknown"; intentAt: number; settledAt: number | null;
      /** e.g. "force-stopped", or "force-stopped-confirmed-at-startup" when a restart confirmed the stop. */ detail: string | null; report: StepReportView | null;
      /** The report was organized from the turn's own result, not submitted by the Agent (W9); submitted evidence weighs more. */ reportDerived?: boolean }[] }[];
  confirmations: readonly { stepId: string; proposalDigest: string; requestedAt: number;
    decision: { decision: "accept" | "end" | "rework"; exceptionReason: string | null;
      /** Who decided (the verified operator's device) and under which operation; both carried by the run and its projection. */
      operator?: { deviceId: string }; operationId?: string } | null;
    /** Set when the confirmation expired (24 h) or was withdrawn (archive); it can no longer be answered. */ expiredAt?: number | null }[];
};
/** Host-known facts: the run's label, the task, the computer and the Provider of the step that is running (cancelling copy). */
export type RunHostFacts = { runLabel: string; taskTitle: string; computer: string; activeProvider: string | null; providerLabel(provider: string): string;
  /** The task of the run holding the workspace this run waits for (A-07), when the host knows it. */
  waitingFor?: string | null;
  /** That holding run may still have a process running (an unconfirmed stop): the wait lasts until it is resolved there. */
  waitingForStuck?: boolean;
  /** Phone / Web: actions travel to the Project's computer as resource commands (P13 R-24), which may be offline. */
  remote?: boolean; offline?: boolean; remoteCompatible?: boolean;
  /** false where the fixes a blocked step points to (sign-in, Plugins, the setup) live on the computer, not here. */
  fixesHere?: boolean;
  /** Another device's name on the account, for "Already handled on …"; null for this device or one the host cannot name. */
  deviceName?(deviceId: string): string | null };
/**
 * Both choices are always offered. Unchanged record: keep the plan (default) and start at `reworkFrom`. Changed: replan
 * (default, with the reason), or keep the plan, which starts at the plan confirmation against the new task and criteria.
 */
export type ReworkDraftView = { default: ReworkChoice | null; reason: "task-changed" | "acceptance-criteria-changed" | "user-chose-replan" | null;
  /** null where the record cannot be compared here (phone / Web): nothing is preselected, and keeping the plan says it may be confirmed again first. */
  choices: readonly ReworkChoice[]; keepPlanStartsAt: string | null };
export type ReworkChoice = "keep-plan" | "replan";
export type ConfirmDecision = { decision: "accept" | "end" | "rework"; proposalDigest: string; operationId: string; exceptionReason?: string };

export type WorkflowRunPort = {
  confirm(runId: string, stepId: string, input: ConfirmDecision): Promise<void>;
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  forceStop(runId: string): Promise<void>;
  /** The only action while a result is unknown (Q8): it asks the executor what happened, it never resends. */
  checkResult(runId: string): Promise<void>;
  reworkDraft(runId: string): Promise<ReworkDraftView | null>;
  startRework(runId: string, choice: ReworkChoice): Promise<void>;
  /** One Chat per record and role (round 14); the host opens it, outside the sidebar's Chat list. */
  openChat(runId: string, role: WorkflowRoleName): void;
  /** Checks the cause again and, once it is fixed, starts the step anew; never automatic. Answers the run as it now reads. */
  retryStep(runId: string, stepId: string): Promise<WorkflowRunView>;
  /** Where a blocked step's next step leads: the Provider's sign-in or setup, the turned-off plugin's own detail page (T-P4), the setup's Who does what. */
  openAgentSetup?(provider: string): void;
  openPlugins?(pluginId: string): void;
  chooseConfig?(role: WorkflowRoleName | null): void;
  evidence?(runId: string, stepId: string, kind: "diff" | "report", offset: number): Promise<WorkflowEvidencePage>;
  enableBlockingPlugin?(runId: string, stepId: string): Promise<void>;
  /** Shows another run's details, e.g. the one holding the workspace. */
  openRun(runId: string): void;
};

/** Its Project was archived: the run is (or will be) paused, and nothing can continue it until the Project is restored. */
export const projectArchived = (run: Pick<WorkflowRunView, "pauseReason">) => run.pauseReason?.kind === "user" && run.pauseReason.detail === "project-archived";
/** Waiting for the workspace (A-07): still running, nothing spent, another run writes the same workspace. */
export const waitingForWorkspace = (run: Pick<WorkflowRunView, "state" | "workspaceWait">) => run.state === "running" && Boolean(run.workspaceWait);
/** The one live-confirmation check (E3-04): waiting for a person, undecided, and not expired or withdrawn (a timeout or an archive
    sets expiredAt and pauses the run). The panel, the bell and the Needs-you page all use it. */
export const pendingConfirmation = (run: WorkflowRunView) =>
  run.state === "waiting-human" ? run.confirmations.find(item => !item.decision && item.expiredAt == null) ?? null : null;
/** A step whose last attempt was accepted but never answered: nothing is resent on its own (06 §8, Q8). */
export const resultUnknown = (run: WorkflowRunView) => !run.forcedStop && run.steps.some(step => step.attempts.at(-1)?.outcome === "unknown");
const reportAttempt = (run: WorkflowRunView, stepId: string) =>
  [...(run.steps.find(step => step.stepId === stepId)?.attempts ?? [])].reverse().find(attempt => attempt.report) ?? null;
export const stepReport = (run: WorkflowRunView, stepId: string) => reportAttempt(run, stepId)?.report ?? null;
/** Whether that report was organized from the turn's result rather than submitted (W9). */
export const stepReportDerived = (run: WorkflowRunView, stepId: string) => Boolean(reportAttempt(run, stepId)?.reportDerived);
/** The step held with a reason, if any; an unknown result is not one (it has Check result). */
export const blockedStep = (run: WorkflowRunView) => run.steps.find(step => step.state === "blocked" && step.attempts.at(-1)?.outcome !== "unknown") ?? null;
export function roleOfStep(run: WorkflowRunView, stepId: string): WorkflowRoleName | null {
  const step = run.recipe.steps.find(item => item.id === stepId);
  return step?.kind === "agent.run" ? step.role : null;
}
/** The role of the next agent step still to run: whose configuration a refused continue, retry or decision was about. */
export function nextAgentRole(run: WorkflowRunView): WorkflowRoleName | null {
  const next = run.steps.find(step => !["succeeded", "carried", "not-run"].includes(step.state) && roleOfStep(run, step.stepId));
  return next ? roleOfStep(run, next.stepId) : null;
}
/** "Not admitted as a Developer yet" for a run's next agent role, or null when the run has none left. */
export function notAdmittedText(run: WorkflowRunView, copy: WorkbenchCopy["agentConfigs"]) {
  const role = nextAgentRole(run);
  return role ? formatWorkbench(copy.notAdmitted, { role: { plan: copy.planner, develop: copy.developer, review: copy.reviewer }[role] }) : null;
}

/** A suspended binding's (or a missing record's) cause, as the run details and a phone's ▶ say it. */
export function causeText(cause: NonNullable<BlockedReasonView["cause"]>, copy: WorkbenchCopy["run"]) {
  return { "instance-changed": copy.blockedInstanceChanged, "task-name-missing": copy.blockedTaskMissing, "stage-missing": copy.blockedStageMissing,
    "acceptance-criteria-missing": copy.blockedAcceptanceMissing, "record-missing": copy.blockedRecordMissing }[cause];
}

/**
 * What a refused or failed action says, by its code (read through Electron's IPC wrapper or a resource command's result):
 * a remote command that expired changed nothing, an unknown one asks to check first, an offline computer waits; known
 * workflow refusals keep their own lines; anything else reads as `fallback`.
 */
/** What a paused run says about why, and so what comes next (Restore first when its Project is archived, Continue otherwise). */
export function pauseText(run: Pick<WorkflowRunView, "pauseReason" | "blockedReason">, copy: WorkbenchCopy["run"],
  facts: Pick<RunHostFacts, "computer" | "providerLabel" | "fixesHere">) {
  const cause = run.blockedReason?.kind === "binding-suspended" ? run.blockedReason.cause : null;
  return run.pauseReason?.kind === "plugin-disabled" && run.pauseReason.detail === "workflow"
      ? (facts.fixesHere === false ? formatWorkbench(copy.pausePluginWorkflowOn, { computer: facts.computer }) : copy.pausePluginWorkflow)
    : run.pauseReason?.kind === "plugin-disabled" ? formatWorkbench(copy.pausePluginDisabled, { provider: facts.providerLabel(run.pauseReason.detail ?? "") })
    : run.pauseReason?.kind === "binding-suspended" ? (cause ? causeText(cause, copy) : copy.pauseBindingSuspended)
    : run.pauseReason?.kind === "confirmation-timeout" ? copy.pauseConfirmationTimeout
    : projectArchived(run) ? copy.pauseProjectArchived
    // V-02: restoring the Project leaves an ordinary pause the person can continue, but it was the archive that paused it.
    : run.pauseReason?.kind === "user" && run.pauseReason.detail === "project-restored" ? copy.pauseProjectRestored : copy.pauseUser;
}

export function failureText(code: string, copy: WorkbenchCopy["run"], computer: string, fallback: string, notAdmitted: string | null = null) {
  switch (code) {
    // The computer refused a command whose class does not match its action: only a version difference (or a client bug) does that.
    case "class-mismatch": return formatWorkbench(copy.remoteClassMismatch, { computer });
    // The role's configuration cannot take its step (not admitted, or refused when frozen): named by role where the run is known.
    case "workflow-role-not-admitted": case "workflow-config-refused": return notAdmitted ?? fallback;
    case "remote-expired": return formatWorkbench(copy.remoteExpired, { computer });
    // The computer received it but its deadline had passed: refused unexecuted, so trying again is safe.
    case "command-expired": return formatWorkbench(copy.remoteCommandExpired, { computer });
    case "remote-unknown": return formatWorkbench(copy.remoteUnknown, { computer });
    case "remote-offline": return formatWorkbench(copy.remoteOffline, { computer });
    case "workflow-plugin-disabled": return copy.workflowOffAction;
    case "contract-missing": return copy.workflowBlockedAction;
    case "workflow-project-archived": return copy.projectArchived;
    case "not-blocked": return copy.retryNotBlocked;
    case "stale-proposal": return copy.staleProposal;
    default: return fallback;
  }
}

/** The run's most recent decided confirmation: which step, which proposal, the deciding device and operation (T21-b). */
export function lastDecision(run: Pick<WorkflowRunView, "confirmations">) {
  const decided = [...run.confirmations].reverse().find(item => item.decision);
  return decided?.decision ? { stepId: decided.stepId, proposalDigest: decided.proposalDigest,
    deviceId: decided.decision.operator?.deviceId ?? null, operationId: decided.decision.operationId ?? null } : null;
}
