/**
 * [INPUT]: Depends on canonical Chat facts, coordinator activity, and the existing submission/relay ledger
 * [OUTPUT]: Provides read-only switch eligibility and exact source-Agent admission fences
 * [POS]: Main switch policy shared by selector queries, admission, and queued commits
 */

import type { CoordinatorDependencies } from "../coordinator-runtime";
import { conversationAvailability } from "../coordinator-runtime";
import type { AgentSwitchBlockReason, AgentSwitchEligibility } from "../../../../../shared/chat-agent/contracts";
import type { TrustedManualTurnSubmission } from "../../../../../shared/sections-ipc";
import { agentSwitchIntentSchema } from "../../../../../shared/chat-agent/schema";
import { canonicalHash } from "../coordinator-values";

export function switchEligibility(dependencies: CoordinatorDependencies, conversationId: string,
  options: { ownIntentId?: string; recovering?: boolean; running?: boolean } = {}): AgentSwitchEligibility {
  const chat = dependencies.chats.store.getMetadata(conversationId);
  if (!chat) throw new Error("Chat does not exist");
  let reason: AgentSwitchBlockReason | null = chat.readOnlyReason ? "readonly"
    : chat.context.kind !== "ordinary" ? "app-bound"
    : conversationAvailability(dependencies, conversationId, chat.projectId) !== "open" || chat.archivedAt ? "archived"
    : options.recovering ? "recovery"
    : dependencies.switchActivityReason?.(conversationId) ?? (options.running || dependencies.hasActivity([conversationId]) ? "running" : null);
  if (!reason) reason = dependencies.ledger.read(state => {
    const others = <T extends { conversationId: string }>(items: Record<string, T>) => Object.entries(items)
      .filter(([id, item]) => id !== options.ownIntentId && item.conversationId === conversationId).map(([, item]) => item);
    if (others(state.submissionReservations).some(item => item.state === "reserved")) return "submission";
    if (others(state.manualIntents).some(item => !["settled", "failed"].includes(item.phase))) return "submission";
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
  return { eligible: reason === null, reason, agent: chat.agent, agentRevision: chat.agentRevision, chatRecordRevision: chat.chatRecordRevision };
}

export function switchReservationInput(submission: TrustedManualTurnSubmission) {
  if (!submission.agentSwitch || submission.precondition.kind !== "existing") throw new Error("AGENT_SWITCH_INTENT_CONFLICT");
  return { chatId: submission.turn.scope.conversationId, incarnationId: submission.precondition.incarnationId,
    intentId: submission.intentId, submissionHash: canonicalHash(submission), intent: submission.agentSwitch };
}
export async function assertSwitchSource(submission: TrustedManualTurnSubmission, dependencies: CoordinatorDependencies) {
  if (!submission.agentSwitch) return;
  const intent = agentSwitchIntentSchema.parse(submission.agentSwitch);
  if (submission.persistence.kind !== "append" || submission.persistence.input.revise || submission.turn.session ||
      intent.targetAgent !== submission.turn.turnOptions.backend) throw new Error("AGENT_SWITCH_INTENT_CONFLICT");
  let current = dependencies.chats.store.getMetadata(submission.persistence.input.chatId);
  const reserved = current?.chatRecordRevision !== intent.expectedChatRecordRevision
    ? await dependencies.chats.store.agentSwitchReservation(switchReservationInput(submission)) : null;
  current = dependencies.chats.store.getMetadata(submission.persistence.input.chatId);
  if (!current || current.agent !== intent.expectedAgent || current.agentRevision !== intent.expectedAgentRevision ||
      current.chatRecordRevision !== intent.expectedChatRecordRevision &&
        !(reserved?.chatRecordRevision === intent.expectedChatRecordRevision + 1 && current.chatRecordRevision === reserved.chatRecordRevision)) throw new Error("AGENT_REVISION_STALE");
  if (submission.turn.turnOptions.permissionMode === "full-access" &&
      (!dependencies.settings.get().fullAccessAcknowledgedAt || current.executionKind === "managed-worktree")) {
    throw new Error("FULL_ACCESS_ACK_REQUIRED");
  }
}
