/**
 * [INPUT]: Depends on the shared Sheet/Button primitives, the run port and its readers, the confirm and rework panels, and
 *          workbench-copy.
 * [OUTPUT]: Provides RunActions (a run's interventions — Check result and Cancel beside an unknown result, Continue, Pause, Force stop,
 * Version and missing-measurement fixes lead to the affected Provider setup.
 *           Cancel — confirmed where destructive, sent once, kept with the run; shared by the details and every page that lands on a
 *           run, review 0929-full F03), RunStatusBadge (the nine run states, Paused amber and Needs you violet — also while a step's Agent waits
 *           for the person — as cards and rows show them) and
 *           RunDetailsSheet — one run opened at the right of the Base: its state with the one fitting action, the step
 *           timeline with each agent step's Chat and result references, and the confirmation or rework draft in place (block 2). E2-04: a sign-in not confirmed (unknown, checking, error, timeout) says which, never "signed out", and offers Check sign-in on the desktop.
 * Localizes built-in recipe names and distinguishes missing measurement evidence from missing installation.
 * [POS]: U04/U05 run details (06 §6–§8): paused runs name their reason (user, a suspended binding, a turned-off plugin)
 *        and can continue or be cancelled; cancelling shows Force stop after 30 seconds, and again at once when a force stop
 *        could not confirm the processes gone (a process may still be running); an unknown result offers only
 *        Check result (Q8/Q20); Cancel run and Force stop are confirmed once more in a dialog; an Agent waiting on a permission or question in its hidden Chat is named with Open Chat; a
 *        blocked step says why (for a missing report, also why Claude could not organize it); a Develop waiting for another run
 *        to finish writing the same workspace says so and opens that run (A-07); a turned-off Workflow plugin pauses with Open
 *        Plugins & Apps (A-04); an archived Project's run reads Paused · Project archived and offers no Continue until it is
 *        restored (then its reason says the archive paused it), and a pause asked for mid-step says the run pauses when the step ends; offers its one next step and
 *        Retry this step (manual), and a suspended binding names its cause. A report organized from the result says so.
 *        On phone / Web (`facts.remote`) an action stays busy until the computer's receipt, a refusal says why (expired, unknown,
 *        offline), nothing is offered while it is offline, and fixes that live on the computer are left out (`fixesHere`),
 *        a Workflow-off pause naming the computer instead. Busy and the failure are kept with the run (useKeptState), so a
 *        refresh or reopening keeps them; a report the projection shortened reads "Shortened".
 *        There is no separate runs list (Q4). A confirmation these details showed that someone else decided says where
 *        ("Already handled on {device}", or plainly when the host cannot name the device), never just disappears (T21-b).
 */
