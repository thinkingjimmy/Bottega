/**
 * [INPUT]: Depends on the shared Button/Textarea/DialogChoice primitives, the run port and workbench-copy.
 * [OUTPUT]: Provides ConfirmPanel — the plan confirmation (accept or end) and the result decision (accept, accept with an
 *           exception whose reason is written in the page, end, rework) — and ReworkDraftPanel, the choices of the next run.
 * [POS]: Rendered inside the run details while a run waits for a person (06 §6, Q9/Q17/Q18), only for a live confirmation — never a withdrawn or expired one (E3-04); a rework request ends the run
 *        and the draft is read fresh from the record, so which start is offered follows the port, never a guess here. A
 *        replacement proposal (the record changed while it waited, A-02) says it was asked again on every device that showed the
 *        earlier one, nothing chosen for the earlier one (choice, reason, failure) carries over, and nothing is preselected (E3-03, A-02).
 *        A proposal the phone / Web projection shortened says so and opens the whole text in its role's Chat.
 *        On phone / Web (`remote`) it says the decision is being sent, waits for the computer's answer, and cannot send offline;
 *        a rework there offers Keep the plan (preselected, Q17) and Plan again; the record cannot be compared on the phone, so Keep the plan says it may reconfirm.
 */
import { useEffect } from "react";
import { DialogChoice } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { formatWorkbench } from "@ai-chat/ui/lib/workbench-copy";
import { useWorkflowCopy } from "../chrome/workflow-column";
import type { ReworkChoice, ReworkDraftView, WorkflowRunPort, WorkflowRunView } from "./run-port";
import { failureText, notAdmittedText, pendingConfirmation, stepReport } from "./run-port";
import { useKeptState } from "./runs-context";

type Decision = "accept" | "exception" | "end" | "rework";

export function ConfirmPanel({ run, port, onRework, onSent, remote }: {
  run: WorkflowRunView;
  port: WorkflowRunPort;
  /** Phone / Web: the decision travels to this computer as a resource command; offline, it cannot be sent. */
  remote?: { computer: string; offline: boolean };
  /** Called after a rework decision lands, so the details can show the draft of the next run. */
  onRework(): void;
  /** The operation id of each decision sent from here, so the details never read their own decision as someone else's. */
  onSent?(operationId: string): void;
}) {
  const workbench = useWorkflowCopy(), copy = workbench.run;
  // A withdrawn (archive) or expired (24 h) confirmation is not offered (E3-04).
  const pending = pendingConfirmation(run);
  /* Kept with the run, its step and the proposal (digest + asked-at, E3-03), so a refresh or reopening keeps the choice, the typed
     reason and a failure (E2-02), while a replacement proposal starts fresh: nothing chosen for the old one crosses into it. */
  const step = `${run.runId}:${pending?.stepId ?? ""}:confirm`, proposalId = pending ? `${pending.proposalDigest}@${pending.requestedAt}` : "";
  const at = `${step}:${proposalId}`;
  const [choice, setChoice] = useKeptState<Decision | null>(`${at}:choice`, "accept");
  const [stale, setStale] = useKeptState(`${at}:stale`, false);
  const [reason, setReason] = useKeptState(`${at}:reason`, "");
  const [failed, setFailed] = useKeptState<string | null>(`${at}:failed`, null);
  // The send in flight, by its operationId: only its own answer ends it, whatever proposal is showing by then.
  const [sending, setSending] = useKeptState<string | null>(`${step}:sending`, null), busy = sending !== null;
  /* The proposal this device last showed for the step: another one arriving means it was asked again, on every device that saw
     the first, not only the one whose send was refused as stale. */
  const [shown, setShown] = useKeptState(`${step}:shown`, "");
  useEffect(() => {
    if (!proposalId || shown === proposalId) return;
    // Asked again: nothing is preselected for the replacement, as after a refused stale send (A-02).
    if (shown) { setStale(true); setChoice(null); }
    setShown(proposalId);
  }, [proposalId, shown, setShown, setStale, setChoice]);
  if (!pending) return null;
  const kind = run.recipe.steps.find(step => step.id === pending.stepId);
  const isPlan = kind?.kind === "human.confirm" && kind.confirmation === "plan";
  // What is being confirmed: the plan for the plan step, the review for the result step.
  const report = stepReport(run, isPlan ? "plan" : "review"), proposal = report?.result ?? copy.noResultYet;
  const options: Decision[] = isPlan ? ["accept", "end"] : ["accept", "exception", "end", "rework"];
  const label: Record<Decision, string> = { accept: isPlan ? copy.acceptPlan : copy.accept, exception: copy.acceptWithException, end: copy.end, rework: copy.rework };
  const needsReason = choice === "exception" && !reason.trim();
  const submit = async () => {
    if (busy || needsReason || !choice) return;
    const operationId = crypto.randomUUID();
    setSending(operationId); setFailed(null); onSent?.(operationId);
    try {
      await port.confirm(run.runId, pending.stepId, { decision: choice === "exception" ? "accept" : choice, proposalDigest: pending.proposalDigest,
        operationId, ...(choice === "exception" ? { exceptionReason: reason.trim() } : {}) });
      if (choice === "rework") onRework();
      setStale(false);
    } catch (error) {
      if (errorMessage(error) === "stale-proposal") { setStale(true); setChoice(null); setReason(""); }
      else if (errorMessage(error) === "already-resolved") setFailed(workbench.phone.alreadyHandled);
      else setFailed(failureText(errorMessage(error), copy, remote?.computer ?? "", copy.actionFailed, notAdmittedText(run, workbench.agentConfigs)));
    } finally { setSending(current => current === operationId ? null : current); }
  };
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3" data-confirm={isPlan ? "plan" : "result"}>
      <h3 className="font-medium text-sm">{isPlan ? copy.confirmPlanTitle : copy.confirmResultTitle}</h3>
      {stale && <p className="text-amber-700 text-xs dark:text-amber-400" role="status" data-confirm-stale="">{copy.staleProposal}</p>}
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{proposal}</p>
      {/* The decision binds to the whole proposal: a shortened one says so and opens the whole text (review 0926-r2 V-01). */}
      {report?.shortened && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-muted px-2 py-1.5 text-xs">
          <span className="flex-1" data-report-shortened="">{isPlan ? copy.reportShortenedPlan : copy.reportShortenedReview}</span>
          <Button type="button" size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => port.openChat(run.runId, isPlan ? "plan" : "review")}>
            {isPlan ? copy.openWholePlan : copy.openWholeReview}</Button>
        </div>
      )}
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={isPlan ? copy.confirmPlanTitle : copy.confirmResultTitle}>
        {options.map(option => (
          <DialogChoice key={option} size="sm" role="radio" aria-checked={choice === option} selected={choice === option}
            data-decision={option} title={label[option]} onClick={() => setChoice(option)} />
        ))}
      </div>
      {choice === "exception" && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{copy.exceptionReason}</span>
          <Textarea value={reason} rows={3} maxLength={2_000} onChange={event => setReason(event.target.value)} aria-invalid={needsReason} />
          {needsReason && <span className="text-muted-foreground">{copy.exceptionReasonRequired}</span>}
        </label>
      )}
      {failed && <p role="alert" className="text-destructive text-xs" data-confirm-failed="">{failed}</p>}
      {remote && busy && <p role="status" className="text-muted-foreground text-xs" data-confirm-sending="">{formatWorkbench(copy.remoteSending, { computer: remote.computer })}</p>}
      {remote?.offline && <p role="status" className="text-muted-foreground text-xs">{formatWorkbench(copy.remoteOffline, { computer: remote.computer })}</p>}
      <Button type="button" className="self-end pointer-coarse:h-11" disabled={busy || needsReason || !choice || Boolean(remote?.offline)} onClick={() => void submit()}>{label[choice ?? "accept"]}</Button>
    </section>
  );
}

