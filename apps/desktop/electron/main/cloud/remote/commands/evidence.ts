/**
 * [INPUT]: Depends on original ledger admissions/results, SQLite terminal receipts and exact live TurnRegistry recovery ownership.
 * [OUTPUT]: Exports durable command admission independently of result storage, and projects canonical status with conservative recovery.
 * [POS]: Read-only command receipt projection; it neither finalizes transcript content nor launches retries.
 */
import { canonicalHash } from "../../../sections/coordinator/coordinator-values";
import type { RemoteAdmission, RemoteCommandReport } from "@ai-chat/cloud-protocol/remote/model";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { RemoteContext } from "../../../sections/coordinator/remote/model";
import type { ChatStore } from "../../../chats/chat-store";
import type { TurnRegistry } from "../../../turn-registry";
import type { BridgeEntry } from "../../../agent/bridge-types";
export async function commandEvidence(context: RemoteContext, ports: { ledger: RelayLedger; store: ChatStore;
  turns: Pick<TurnRegistry, "byRequest">; current(): void }, blockedBy: Extract<RemoteCommandReport, { state: "accepted" }>["blockedBy"] = null): Promise<RemoteCommandReport | null> {
  const admission = commandAdmission(context, ports.ledger); if (!admission) return null;
  const id = context.origin.commandId;
  const terminal = (state: "done" | "error" | "cancelled"): RemoteCommandReport => ({ state, admission, result: null, reason: state === "error" ? "execution-failed" : null });
  const withdrawal = ports.ledger.remote.control(requireWithdrawalId(context));
  if (withdrawal?.state === "applied" && withdrawal.output?.kind === "queue-withdrawal") {
    ports.current(); return { state: "cancelled", admission, result: null, reason: null, output: withdrawal.output };
  }
  const canonical = await ports.store.sync.read(context.scope, { type: "turn-receipt", turnId: admission.requestId }); ports.current();
  if (canonical.type === "turn-receipt" && canonical.value?.settlementState === "settled") {
    const receipt = canonical.value;
    if (receipt.chatId !== context.chatId || receipt.incarnationId !== context.incarnationId ||
      receipt.ownerDeviceId !== context.targetDeviceId || receipt.userMessageId !== admission.userMessageId) throw new Error("REMOTE_RESULT_IDENTITY_CHANGED");
    if (receipt.terminalKind) return terminal(receipt.terminalKind);
    return { state: "outcome-unknown", admission, reason: "outcome-unknown" };
  }
  const state = ports.ledger.snapshot(), intent = state.manualIntents[id], result = state.manualResultOutbox[id];
  if (result && ["stored", "empty"].includes(result.outcome) && result.terminal) return terminal(result.terminal);
  const entry = ports.turns.byRequest(admission.requestId) as BridgeEntry | undefined;
  if (entry?.conversationId === context.chatId && entry.incarnationId === context.incarnationId && !entry.effectiveTerminal) {
    if (entry.phase === "starting" || entry.phase === "active") return { state: "running", admission };
    // The old process can be gone while the original retry still owns its frozen inputs.
    const recovery = !entry.sourceTerminal && !entry.finalizeInFlight && entry.payload?.requestId === admission.requestId &&
      entry.payload.session && entry.context && entry.resolvedInput &&
      (entry.phase === "resume-failed" && entry.resumeRetryToken || entry.phase === "retry-claiming" && entry.retryClaim?.generation === entry.generation);
    if (recovery) return { state: "running", admission };
  }
  const attempt = intent?.attempts.at(-1);
  if (!intent || attempt && attempt.phase !== "claimed") return { state: "outcome-unknown", admission, reason: "outcome-unknown" };
  if (intent.phase === "failed") {
    const withdrawn = Object.values(state.controlReceipts).some(receipt => receipt.state === "applied" && receipt.conversationId === context.chatId &&
      (receipt.payload as { kind?: string; intentId?: string })?.kind === "withdraw-queued" && (receipt.payload as { intentId: string }).intentId === id);
    return terminal(withdrawn ? "cancelled" : "error");
  }
  return { state: "accepted", admission, blockedBy };
}

/** Durable admission remains authoritative even while canonical result storage is unavailable. */
export function commandAdmission(context: RemoteContext, ledger: RelayLedger): RemoteAdmission | null {
  const known = ledger.remote.lookup(context); if (!known?.accepted) return null;
  const submission = known.submission;
  if (submission.persistence.kind !== "append") throw new Error("REMOTE_SUBMISSION_IDENTITY_CHANGED");
  return { intentId: context.origin.commandId, submissionHash: known.submissionHash,
    requestId: submission.turn.requestId, userMessageId: submission.persistence.input.message.id };
}

const requireWithdrawalId = (context: RemoteContext) => canonicalHash(["withdraw-unpersisted", context]);