import { workflowRecipeName } from "@ai-chat/ui/lib/workbench-copy";
import { useEffect, useState, type ReactNode } from "react";
import { MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ai-chat/ui/components/ui/sheet";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { cn } from "@ai-chat/ui/lib/utils";
import { useWorkflowCopy } from "../chrome/workflow-column";
import { useAppTranslation } from "../platform/i18n";
import { ConfirmPanel, ReworkDraftPanel } from "./confirm-panel";
import { WorkflowEvidence } from "./details/evidence";
import { RemoteRecovery } from "./details/recovery";
import { useKeptState } from "./runs-context";
import { displaySteps, type WorkflowRoleName } from "./port";
import { blockedStep, causeText, failureText, pauseText, projectArchived, FORCE_STOP_CONFIRMED_AT_STARTUP, waitingForWorkspace, pendingConfirmation, resultUnknown, roleOfStep, stepReport, stepReportDerived, type ReworkDraftView, type RunHostFacts, type RunStateName, type StepStateName,
  type WorkflowRunPort, type WorkflowRunView, isAuthUnconfirmed, notAdmittedText } from "./run-port";

const FORCE_STOP_AFTER_MS = 30_000;
const TONE: Record<RunStateName, string> = {
  queued: "bg-muted text-muted-foreground", running: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "waiting-human": "bg-violet-500/10 text-violet-700 dark:text-violet-300", paused: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  blocked: "bg-amber-500/15 text-amber-800 dark:text-amber-300", cancelling: "bg-muted text-muted-foreground",
  succeeded: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", failed: "bg-red-500/10 text-red-700 dark:text-red-300", cancelled: "bg-muted text-muted-foreground",
};
const stateLabel = (state: RunStateName, copy: WorkbenchCopy["run"], forced = false) => ({
  queued: copy.queued, running: copy.running, "waiting-human": copy.needsYou, paused: copy.paused, blocked: copy.blocked, cancelling: copy.cancelling,
  succeeded: copy.succeeded, failed: copy.failed, cancelled: forced ? copy.stoppedForced : copy.cancelled,
}[state]);
const stepLabel = (state: StepStateName, copy: WorkbenchCopy["run"]) => ({
  pending: copy.stepPending, running: copy.stepRunning, "waiting-human": copy.stepWaiting, succeeded: copy.stepSucceeded, failed: copy.stepFailed,
  blocked: copy.stepBlocked, carried: copy.stepCarried, "not-run": copy.stepNotRun,
}[state]);

export function RunStatusBadge({ run, forced = false, agentWaiting = false, onOpen }: {
  run: Pick<WorkflowRunView, "state" | "runId" | "pauseReason" | "workspaceWait">; forced?: boolean; /** A step's Agent waits for the person in its Chat. */ agentWaiting?: boolean; onOpen?(): void;
}) {
  const copy = useWorkflowCopy().run;
  const waiting = !agentWaiting && waitingForWorkspace(run);
  const className = cn("inline-flex h-5 max-w-full items-center truncate whitespace-nowrap rounded-full px-2 font-medium text-[11px]",
    TONE[agentWaiting ? "waiting-human" : waiting ? "queued" : run.state]);
  // A confirmation left for 24 hours pauses the run (Q16); the card says so in amber.
  const text = agentWaiting ? copy.needsYou : waiting ? copy.waitingWorkspace
    : run.state === "paused" && run.pauseReason?.kind === "confirmation-timeout" ? copy.pausedWaited
    : run.state === "paused" && projectArchived(run) ? copy.pausedArchived : stateLabel(run.state, copy, forced);
  return onOpen
    ? <button type="button" className={cn(className, "cursor-pointer touch-target-44 relative")} data-run-status={run.state} onClick={onOpen}>{text}</button>
    : <span className={className} data-run-status={run.state}>{text}</span>;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, [active]);
  return now;
}