export function ReworkDraftPanel({ runId, draft, reworkFrom, port, remote }: { runId: string; draft: ReworkDraftView; reworkFrom: string; port: WorkflowRunPort;
  /** Phone / Web: the rework is a resource command to this computer, as in ConfirmPanel. */
  remote?: { computer: string; offline: boolean } }) {
  const copy = useWorkflowCopy().run;
  const [choice, setChoice] = useKeptState<ReworkChoice | null>(`${runId}:rework:choice`, draft.default);
  const [busy, setBusy] = useKeptState(`${runId}:rework:busy`, false), [failed, setFailed] = useKeptState<string | null>(`${runId}:rework:failed`, null);
  // Keeping the plan goes straight to Develop only when the record is unchanged; otherwise the plan is confirmed again first.
  // Where the record cannot be compared, the choice says both may happen.
  const label: Record<ReworkChoice, string> = { replan: copy.replan, "keep-plan": draft.keepPlanStartsAt === null ? copy.reworkKeepPlan
    : draft.keepPlanStartsAt === reworkFrom ? copy.reworkFromDevelop : copy.reworkKeepPlanReconfirm };
  const reason = draft.reason === "acceptance-criteria-changed" ? copy.reworkReasonAcceptance : draft.reason === "task-changed" ? copy.reworkReasonTask : null;
  const start = async () => {
    if (!choice) return;
    setBusy(true); setFailed(null);
    try { await port.startRework(runId, choice); }
    catch (error) { setFailed(failureText(errorMessage(error), copy, remote?.computer ?? "", copy.actionFailed)); }
    finally { setBusy(false); }
  };
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" data-rework-draft={draft.default ?? "unchosen"}>
      <h3 className="font-medium text-sm">{copy.reworkTitle}</h3>
      {reason && <p className="text-amber-700 text-xs dark:text-amber-400" data-rework-reason="">{reason}</p>}
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={copy.reworkTitle}>
        {draft.choices.map(item => (
          <DialogChoice key={item} size="sm" role="radio" aria-checked={choice === item} selected={choice === item} data-rework-choice={item}
            title={label[item]} detail={item === "keep-plan" && draft.keepPlanStartsAt === null ? copy.reworkKeepPlanMaybeReconfirm : undefined} onClick={() => setChoice(item)} />
        ))}
      </div>
      {failed && <p role="alert" className="text-destructive text-xs" data-rework-failed="">{failed}</p>}
      {remote && busy && <p role="status" className="text-muted-foreground text-xs" data-rework-sending="">{formatWorkbench(copy.remoteSending, { computer: remote.computer })}</p>}
      {remote?.offline && <p role="status" className="text-muted-foreground text-xs">{formatWorkbench(copy.remoteOffline, { computer: remote.computer })}</p>}
      <Button type="button" className="self-end pointer-coarse:h-11" disabled={busy || !choice || Boolean(remote?.offline)} onClick={() => void start()}>{copy.reworkStart}</Button>
    </section>
  );
}
