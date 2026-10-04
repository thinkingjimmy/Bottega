/**
 * [INPUT]: Depends on immutable command entries, receipt recovery actions and shared remote copy.
 * [OUTPUT]: Presents canonical command states (one the owning computer has not admitted waits for it by name, B-01, with a local-only Stop waiting beside the warning that it may already have run — ruling 12;a transferred Steer reads "will send after this turn"; one refused because its turn had ended offers Send as a new message — steerTurnEnded), TTL deadlines, a command refused for a changed connection as reconnecting while its one resend is pending and as kept when that fails (TASK-20 D10), plan (entitlement/quota) refusals, explicit safe retry and distinct new execution actions.
 * [POS]: Shared delivery feedback; an unknown transport or execution never synthesizes success.
 */
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import { awaitingReport, awaitingResubmit, type RemoteEntry, type RemoteCommandSession } from "../../../platform/remote/commands/session";
import { handledElsewhereBlock } from "../composer/status";
import type { RemoteCopy } from "../../../i18n/messages/remote";
export function RemoteReceipts({ entries, session, copy, locale, computer, reexecute, sendAsNew, sentAsNew, disabled, reexecuteDisabled, stopped, stopWaiting }: {
  entries: RemoteEntry[]; session: RemoteCommandSession; copy: RemoteCopy; locale: string; disabled?: boolean; reexecuteDisabled?: boolean; reexecute(entry: RemoteEntry): void;
  /** The owning computer's name, which a command it has not admitted waits for. */
  computer?: string | null;
  /** Resends a guidance message whose turn had ended as a new message, reusing its uploaded files. */
  sendAsNew?(entry: RemoteEntry): void; sentAsNew?: ReadonlySet<string>;
  /** Ruling 12: commands this controller stopped waiting for, and the local-only action that adds one. */
  stopped?: ReadonlySet<string>; stopWaiting?(entry: RemoteEntry): void;
}) {
  // A command that was resent is shown by its resend.
  return <ul className="chat-remote-receipts">{entries.filter(entry => !entry.resubmittedAs).map(entry => {
    const receipt = entry.receipt, state = receipt?.state, retryable = !receipt || entry.uncertain || state === "pending" || state === "claimed";
    const resending = awaitingResubmit(entry), connection = connectionNotice(entry, copy, computer);
    const canReexecute = !resending && entry.input.payload.kind === "start-turn" && (Boolean(entry.rejected) || !receipt?.admission && ["expired", "rejected"].includes(state ?? ""));
    const canSendAsNew = Boolean(sendAsNew) && steerTurnEnded(entry) && !sentAsNew?.has(entry.input.commandId);
    const waiting = Boolean(computer) && awaitingReport(entry), isStopped = waiting && Boolean(stopped?.has(entry.input.commandId));
    return <li className="chat-remote-receipt" key={entry.input.commandId} data-command-id={entry.input.commandId}>
      <p role="status">{resending ? connection : receiptStatus(entry, copy, computer, isStopped)}</p>
      {waiting && <p className="chat-remote-hint" data-stop-waiting-warning>{formatCopy(copy.stopWaitingWarning, { name: computer! })}</p>}
      {entry.uncertain && <p>{copy.receiptUnknown}</p>}
      {state === "outcome-unknown" && <p>{copy.unknownDetail}</p>}
      {receipt?.blockedBy && <p>{copy.blockedBy}</p>}
      {receipt?.reason && !resending && <p className="chat-remote-hint">{steerTurnEnded(entry) ? copy.turnEnded : connection ?? reasonCopy(receipt.reason, copy)}</p>}
      {receipt && (state === "pending" || state === "claimed") && <p className="chat-remote-hint">{copy.expires.replace("{time}", new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(receipt.command.expiresAt))}</p>}
      <div className="chat-remote-receipt-actions">
        {!entry.rejected && (retryable || state === "outcome-unknown") && <Button type="button" variant="outline" disabled={entry.busy || disabled} onClick={() => void session.check(entry.input.commandId)}>{copy.check}</Button>}
        {retryable && <Button type="button" variant="outline" disabled={entry.busy || disabled} onClick={() => void session.retry(entry.input.commandId)}>{copy.retry}</Button>}
        {canReexecute && <Button type="button" variant="outline" disabled={entry.busy || disabled || reexecuteDisabled} onClick={() => reexecute(entry)}>{copy.executeAgain}</Button>}
        {waiting && !isStopped && stopWaiting && <Button type="button" variant="outline" onClick={() => stopWaiting(entry)}>{copy.stopWaiting}</Button>}
        {canSendAsNew && <Button type="button" variant="outline" disabled={entry.busy || disabled || reexecuteDisabled} onClick={() => sendAsNew!(entry)}>{copy.sendAsNew}</Button>}
      </div>
    </li>;
  })}</ul>;
}
/** TASK-20 D10: a command refused for a changed connection is being resent once, or its resend failed too; null for any other receipt. */
export function connectionNotice(entry: RemoteEntry, copy: RemoteCopy, computer?: string | null): string | null {
  if (entry.receipt?.reason !== "connection-changed" || entry.receipt.admission || entry.resubmittedAs) return null;
  return formatCopy(awaitingResubmit(entry) ? copy.reconnectSending : copy.reconnectFailed, { name: computer ?? copy.computer });
}
/** A guidance message refused because its turn had already ended (R9): nothing ran, so it may go out as a new message. */
export function steerTurnEnded(entry: Pick<RemoteEntry, "input" | "receipt">): boolean {
  return entry.input.payload.kind === "steer" && !entry.receipt?.admission && entry.receipt?.state === "rejected" && entry.receipt.reason === "request-not-active";
}
/** A guidance message the running turn could not take is already queued on the computer as the next turn. */
export function receiptStatus(entry: Pick<RemoteEntry, "receipt" | "busy" | "rejected">, copy: RemoteCopy, computer?: string | null, stopped = false): string {
  const receipt = entry.receipt, state = receipt?.state;
  /* B-01 (ruling 12): until its computer admits it, a command waits for that computer by name; only an admitted one has an
     outcome to be unknown. */
  if (computer && receipt && !receipt.admission && (state === "pending" || state === "claimed" || state === "outcome-unknown"))
    return formatCopy(stopped ? copy.stoppedWaiting : copy.awaitingReport, { name: computer });
  if (state === "done" && receipt?.output?.kind === "steer" && receipt.output.outcome === "transferred") return copy.steerTransferred;
  return handledElsewhereBlock(copy, receipt)?.reason ?? (state ? copy[state] : entry.busy ? copy.sending : entry.rejected ? rejectionCopy(entry.rejected, copy) : copy.receiptUnknown);
}
/** An admission refusal stored nothing; plan refusals say why, rate and capacity refusals say to retry. */
export function rejectionCopy(rejected: string, copy: RemoteCopy): string {
  return rejected === "entitlement-required" ? copy.entitlementRequired : rejected === "quota-exceeded" ? copy.quotaExceeded : copy.admissionLimited;
}
export function reasonCopy(reason: string, copy: RemoteCopy): string {
  if (reason === "not-owner") return copy.notOwner;
  if (["agent-revision-changed", "fact-revision-changed", "identity-changed", "chat-incarnation-mismatch"].includes(reason)) return copy.chatChanged;
  if (reason === "remote-disabled") return copy.disabled;
  if (reason === "protocol-mismatch") return copy.update;
  if (reason === "device-offline" || reason === "connection-changed") return copy.chooseOnline;
  if (reason === "device-revoked" || reason === "source-revoked") return copy.revoked;
  if (reason === "project-path-unbound") return copy.projectUnbound;
  if (reason === "agent-missing") return copy.agentMissing.replace("{agent}", copy.agent);
  if (reason === "agent-outdated") return copy.agentOutdated.replace("{agent}", copy.agent);
  if (reason === "auth-required") return copy.authRequired.replace("{agent}", copy.agent);
  if (reason === "already-dispatched") return copy.alreadyDispatched;
  if (reason === "queue-changed") return copy.queueChanged;
  if (reason === "capacity-exceeded") return copy.admissionLimited;
  if (reason === "entitlement-required") return copy.entitlementRequired;
  if (reason === "quota-exceeded") return copy.quotaExceeded;
  if (reason === "admission-failed") return copy.requestFailed;
  if (reason === "agent-unavailable") return copy.noAgent;
  if (["permission-required", "request-not-active", "local-facts-pending"].includes(reason)) return copy.localOnly;
  if (reason === "outcome-unknown") return copy.unknownDetail;
  if (reason === "command-expired" || reason === "interaction-expired") return copy.expired;
  if (["execution-not-ready", "body-unavailable", "chat-home-unavailable", "project-unavailable"].includes(reason)) return copy.preparationFailed;
  return copy.requestFailed;
}
