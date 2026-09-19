/**
 * [INPUT]: Depends on safe live interaction projections, immutable command receipts and controlled response callbacks.
 * [OUTPUT]: Provides Stop and shared native approval/question cards with sequential answers, receipt-based pending states and winning-device completion notices.
 * [POS]: Shared remote interaction surface; recovery follows the platform declaration; unrepresentable decisions remain unavailable.
 */
import { RemoteRecovery } from "./recovery";
import { ChatApprovalCard } from "../../conversation/interactions/approval";
import { ChatUserInputSelector } from "../../conversation/interactions/questions";
import type { ApprovalDecision } from "../../conversation/interactions/model";
import { InteractionTranslation } from "../../conversation/interactions/translation";
import { useComposerTranslation, type ComposerTranslate } from "../../composer/controls/copy/translation";
import { InteractionResults } from "./interaction-results";
import { useEffect, useState } from "react";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { RemoteCommand, RemoteCommandInput } from "../../../platform/remote/contracts";
import type { RemoteEntry } from "../../../platform/remote/commands/session";
import type { RemoteCopy } from "../../../i18n/remote";
export type RemoteAction = RemoteCommandInput["payload"];
export type RemoteInteractionControls = { recoveryEnabled?: boolean; locale?: string; backendName?: string; entries: RemoteEntry[]; disabled: boolean; copy: RemoteCopy; submit(payload: RemoteAction): Promise<RemoteCommand | null>; draftChanged?(key: string, dirty: boolean): void };
const finished = new Set(["done", "cancelled", "error", "expired", "rejected"]);
function actionPending(entries: RemoteEntry[], matches: (payload: RemoteAction) => boolean) {
  return entries.some(entry => matches(entry.input.payload) && (entry.busy || !entry.rejected && (entry.uncertain || !entry.receipt || !finished.has(entry.receipt.state))));
}
function resolved(entries: RemoteEntry[], matches: (payload: RemoteAction) => boolean) {
  return entries.some(entry => matches(entry.input.payload) && (entry.receipt?.result === "already-resolved" || entry.receipt?.state === "done"));
}
export function RemoteInteractions({ projection, requestId, controls, running, ready }: {
  projection: LiveProjection | null; requestId: string; controls: RemoteInteractionControls; running: boolean; ready: boolean;
}) {
  const { copy, entries, submit } = controls;
  const disabled = controls.disabled || !ready || !running, active = projection?.phase === "active" || projection?.phase === "starting";
  const cancelPending = actionPending(entries, payload => payload.kind === "cancel" && payload.requestId === requestId);
  const translate = useComposerTranslation(controls.locale ?? "en");
  const t: ComposerTranslate = (key, values) => translate(key.replace(/^chat\.composer\./, ""), values);
  return <InteractionTranslation.Provider value={t}><div className="chat-remote">
    <InteractionResults results={projection?.interactionResults} copy={copy} />
    {running && <div className="chat-remote-receipt-actions"><Button type="button" variant="outline" disabled={disabled || cancelPending} onClick={() => void submit({ kind: "cancel", requestId })}>{copy.stop}</Button></div>}
    {controls.recoveryEnabled !== false && projection?.phase === "resume-failed" && projection.recovery && <RemoteRecovery key={projection.recovery.retryToken} recovery={projection.recovery} requestId={requestId} controls={{ ...controls, disabled }} />}
    {/* Only a request the viewer cannot answer needs the executor: a sealing or settling turn has nothing pending. */}
    {!active && !projection?.recovery && Boolean(projection?.approvals.length || projection?.userInputs.length) && <p className="chat-remote-hint">{copy.localOnly}</p>}
    {projection?.approvals.map(approval => {
      const matches = (payload: RemoteAction) => payload.kind === "respond-approval" && payload.requestId === requestId && payload.approvalId === approval.approvalId;
      if (resolved(entries, matches)) return <p role="status" key={approval.approvalId}>{copy.alreadyResolved}</p>;
      const choices = approval.choices?.filter(choice => choice.decision !== undefined).map(choice => ({ ...choice, decision: choice.decision as ApprovalDecision }));
      const allowed = approval.remoteAllowed === true && active && (!approval.choices?.length || Boolean(choices?.length));
      return <div key={approval.approvalId}><ChatApprovalCard approval={{ ...approval, choices }} backendDisplayName={controls.backendName ?? "Agent"}
        busy={disabled || !allowed || actionPending(entries, matches)} onDecision={decision => void submit({ kind: "respond-approval", requestId, approvalId: approval.approvalId, decision })} />
        {!allowed && <p>{copy.localOnly}</p>}</div>;
    })}
    {projection?.userInputs.map(input => <RemoteQuestions key={input.userInputId} input={input} queue={projection.userInputs} requestId={requestId} controls={controls} disabled={disabled || !active} />)}
  </div></InteractionTranslation.Provider>;
}
function RemoteQuestions({ input, queue, requestId, controls, disabled }: {
  input: LiveProjection["userInputs"][number]; queue: LiveProjection["userInputs"]; requestId: string; controls: RemoteInteractionControls; disabled: boolean;
}) {
  const { copy, entries, submit, draftChanged } = controls;
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, { answers: string[] }>>({}), [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [edited, setEdited] = useState(false);
  const matches = (payload: RemoteAction) => payload.kind === "respond-user-input" && payload.requestId === requestId && payload.userInputId === input.userInputId;
  const pending = actionPending(entries, matches), done = resolved(entries, matches);
  const dirty = !pending && !done && (edited || Object.keys(answers).length > 0);
  useEffect(() => { draftChanged?.(`${requestId}:question:${input.userInputId}`, dirty); }, [draftChanged, requestId, input.userInputId, dirty]);
  useEffect(() => () => draftChanged?.(`${requestId}:question:${input.userInputId}`, false), [draftChanged, requestId, input.userInputId]);
  if (done) return <p role="status">{copy.alreadyResolved}</p>;
  if (input.questions.some(question => question.isSecret)) return <section className="chat-remote-interaction"><p>{copy.localOnly}</p></section>;
  const answer = (values: string[]) => {
    if (disabled || pending || busy) return;
    const question = input.questions[index]; if (!question) return;
    const next = { ...answers, [question.id]: { answers: values } }; setAnswers(next);
    if (index + 1 < input.questions.length) { setIndex(index + 1); return; }
    setBusy(true); setError("");
    void submit({ kind: "respond-user-input", requestId, userInputId: input.userInputId, answers: next }).then(receipt => { if (!receipt) setError(copy.requestFailed); }, () => setError(copy.requestFailed)).finally(() => setBusy(false));
  };
  return <ChatUserInputSelector onDirtyChange={setEdited} pending={{ request: input, index, queue, busy: disabled || pending || busy, error, expiresAt: input.expiresAt }} onAnswer={answer} />;
}
