/**
 * [INPUT]: Depends on canonical Chat facts, coordinator activity, and the existing submission/relay ledger
 * [OUTPUT]: Allows imported readonly Agent selection while preserving activity locks, source/revision fences, and Full Access checks for normal switches and saved-history replay
 * [POS]: Main switch policy shared by selector queries, admission, and queued commits
 */

import { ledgerActivityReason } from "./activity";
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
  let reason: AgentSwitchBlockReason | null = chat.readOnlyReason && chat.readOnlyReason !== "external-readonly" ? "readonly"
    : chat.context.kind !== "ordinary" ? "app-bound"
    : conversationAvailability(dependencies, conversationId, chat.projectId) !== "open" || chat.archivedAt ? "archived"
    : options.recovering ? "recovery"
    : dependencies.switchActivityReason?.(conversationId) ?? (options.running || dependencies.hasActivity([conversationId]) ? "running" : null);
  if (!reason) reason = ledgerActivityReason(dependencies.ledger, conversationId, options.ownIntentId);
  return { eligible: reason === null, reason, agent: chat.agent, agentRevision: chat.agentRevision, chatRecordRevision: chat.chatRecordRevision };
}

export function switchReservationInput(submission: TrustedManualTurnSubmission) {
  if (!submission.agentSwitch || submission.precondition.kind !== "existing") throw new Error("AGENT_SWITCH_INTENT_CONFLICT");
  return { chatId: submission.turn.scope.conversationId, incarnationId: submission.precondition.incarnationId,
    intentId: submission.intentId, submissionHash: canonicalHash(submission), intent: submission.agentSwitch };
}
export async function assertSwitchSource(submission: TrustedManualTurnSubmission, dependencies: CoordinatorDependencies, remote?: import("../remote/model").RemoteContext) {
  const fullAccessAllowed = (chat: { id: string; incarnationId: string }) => remote
    ? dependencies.ledger.remote.authority(remote).fullAccessFor?.(chat.id, chat.incarnationId)
    : Boolean(dependencies.settings.get().fullAccessAcknowledgedAt);
  if (submission.persistence.kind === "adopt" && submission.persistence.input.replay) {
    const input = submission.persistence.input;
    const current = dependencies.chats.store.getMetadata(input.id);
    if (!current || current.readOnlyReason !== "external-readonly" || current.agentRevision !== 0 ||
      current.agent !== input.importOrigin.sourceKind || current.incarnationId !== input.incarnationId ||
      current.chatRecordRevision !== input.replay!.expectedChatRecordRevision || input.session !== null ||
      input.agent !== submission.turn.turnOptions.backend || submission.turn.session) throw new Error("AGENT_REVISION_STALE");
    if (submission.turn.turnOptions.permissionMode === "full-access" &&
      (!fullAccessAllowed(current) || current.executionKind === "managed-worktree")) {
      throw new Error("FULL_ACCESS_ACK_REQUIRED");
    }
    return;
  }
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
      (!fullAccessAllowed(current) || current.executionKind === "managed-worktree")) {
    throw new Error("FULL_ACCESS_ACK_REQUIRED");
  }
}
