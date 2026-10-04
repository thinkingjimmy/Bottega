/**
 * [INPUT]: Depends on existing ledger v7 manual intent and frozen cloud mutation custody
 * [OUTPUT]: Freezes a handoff command, records its verified SQLite publication proof, and settles a persisted, confirmed handoff to its proof alone (C-03)
 * [POS]: Pure ledger mutations; RelayLedger remains the only durable writer
 */
import { messageSchema } from "../../../../chats/schema/chat-schema";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import { cloudMutationSchema, handoffIdentity, type CloudMutation } from "../../../../chats/sqlite/cloud/protocol";
import type { LedgerState } from "../ledger-schema";
export function retainCloudEvidence(state: LedgerState, enabled: boolean) {
  if (!enabled) return;
  for (const intent of Object.values(state.manualIntents)) {
    if (intent.payload && !["settled", "failed"].includes(intent.phase)) intent.cloudSyncRequired = true;
  }
}
export function freezeCloudHandoff(state: LedgerState, intentId: string, raw: CloudMutation) {
  const command = cloudMutationSchema.parse(raw), intent = state.manualIntents[intentId];
  if (!intent || !intent.payload || command.action.type !== "handoff-turn" || command.action.evidence.ledgerIntentId !== intentId ||
    command.action.chatId !== intent.conversationId || command.action.evidence.userSeq !== intent.userSeq ||
    command.action.evidence.assistantSeq !== intent.assistantSeq || command.action.turnId !== intent.requestId ||
    command.action.evidence.noticeSeq !== intent.noticeSeq ||
    command.action.evidence.identityHash !== createHash("sha256").update(canonicalJson(handoffIdentity(command.action))).digest("hex")) throw new Error("LEDGER_HANDOFF_IDENTITY_CONFLICT");
  if (intent.cloudHandoff?.state === "settled") throw new Error("LEDGER_HANDOFF_CHANGED");
  if (intent.cloudHandoff) {
    if (canonicalJson(intent.cloudHandoff.command) === canonicalJson(command)) return intent.cloudHandoff;
    const prior = intent.cloudHandoff.command.action;
    if (intent.cloudHandoff.state !== "confirmed" || prior.type !== "handoff-turn" || prior.evidence.resultKind !== "pending" ||
        command.action.evidence.resultKind === "pending" || canonicalJson(handoffIdentity(prior)) !== canonicalJson(handoffIdentity(command.action))) throw new Error("LEDGER_HANDOFF_CHANGED");
  }
  const attempt = intent.attempts.at(-1), evidence = command.action.evidence;
  const dispatch = attempt && ["dispatched", "result-prepared", "persisted"].includes(attempt.phase) ? "dispatched" :
    !attempt || attempt.phase === "claimed" ? "not-started" : "outcome-unknown";
  if (canonicalJson(attempt ?? null) !== canonicalJson(evidence.attempt) || dispatch !== evidence.dispatch) throw new Error("LEDGER_HANDOFF_DISPATCH_CONFLICT");
  const user = messageSchema.parse({ ...(intent.userMessage as Record<string, unknown>), seq: intent.userSeq });
  if (canonicalJson(user) !== canonicalJson(command.action.evidence.userMessage)) throw new Error("LEDGER_HANDOFF_CONTENT_CONFLICT");
  const result = state.manualResultOutbox[intentId];
  const available = result && ["stored", "empty"].includes(result.outcome);
  if (available ? evidence.resultKind === "pending" || canonicalJson(result.assistantMessage ?? null) !== canonicalJson(evidence.resultMessage) :
    evidence.resultKind !== "pending" || evidence.resultMessage !== null || evidence.resultHash !== null) throw new Error("LEDGER_HANDOFF_RESULT_UNAVAILABLE");
  if (evidence.terminal && evidence.terminal !== result?.terminal || evidence.subagents &&
    canonicalJson(evidence.subagents) !== canonicalJson(result?.subagents ?? {})) throw new Error("LEDGER_HANDOFF_RESULT_UNAVAILABLE");
  intent.cloudHandoff = { command, state: "pending", proof: null };
  return intent.cloudHandoff;
}
export function confirmCloudHandoff(state: LedgerState, intentId: string, proof: { operationId: string; requestHash: string; sourceId: string; digest: string }) {
  const handoff = state.manualIntents[intentId]?.cloudHandoff;
  if (handoff?.state === "settled") {
    if (canonicalJson(handoff.proof) !== canonicalJson(proof)) throw new Error("LEDGER_HANDOFF_PROOF_CHANGED");
    return;
  }
  if (!handoff || handoff.command.operationId !== proof.operationId || handoff.command.requestHash !== proof.requestHash) throw new Error("LEDGER_HANDOFF_PROOF_CONFLICT");
  if (handoff.proof && canonicalJson(handoff.proof) !== canonicalJson(proof)) throw new Error("LEDGER_HANDOFF_PROOF_CHANGED");
  handoff.proof = proof;
  handoff.state = "confirmed";
  settleCloudHandoff(state, intentId);
}
/* C-03: an intent that is persisted in SQLite and whose handoff the cloud confirmed with its result is terminal for the
   ledger. The body lived in three places (the payload, the result outbox and the frozen handoff command) and the user's
   text in a fourth; from here only the dedup facts, the user message's id and hash, and the proof stay, so the ledger no longer carries a copy of every recent answer. Called from both
   ends, because persistence and confirmation can land in either order. */
export function settleCloudHandoff(state: LedgerState, intentId: string) {
  const intent = state.manualIntents[intentId], outbox = state.manualResultOutbox[intentId], handoff = intent?.cloudHandoff;
  if (!intent || !outbox || outbox.state !== "persisted" || handoff?.state !== "confirmed" || !handoff.proof) return;
  const action = handoff.command.action;
  if (action.type !== "handoff-turn" || action.evidence.resultKind === "pending") return;
  intent.cloudHandoff = { state: "settled", resultKind: action.evidence.resultKind, proof: handoff.proof };
  /* C-04: the user's text is the proof's too; its id serves duplicate admission and failure receipts, its hash dedup. */
  intent.userMessage = { id: (intent.userMessage as { id?: unknown } | undefined)?.id, hash: createHash("sha256").update(canonicalJson(intent.userMessage ?? null)).digest("hex") };
  delete intent.payload;
  delete outbox.assistantMessage;
  delete outbox.subagents;
}
