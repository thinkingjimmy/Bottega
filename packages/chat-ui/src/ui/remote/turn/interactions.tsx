/**
 * [INPUT]: Depends on safe live interaction projections, immutable command receipts and controlled response callbacks.
 * [OUTPUT]: Places shared approval/question cards around or in the composer, with sequential answers, receipt-based pending states and shared interaction results.
 * [POS]: Shared remote interaction surface; recovery follows the platform declaration; unrepresentable decisions remain unavailable.
 */
import { RemoteRecovery } from "./recovery";
import { actionPending } from "./state";
import { ChatApprovalCard } from "../../conversation/interactions/approval";
import { ChatUserInputSelector } from "../../conversation/interactions/questions";
import type { ApprovalDecision } from "../../conversation/interactions/model";
import { InteractionTranslation } from "../../conversation/interactions/translation";
import { useComposerTranslation, type ComposerTranslate } from "../../composer/controls/copy/translation";
import { InteractionResults } from "./interaction-results";
import { reasonCopy } from "../delivery/receipts";
import { useEffect, useState, type ReactNode } from "react";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import type { RemoteCommand, RemoteCommandInput } from "../../../platform/remote/contracts";
import type { RemoteEntry } from "../../../platform/remote/commands/session";
import type { RemoteCopy } from "../../../i18n/messages/remote";
export type RemoteAction = RemoteCommandInput["payload"];
export type RemoteInteractionControls = { recoveryEnabled?: boolean; locale?: string; backendName?: string; computer?: string | null; entries: RemoteEntry[]; disabled: boolean; copy: RemoteCopy; submit(payload: RemoteAction): Promise<RemoteCommand | null>; draftChanged?(key: string, dirty: boolean): void };
/** The settled answer to this interaction, whoever produced it: an `already-resolved` one names the winner. */
function settled(entries: RemoteEntry[], matches: (payload: RemoteAction) => boolean) {
  return entries.find(entry => matches(entry.input.payload) && (entry.receipt?.result === "already-resolved" || entry.receipt?.state === "done"))?.receipt ?? null;
}
/** Normal approvals sit above the editor; Plan review and questions own its slot. */
export function RemoteInteractions({ projection, requestId, controls, running, ready, children, planDecision }: {
  projection: LiveProjection | null; requestId: string; controls: RemoteInteractionControls; running: boolean; ready: boolean;
  children?: ReactNode; planDecision?: ReactNode;
}) {
  const { copy, entries, submit } = controls;
  const disabled = controls.disabled || !ready || !running, active = projection?.phase === "active" || projection?.phase === "starting";
  const translate = useComposerTranslation(controls.locale ?? "en");
  const t: ComposerTranslate = (key, values) => translate(key.replace(/^chat\.composer\./, ""), values);
  const approvals = projection?.approvals.filter(approval => !settled(entries, payload => payload.kind === "respond-approval" && payload.requestId === requestId && payload.approvalId === approval.approvalId)) ?? [];
  const questions = projection?.userInputs.filter(input => !settled(entries, payload => payload.kind === "respond-user-input" && payload.requestId === requestId && payload.userInputId === input.userInputId)) ?? [];
  const planReview = approvals.find(approval => approval.purpose === "plan-review");
  const renderApproval = (approval: NonNullable<typeof projection>["approvals"][number]) => {
    const matches = (payload: RemoteAction) => payload.kind === "respond-approval" && payload.requestId === requestId && payload.approvalId === approval.approvalId;
    const choices = approval.choices?.filter(choice => choice.decision !== undefined).map(choice => ({ ...choice, decision: choice.decision as ApprovalDecision }));
    const allowed = approval.remoteAllowed === true && active && (!approval.choices?.length || Boolean(choices?.length));
    const last = entries.filter(entry => matches(entry.input.payload)).at(-1), failed = last?.rejected || last?.receipt && ["error", "expired", "rejected"].includes(last.receipt.state);
    return <div key={approval.approvalId}><ChatApprovalCard approval={{ ...approval, choices }} backendDisplayName={controls.backendName ?? "Agent"}
      busy={disabled || !allowed || actionPending(entries, matches)} error={failed ? reasonCopy(last?.receipt?.reason ?? "admission-failed", copy) : undefined}
      onDecision={decision => void submit({ kind: "respond-approval", requestId, approvalId: approval.approvalId, decision })} />
      {!allowed && <p className="mb-2 text-xs text-muted-foreground">{copy.localOnly}</p>}</div>;
  };
  return <InteractionTranslation.Provider value={t}>
    <InteractionResults results={projection?.interactionResults} copy={copy} />
    {controls.recoveryEnabled !== false && projection?.phase === "resume-failed" && projection.recovery && <RemoteRecovery key={projection.recovery.retryToken} recovery={projection.recovery} requestId={requestId} controls={{ ...controls, disabled }} />}
    {approvals.filter(approval => approval.purpose !== "plan-review").map(renderApproval)}
    {planReview ? renderApproval(planReview) : questions[0] ? <RemoteQuestions key={questions[0].userInputId} input={questions[0]} queue={questions} requestId={requestId} controls={controls} disabled={disabled || !active} /> : planDecision ?? children}
  </InteractionTranslation.Provider>;
}
function RemoteQuestions({ input, queue, requestId, controls, disabled }: {
  input: LiveProjection["userInputs"][number]; queue: LiveProjection["userInputs"]; requestId: string; controls: RemoteInteractionControls; disabled: boolean;
}) {
  const { copy, entries, submit, draftChanged } = controls;
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, { answers: string[] }>>({}), [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [edited, setEdited] = useState(false);
  const matches = (payload: RemoteAction) => payload.kind === "respond-user-input" && payload.requestId === requestId && payload.userInputId === input.userInputId;
  const pending = actionPending(entries, matches), done = settled(entries, matches);
  const dirty = !pending && !done && (edited || Object.keys(answers).length > 0);
  useEffect(() => { draftChanged?.(`${requestId}:question:${input.userInputId}`, dirty); }, [draftChanged, requestId, input.userInputId, dirty]);
  useEffect(() => () => draftChanged?.(`${requestId}:question:${input.userInputId}`, false), [draftChanged, requestId, input.userInputId]);
  if (done) return null;
  if (input.questions.some(question => question.isSecret)) return <p className="mb-2 text-sm text-muted-foreground">{copy.localOnly}</p>;
  const answer = (values: string[]) => {
    if (disabled || pending || busy) return;
    const question = input.questions[index]; if (!question) return;
    const next = { ...answers, [question.id]: { answers: values } }; setAnswers(next);
    if (index + 1 < input.questions.length) { setIndex(index + 1); return; }
    setBusy(true); setError("");
    void submit({ kind: "respond-user-input", requestId, userInputId: input.userInputId, answers: next }).then(receipt => { if (!receipt) setError(copy.requestFailed); }, () => setError(copy.requestFailed)).finally(() => setBusy(false));
  };
  const last = entries.filter(entry => matches(entry.input.payload)).at(-1);
  const failed = last?.rejected || last?.receipt && ["error", "expired", "rejected"].includes(last.receipt.state);
  return <ChatUserInputSelector onDirtyChange={setEdited} pending={{ request: input, index, queue, busy: disabled || pending || busy, error: error || (failed ? reasonCopy(last?.receipt?.reason ?? "admission-failed", copy) : ""), expiresAt: input.expiresAt }} onAnswer={answer} />;
}