export function RunDetailsSheet({ run, facts, port, agentWaiting = null, recordVersion = "", onOpenChange }: {
  run: WorkflowRunView; facts: RunHostFacts; port: WorkflowRunPort;
  /** Changes whenever the record's cells change, so a rework draft is read again from the record as it is (Q1). */
  recordVersion?: string;
  /** The role whose Agent waits on a permission or a question in its Chat; the host reads it from what needs the person. */
  agentWaiting?: WorkflowRoleName | null; onOpenChange(open: boolean): void;
}) {
  const { i18n } = useAppTranslation();
  const workbench = useWorkflowCopy(), copy = workbench.run, setup = workbench.setup;
  const now = useNow(run.state === "cancelling");
  const [draft, setDraft] = useState<ReworkDraftView | null>(null);
  /* Busy and a failure are the run's actions' (RunActions, kept with the run): a failure already read is cleared on closing, and
     closing while a receipt is pending keeps it. */
  const [busy] = useKeptState(`${run.runId}:busy`, false);
  const [, setFailed] = useKeptState<string | null>(`${run.runId}:failed`, null);
  const loadDraft = () => void port.reworkDraft(run.runId).then(setDraft, () => setDraft(null));
  useEffect(() => { if (run.businessOutcome === "rework-requested") loadDraft(); }, [run.runId, run.businessOutcome, recordVersion]);
  const unknown = resultUnknown(run), waiting = pendingConfirmation(run);
  /* T21-b: the proposal these details showed, and the decisions sent from here. When that proposal is decided by someone else,
     the details say where, instead of the panel just going away. */
  const [shownProposal, setShownProposal] = useKeptState<string | null>(`${run.runId}:shown-proposal`, null);
  const [sentHere, setSentHere] = useKeptState<readonly string[]>(`${run.runId}:sent-here`, []);
  useEffect(() => { if (waiting) setShownProposal(waiting.proposalDigest); }, [waiting?.proposalDigest]);
  const decidedElsewhere = !waiting && shownProposal ? run.confirmations.find(item => item.proposalDigest === shownProposal && item.decision
    && item.decision.operationId && !sentHere.includes(item.decision.operationId))?.decision ?? null : null;
  const elsewhereName = decidedElsewhere?.operator ? facts.deviceName?.(decidedElsewhere.operator.deviceId) ?? null : null;
  const unknownSince = run.steps.flatMap(step => step.attempts).find(attempt => attempt.outcome === "unknown")?.intentAt ?? null;
  const unconfirmed = run.state === "cancelling" && run.forceStopUnconfirmedAt !== null;
  const stuck = unconfirmed || (run.state === "cancelling" && run.cancelRequestedAt !== null && now - run.cancelRequestedAt >= FORCE_STOP_AFTER_MS);
  const steps = displaySteps(run.recipe);
  const labelOf = (key: string) => {
    const step = steps.find(item => item.key === key)!;
    return step.kind === "agent" ? { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview }[step.role]
      : step.kind === "confirm-plan" ? setup.stepConfirm : setup.stepDecide;
  };
  const pausedText = pauseText(run, copy, facts);
  // An archived Project refuses Continue until it is restored, so Continue is not offered (Cancel still is).
  const archived = projectArchived(run);
  // A-04: the Workflow plugin itself is off; its detail is "workflow", never a Provider to name.
  const workflowOff = run.pauseReason?.kind === "plugin-disabled" && run.pauseReason.detail === "workflow";
  const live = !["succeeded", "failed", "cancelled"].includes(run.state);

  return (
    <Sheet open onOpenChange={next => { if (!next && !busy) setFailed(null); onOpenChange(next); }}>
      <SheetContent side="right" className="w-full gap-0 p-0 max-sm:h-[85dvh] max-sm:rounded-t-2xl sm:max-w-md" data-run-details={run.runId}>
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="truncate text-sm">{facts.taskTitle}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
            <RunStatusBadge run={run} forced={run.forcedStop} agentWaiting={Boolean(agentWaiting)} />
            <span>{facts.runLabel} · {workflowRecipeName(run.recipe, workbench.setup)} · {formatWorkbench(copy.onComputer, { computer: facts.computer })}</span>
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {agentWaiting && (
            <div className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-2 text-xs" data-run-notice="agent-waiting" role="status">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">{formatWorkbench(copy.agentWaiting, { step: { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview }[agentWaiting] })}</span>
                <span>{copy.agentWaitingBody}</span>
              </span>
              <Button type="button" size="sm" className="pointer-coarse:h-11" onClick={() => port.openChat(run.runId, agentWaiting)}><MessageSquareIcon />{copy.openChat}</Button>
            </div>
          )}
          {run.state === "paused" && <Notice text={pausedText} data="paused" />}
          {run.state !== "paused" && live && run.pauseRequested && <Notice text={archived ? copy.pausingArchived : copy.pausingAfterStep} data="pausing" />}
          {/* Plugins live on the computer: phone / Web name it in the notice instead (review 0926-r2 E2-03). */}
          {run.state === "paused" && workflowOff && facts.fixesHere !== false && port.openPlugins && (
            <Button type="button" size="sm" variant="outline" className="self-start pointer-coarse:h-11" onClick={() => port.openPlugins?.("workflow")}>{formatWorkbench(workbench.plugins.openPlugin, { name: workbench.plugins.builtin.workflow.name })}</Button>
          )}
          {waitingForWorkspace(run) && run.workspaceWait && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-xs" data-run-notice="workspace-wait" role="status">
              <span>{formatWorkbench(copy.waitingWorkspaceBody, { task: facts.waitingFor ?? "…" })}</span>
              {facts.waitingForStuck && <span className="text-amber-700 dark:text-amber-400" data-workspace-wait-stuck="">
                {formatWorkbench(copy.waitingWorkspaceStuck, { task: facts.waitingFor ?? "…" })}</span>}
              <Button type="button" size="sm" variant="outline" className="self-end pointer-coarse:h-11"
                onClick={() => port.openRun(run.workspaceWait!.heldByRunId)} data-open-holding-run="">{copy.viewHoldingRun}</Button>
            </div>
          )}
          {live && !unknown && <BlockedNotice run={run} facts={facts} port={port} />}
          {unconfirmed ? <Notice title={copy.forceStopUnconfirmedTitle} text={formatWorkbench(copy.forceStopUnconfirmedBody, { provider: facts.activeProvider ?? "", computer: facts.computer })}
            data="force-unconfirmed" warn />
            : run.state === "cancelling" && (stuck
            ? <Notice title={copy.stuckTitle} text={formatWorkbench(copy.stuckBody, { provider: facts.activeProvider ?? "", computer: facts.computer })} data="stuck" warn />
            : <Notice title={copy.cancellingTitle} text={formatWorkbench(copy.cancellingBody, { provider: facts.activeProvider ?? "", computer: facts.computer })} data="cancelling" />)}
          {run.state === "cancelled" && run.forcedStop && <Notice data="forced" warn text={run.steps.some(step => step.attempts.some(attempt => attempt.detail === FORCE_STOP_CONFIRMED_AT_STARTUP))
            ? copy.stoppedForcedAtStartupHint : copy.stoppedForcedHint} />}
          {unknown && <Notice title={copy.resultUnknown} text={formatWorkbench(copy.resultUnknownBody, { computer: facts.computer,
            time: unknownSince ? new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }).format(unknownSince) : "" })} data="unknown" warn />}
          {decidedElsewhere && <Notice data="handled-elsewhere"
            text={elsewhereName ? formatWorkbench(copy.alreadyHandled, { device: elsewhereName }) : workbench.phone.alreadyHandled} />}
          {waiting && !unknown && <ConfirmPanel run={run} port={port} onRework={loadDraft} onSent={id => setSentHere(current => [...current, id])} remote={facts.remote ? { computer: facts.computer, offline: Boolean(facts.offline) } : undefined} />}
          {draft && <ReworkDraftPanel runId={run.runId} draft={draft} reworkFrom={run.recipe.reworkFrom} port={port}
            remote={facts.remote ? { computer: facts.computer, offline: Boolean(facts.offline) } : undefined} />}
          <ol className="flex flex-col gap-2" data-run-steps="">
            {steps.map(step => {
              const state = run.steps.find(item => item.stepId === step.key)?.state ?? "pending";
              const report = stepReport(run, step.key), role = roleOfStep(run, step.key);
              return (
                <li key={step.key} className="flex flex-col gap-1 rounded-lg border px-3 py-2" data-run-step={step.key} data-step-state={state}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-medium">{labelOf(step.key)}</span>
                    <span className="text-muted-foreground text-xs">{stepLabel(state, copy)}</span>
                    {role && <Button type="button" variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={() => port.openChat(run.runId, role)}
                      aria-label={`${copy.openChat}: ${labelOf(step.key)}`}><MessageSquareIcon />{copy.openChat}</Button>}
                  </div>
                  {report && <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground text-xs">{report.result}</p>}
                  {report?.shortened && <span className="self-start rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" data-report-shortened="">{copy.reportShortened}</span>}
                  {report && stepReportDerived(run, step.key) && (
                    <span className="self-start rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={copy.reportDerivedHint} data-report-derived="">
                      {copy.reportDerived}<span className="sr-only">. {copy.reportDerivedHint}</span>
                    </span>
                  )}
                  <WorkflowEvidence run={run} stepId={step.key} port={port} facts={facts} />
                  {(report?.artifactRef || report?.evidenceRefs?.length) ? (
                    <ul className="flex flex-wrap gap-1 text-[11px]" data-run-refs="">
                      {report.artifactRef && <li className="rounded bg-muted px-1.5 py-0.5">{copy.artifact}: {report.artifactRef}</li>}
                      {report.evidenceRefs?.map(ref => <li key={ref} className="rounded bg-muted px-1.5 py-0.5">{copy.evidence}: {ref}</li>)}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
        <RunActions run={run} facts={facts} port={port} className="border-t bg-muted/40 px-4 py-3" />
      </SheetContent>
    </Sheet>
  );
}

/**
 * A run's interventions, shared by the run details and every page that lands on a run (review 0929-full F03): Check result and
 * Cancel next to an unknown result, Continue for a paused run, Pause, Force stop when a stop is stuck, and Cancel while it is live.
 * Cancel and Force stop are confirmed first; each action is sent once, never retried, and its busy and failure are kept with the run.
 */
export function RunActions({ run, facts, port, className, afterPrimary }: { run: WorkflowRunView; facts: RunHostFacts; port: WorkflowRunPort; className?: string;
  /** A host's own action placed second, right after Check result (the Needs-you page's Open Chat for an unknown result). */
  afterPrimary?: ReactNode }) {
  const workbench = useWorkflowCopy(), copy = workbench.run;
  const now = useNow(run.state === "cancelling");
  const [busy, setBusy] = useKeptState(`${run.runId}:busy`, false);
  const [failed, setFailed] = useKeptState<string | null>(`${run.runId}:failed`, null);
  const [ask, setAsk] = useState<"cancel" | "force-stop" | null>(null);
  // Phone / Web with the computer offline: nothing can be sent, so nothing is offered to press.
  const offline = Boolean(facts.remote && (facts.offline || facts.remoteCompatible === false));
  const act = (action: (runId: string) => Promise<void>, failure = copy.actionFailed) => async () => {
    setBusy(true); setFailed(null);
    try { await action(run.runId); }
    catch (error) { setFailed(failureText(errorMessage(error), copy, facts.computer, failure, notAdmittedText(run, workbench.agentConfigs))); }
    finally { setBusy(false); }
  };
  const unknown = resultUnknown(run), archived = projectArchived(run);
  const unconfirmed = run.state === "cancelling" && run.forceStopUnconfirmedAt !== null;
  const stuck = unconfirmed || (run.state === "cancelling" && run.cancelRequestedAt !== null && now - run.cancelRequestedAt >= FORCE_STOP_AFTER_MS);
  const live = !["succeeded", "failed", "cancelled"].includes(run.state);
  return (
    <>
      <div className={cn("flex flex-wrap items-center justify-end gap-2", className)} data-run-actions={run.runId}>
        {failed && <p role="alert" className="mr-auto text-destructive text-xs" data-run-action-failed="">{failed}</p>}
        {facts.remote && busy && <p role="status" className="mr-auto text-muted-foreground text-xs" data-run-sending="">{formatWorkbench(copy.remoteSending, { computer: facts.computer })}</p>}
        {facts.remote && facts.offline && <p role="status" className="mr-auto text-muted-foreground text-xs" data-run-offline="">{formatWorkbench(copy.remoteOffline, { computer: facts.computer })}</p>}
        {/* Cancel is always there while the run is live, also next to Check result (A-05): an unknown result is never a dead end. */}
        {/* A paused run is continued first; Check result and Retry this step work again once it is (F1: a pause honoured on block). */}
        {unknown && run.state !== "paused" ? <>
          <Button type="button" disabled={busy || offline} onClick={act(port.checkResult, copy.checkResultFailed)}>{copy.checkResult}</Button>
          {afterPrimary}
          {live && run.state !== "cancelling" && <Button type="button" variant="ghost" disabled={busy || offline} onClick={() => setAsk("cancel")}>{copy.cancelRun}</Button>}
        </> : <>
          {run.state === "paused" && !archived && <Button type="button" disabled={busy || offline} onClick={act(port.resume)}>{copy.resume}</Button>}
          {["queued", "running", "waiting-human", "blocked"].includes(run.state) &&
            <Button type="button" variant="ghost" disabled={busy || offline} onClick={act(port.pause)}>{copy.pause}</Button>}
          {stuck && <Button type="button" variant="destructive" disabled={busy || offline} onClick={() => setAsk("force-stop")}>{copy.forceStop}</Button>}
          {live && run.state !== "cancelling" && <Button type="button" variant="ghost" disabled={busy || offline} onClick={() => setAsk("cancel")}>{copy.cancelRun}</Button>}
        </>}
      </div>
      {/* Cancel and Force stop are asked once more, on every surface; keeping the run sends nothing. */}
      <ConfirmationDialog open={ask !== null} busy={busy} confirmTone="destructive"
        title={ask === "force-stop" ? copy.forceConfirmTitle : copy.cancelConfirmTitle}
        description={ask === "force-stop" ? formatWorkbench(copy.forceConfirmBody, { computer: facts.computer }) : copy.cancelConfirmBody}
        confirmLabel={ask === "force-stop" ? copy.forceStop : copy.cancelRun} cancelLabel={ask === "force-stop" ? copy.keepWaiting : copy.keepRunning}
        onOpenChange={next => { if (!next) setAsk(null); }}
        onConfirm={() => { const action = ask === "force-stop" ? port.forceStop : port.cancel; setAsk(null); void act(action)(); }} />
    </>
  );
}


/**
 * A held step says why and offers its one next step, plus Retry this step (manual only; not while the run is paused, which is
 * continued first from the footer). A retry whose cause is still there
 * only refreshes the reason; the notice then says it was checked again, so the click never looks like nothing happened.
 */
function BlockedNotice({ run, facts, port }: { run: WorkflowRunView; facts: RunHostFacts; port: WorkflowRunPort }) {
  const workbench = useWorkflowCopy(), copy = workbench.run, setup = workbench.setup;
  const step = blockedStep(run);
  const [busy, setBusy] = useKeptState(`${run.runId}:${step?.stepId ?? ""}:retry-busy`, false);
  const [checked, setChecked] = useKeptState<string | null>(`${run.runId}:${step?.stepId ?? ""}:retry-checked`, null);
  const [failed, setFailed] = useKeptState<string | null>(`${run.runId}:${step?.stepId ?? ""}:retry-failed`, null);
  if (!step) return null;
  const reason = step.blockedReason, role = roleOfStep(run, step.stepId) ?? reason?.role ?? null;
  const values = { provider: reason?.provider ? facts.providerLabel(reason.provider) : "", computer: facts.computer,
    step: role ? { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview }[role] : "" };
  /* E2-04: a sign-in that is not confirmed says which way (unknown, still checking, failed, timed out), never "signed out". */
  const auth = { "provider-auth-unknown": copy.blockedAuthUnknown, "provider-auth-checking": copy.blockedAuthChecking,
    "provider-auth-error": copy.blockedAuthError, "provider-auth-timeout": copy.blockedAuthTimeout };
  const extractorAuth = { "provider-auth-unknown": copy.blockedExtractorAuthUnknown, "provider-auth-checking": copy.blockedExtractorAuthChecking,
    "provider-auth-error": copy.blockedExtractorAuthError, "provider-auth-timeout": copy.blockedExtractorAuthTimeout };
  const text = !reason ? (role ? formatWorkbench(copy.blockedOther, values) : copy.blockedBaseAction)
    : isAuthUnconfirmed(reason.kind) ? formatWorkbench(auth[reason.kind], values)
    : reason.kind === "binding-suspended" ? (reason.cause ? causeText(reason.cause, copy) : copy.pauseBindingSuspended)
    : reason.kind === "base-action-failed" ? formatWorkbench(copy.blockedBaseActionFailed, {
      action: { read: copy.baseActionRead, "set-stage": copy.baseActionSetStage, "write-summary": copy.baseActionWriteSummary }[reason.action ?? "read"],
      failure: { "base-unavailable": copy.baseFailureUnavailable, "write-refused": copy.baseFailureRefused, conflict: copy.baseFailureConflict,
        unknown: copy.baseFailureUnknown }[reason.failure ?? "unknown"] })
    : reason.kind === "no-valid-report" && reason.extractor ? isAuthUnconfirmed(reason.extractor)
      ? formatWorkbench(extractorAuth[reason.extractor], values) : formatWorkbench({ "plugin-disabled": copy.blockedExtractorOff,
      "provider-not-installed": copy.blockedExtractorNotInstalled, "provider-signed-out": copy.blockedExtractorSignedOut,
      "provider-version-too-old": copy.blockedExtractorVersionTooOld,
      "not-measured": copy.blockedExtractorNotMeasured, failed: copy.blockedExtractorFailed }[reason.extractor], values)
    : formatWorkbench({ "provider-signed-out": copy.blockedSignedOut, "provider-not-installed": copy.blockedNotInstalled, "provider-measurements-unavailable": copy.blockedMeasurementsUnavailable, "plugin-disabled": copy.blockedPluginDisabled,
      "provider-version-too-old": copy.blockedVersionTooOld,
      "not-measured": copy.blockedNotMeasured, "provider-cannot": copy.blockedProviderCannot, "config-unavailable": copy.blockedConfigUnavailable,
      "no-valid-report": copy.blockedNoValidReport, "dispatch-failed": copy.blockedDispatchFailed,
      "attempts-exhausted": copy.blockedAttemptsExhausted,
      "guarantee-unavailable": reason.guarantee === "network-off" ? copy.blockedGuaranteeNetwork : copy.blockedGuaranteeReadOnly }[reason.kind], values);
  const provider = reason?.provider ?? null;
  const extractor = reason?.kind === "no-valid-report" ? reason.extractor ?? null : null;
  /* The format extractor is Claude (W9): its fixes lead to Claude, except a failed repair, which is read in the Chat. */
  const next = !reason ? null
    : extractor === "plugin-disabled" ? { label: formatWorkbench(workbench.plugins.openPlugin, { name: facts.providerLabel("claude") }), run: () => port.openPlugins?.("claude") }
    : extractor === "provider-signed-out" || extractor === "provider-not-installed" || extractor === "provider-version-too-old" || extractor === "not-measured" || isAuthUnconfirmed(extractor)
      ? { label: formatWorkbench(extractor === "provider-signed-out" ? copy.blockedSignIn : isAuthUnconfirmed(extractor) ? copy.blockedCheckSignIn
        : extractor === "not-measured" ? copy.blockedCheckProvider : copy.blockedSetUp,
        { provider: facts.providerLabel("claude") }), run: () => port.openAgentSetup?.("claude") }
    : (reason.kind === "provider-signed-out" || reason.kind === "provider-not-installed" || reason.kind === "provider-version-too-old" || reason.kind === "not-measured" || isAuthUnconfirmed(reason.kind)) && provider
      ? { label: formatWorkbench(reason.kind === "provider-signed-out" ? copy.blockedSignIn : isAuthUnconfirmed(reason.kind) ? copy.blockedCheckSignIn : copy.blockedSetUp, values), run: () => port.openAgentSetup?.(provider) }
    : reason.kind === "plugin-disabled" && provider ? { label: formatWorkbench(workbench.plugins.openPlugin, { name: facts.providerLabel(provider) }), run: () => port.openPlugins?.(provider) }
    : reason.kind === "provider-measurements-unavailable" || reason.kind === "not-measured" || reason.kind === "provider-cannot" || reason.kind === "config-unavailable" || reason.kind === "guarantee-unavailable"
      ? { label: copy.blockedChooseConfig, run: () => port.chooseConfig?.(role) }
    : reason.kind === "no-valid-report" && role ? { label: copy.openChat, run: () => port.openChat(run.runId, role), chat: true }
    : null;
  const paused = run.state === "paused";
  const retry = async () => {
    setBusy(true); setChecked(null); setFailed(null);
    try { const after = await port.retryStep(run.runId, step.stepId); if (blockedStep(after)?.stepId === step.stepId) setChecked(step.stepId); }
    // A retry that fails says why (A-06); the code is read through Electron's IPC wrapper.
    catch (error) {
      const code = errorMessage(error);
      setFailed(failureText(code, copy, facts.computer, copy.retryFailed, notAdmittedText(run, workbench.agentConfigs)));
    }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs" data-run-notice="blocked" data-blocked-kind={reason?.kind ?? "other"} role="status">
      <span className="flex gap-2"><TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-amber-700 dark:text-amber-400" /><span>{text}</span></span>
      <RemoteRecovery run={run} stepId={step.stepId} reason={reason} stepLabel={values.step} facts={facts} port={port} />
      {checked === step.stepId && <span className="text-muted-foreground" data-retry-checked="">{copy.retryStillBlocked}</span>}
      {failed && <span role="alert" className="text-destructive" data-retry-failed="">{failed}</span>}
      <span className="flex flex-wrap justify-end gap-2">
        {next && (facts.fixesHere !== false || "chat" in next) && <Button type="button" size="sm" variant="outline" className="pointer-coarse:h-11" onClick={next.run} data-blocked-next="">{next.label}</Button>}
        {!paused && <Button type="button" size="sm" className="pointer-coarse:h-11" disabled={busy || Boolean(facts.remote && (facts.offline || facts.remoteCompatible === false))} onClick={() => void retry()} data-retry-step="">{copy.retryStep}</Button>}
      </span>
    </div>
  );
}

function Notice({ title, text, data, warn = false }: { title?: string; text: string; data: string; warn?: boolean }) {
  return (
    <div className={cn("flex gap-2 rounded-lg px-3 py-2 text-xs", warn ? "bg-amber-500/10" : "bg-muted")} data-run-notice={data} role="status">
      {warn && <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />}
      <span className="flex flex-col gap-0.5">{title && <span className="font-medium">{title}</span>}<span>{text}</span></span>
    </div>
  );
}
