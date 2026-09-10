/**
 * [INPUT]: Depends on existing ledger v7 manual intent and frozen cloud mutation custody
 * [OUTPUT]: Freezes a handoff command and records its verified SQLite publication proof
 * [POS]: Pure ledger mutations; RelayLedger remains the only durable writer
 */
import { messageSchema } from "../../../../chats/chat-schema";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import { cloudMutationSchema, handoffIdentity, type CloudMutation } from "../../../../chats/sqlite/cloud/protocol";
import type { LedgerState } from "../ledger-schema";
export function freezeCloudHandoff(state: LedgerState, intentId: string, raw: CloudMutation) {
  const command = cloudMutationSchema.parse(raw), intent = state.manualIntents[intentId];
  if (!intent || !intent.payload || command.action.type !== "handoff-turn" || command.action.evidence.ledgerIntentId !== intentId ||
    command.action.chatId !== intent.conversationId || command.action.evidence.userSeq !== intent.userSeq ||
    command.action.evidence.assistantSeq !== intent.assistantSeq || command.action.turnId !== intent.requestId ||
    command.action.evidence.executorNoticeSeq !== intent.executorNoticeSeq || command.action.evidence.noticeSeq !== intent.noticeSeq ||
    command.action.evidence.identityHash !== createHash("sha256").update(canonicalJson(handoffIdentity(command.action))).digest("hex")) throw new Error("LEDGER_HANDOFF_IDENTITY_CONFLICT");
  if (intent.cloudHandoff) {
    if (canonicalJson(intent.cloudHandoff.command) !== canonicalJson(command)) throw new Error("LEDGER_HANDOFF_CHANGED");
    return intent.cloudHandoff;
  }
  const attempt = intent.attempts.at(-1), evidence = command.action.evidence;
  const dispatch = attempt && ["dispatched", "result-prepared", "persisted"].includes(attempt.phase) ? "dispatched" :
    attempt?.phase === "claimed" ? "not-started" : "outcome-unknown";
  if (!attempt || canonicalJson(attempt) !== canonicalJson(evidence.attempt) || dispatch !== evidence.dispatch) throw new Error("LEDGER_HANDOFF_DISPATCH_CONFLICT");
  const user = messageSchema.parse({ ...(intent.userMessage as Record<string, unknown>), seq: intent.userSeq });
  if (canonicalJson(user) !== canonicalJson(command.action.evidence.userMessage)) throw new Error("LEDGER_HANDOFF_CONTENT_CONFLICT");
  const result = state.manualResultOutbox[intentId];
  if (!result || result.outcome === "missing" || result.outcome === "failed" ||
      canonicalJson(result.assistantMessage ?? null) !== canonicalJson(command.action.evidence.resultMessage)) throw new Error("LEDGER_HANDOFF_RESULT_UNAVAILABLE");
  intent.cloudHandoff = { command, state: "pending", proof: null };
  return intent.cloudHandoff;
}
export function confirmCloudHandoff(state: LedgerState, intentId: string, proof: { operationId: string; requestHash: string; sourceId: string; digest: string }) {
  const handoff = state.manualIntents[intentId]?.cloudHandoff;
  if (!handoff || handoff.command.operationId !== proof.operationId || handoff.command.requestHash !== proof.requestHash) throw new Error("LEDGER_HANDOFF_PROOF_CONFLICT");
  if (handoff.proof && canonicalJson(handoff.proof) !== canonicalJson(proof)) throw new Error("LEDGER_HANDOFF_PROOF_CHANGED");
  handoff.proof = proof;
  handoff.state = "confirmed";
}
