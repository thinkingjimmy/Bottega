/**
 * [INPUT]: Depends on immutable command entries, receipt recovery actions and shared remote copy.
 * [OUTPUT]: Presents canonical command states, TTL deadlines, explicit safe retry and distinct new execution actions.
 * [POS]: Shared delivery feedback; an unknown transport or execution never synthesizes success.
 */
import { Button } from "@ai-chat/ui/components/ui/button";
import type { RemoteEntry, RemoteCommandSession } from "../../../platform/remote/commands/session";
import { handledElsewhereBlock } from "../composer/status";
import type { RemoteCopy } from "../../../i18n/remote";
export function RemoteReceipts({ entries, session, copy, locale, reexecute, disabled, reexecuteDisabled }: {
  entries: RemoteEntry[]; session: RemoteCommandSession; copy: RemoteCopy; locale: string; disabled?: boolean; reexecuteDisabled?: boolean; reexecute(entry: RemoteEntry): void;
}) {
  return <ul className="chat-remote-receipts">{entries.map(entry => {
    const receipt = entry.receipt, state = receipt?.state, retryable = !receipt || entry.uncertain || state === "pending" || state === "claimed";
    const canReexecute = entry.input.payload.kind === "start-turn" && (Boolean(entry.rejected) || !receipt?.admission && ["expired", "rejected"].includes(state ?? ""));
    return <li className="chat-remote-receipt" key={entry.input.commandId} data-command-id={entry.input.commandId}>
      <p role="status">{handledElsewhereBlock(copy, receipt)?.reason ?? (state ? copy[state] : entry.busy ? copy.sending : entry.rejected ? copy.admissionLimited : copy.receiptUnknown)}</p>
      {entry.uncertain && <p>{copy.receiptUnknown}</p>}
      {state === "outcome-unknown" && <p>{copy.unknownDetail}</p>}
      {receipt?.blockedBy && <p>{copy.blockedBy}</p>}
      {receipt?.reason && <p className="chat-remote-hint">{reasonCopy(receipt.reason, copy)}</p>}
      {receipt && (state === "pending" || state === "claimed") && <p className="chat-remote-hint">{copy.expires.replace("{time}", new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(receipt.command.expiresAt))}</p>}
      <div className="chat-remote-receipt-actions">
        {!entry.rejected && (retryable || state === "outcome-unknown") && <Button type="button" variant="outline" disabled={entry.busy || disabled} onClick={() => void session.check(entry.input.commandId)}>{copy.check}</Button>}
        {retryable && <Button type="button" variant="outline" disabled={entry.busy || disabled} onClick={() => void session.retry(entry.input.commandId)}>{copy.retry}</Button>}
        {canReexecute && <Button type="button" variant="outline" disabled={entry.busy || disabled || reexecuteDisabled} onClick={() => reexecute(entry)}>{copy.executeAgain}</Button>}
      </div>
    </li>;
  })}</ul>;
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
  if (reason === "admission-failed") return copy.requestFailed;
  if (reason === "agent-unavailable") return copy.noAgent;
  if (["permission-required", "request-not-active", "local-facts-pending"].includes(reason)) return copy.localOnly;
  if (reason === "outcome-unknown") return copy.unknownDetail;
  if (reason === "command-expired" || reason === "interaction-expired") return copy.expired;
  if (["execution-not-ready", "body-unavailable", "chat-home-unavailable", "project-unavailable"].includes(reason)) return copy.preparationFailed;
  return copy.requestFailed;
}
