/**
 * [INPUT]: Depends on the existing submission, recovery and relay ledger.
 * [OUTPUT]: Returns the shared durable activity fence for Agent changes and local cloud preparation.
 * [POS]: Read-only admission policy; a cloud settlement never clears local unknown execution.
 */
import type { RelayLedger } from "../relay-ledger";
import type { AgentSwitchBlockReason } from "../../../../../shared/chat-agent/contracts";
export function ledgerActivityReason(ledger: Pick<RelayLedger, "read">, conversationId: string, ownIntentId?: string): AgentSwitchBlockReason | null {
  return ledger.read(state => {
    const others = <T extends { conversationId: string }>(items: Record<string, T>) => Object.entries(items)
      .filter(([id, item]) => id !== ownIntentId && item.conversationId === conversationId).map(([, item]) => item);
    if (others(state.submissionReservations).some(item => item.state === "reserved")) return "submission";
    if (others(state.manualIntents).some(item => !["settled", "failed"].includes(item.phase))) return "submission";
    if (others(state.manualIntents).some(item => item.attempts.at(-1)?.phase === "unknown")) return "recovery";
    if (others(state.steerIntents).some(item => item.ackedAt === undefined)) return "submission";
    if (others(state.manualResultOutbox).some(item => item.state !== "persisted")) return "recovery";
    if (others(state.submissionOutcomes).some(item => item.retry === "reconcile")) return "recovery";
    if (others(state.retryCapsules).some(item => item.state !== "expired")) return "recovery";
    const relays = Object.values(state.relays).filter(item => item.target.chatId === conversationId || item.source.chatId === conversationId);
    if (relays.some(item => item.pauseReason && item.deliveryPhase !== "settled")) return "paused";
    if (relays.some(item => item.deliveryPhase !== "settled" || item.assistantOutbox?.state === "pending")) return "queue";
    if (Object.values(state.noticeOutbox).some(item => item.chatId === conversationId && item.state === "pending")) return "recovery";
    return null;
  });
}
