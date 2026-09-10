/**
 * [INPUT]: Depends on prepared input custody, stable IDs, and the Chat store command freezer
 * [OUTPUT]: Freezes notice/user/assistant IDs, target options, and caller revisions into the original prepared intent
 * [POS]: Switch preparation; bytes stay in existing staging and only bounded commands enter the ledger
 */

import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import { canonicalHash, stableId } from "../coordinator-values";
import { noticeMessageContent } from "../../../../../shared/chats-ipc";
import { switchOperationId } from "../../../chats/sqlite/agent-switch/command";

export function freezeSwitch(prepared: PreparedManualTurn, dependencies: CoordinatorDependencies,
  submissionHash: string, sequence: { executorNoticeSeq?: number; noticeSeq?: number; userSeq: number; assistantSeq: number }): PreparedManualTurn {
  const { contentHash: _previousHash, ...initial } = prepared;
  const withSequences = { ...initial, sequences: sequence };
  prepared = { ...withSequences, contentHash: canonicalHash(withSequences) };
  const intent = prepared.agentSwitch;
  if (!intent) return prepared;
  if (prepared.persistence.kind !== "append" || !sequence.noticeSeq) throw new Error("AGENT_SWITCH_SEQUENCE_MISSING");
  const current = dependencies.chats.store.getMetadata(prepared.persistence.input.chatId)!;
  const source = prepared.persistence.input.message;
  const notice = { kind: "agent-switched", from: intent.expectedAgent, to: intent.targetAgent,
    at: source.createdAt, agentRevision: intent.expectedAgentRevision + 1,
    context: prepared.turn.handoff?.coverage ?? { mode: "none", historyIncluded: false, notInjected: true,
      storageTrimmed: Boolean(current.trimmedThroughSeq), lookup: "unavailable" } } as const;
  const attachments = (prepared.persistence.input.attachmentPayloads ?? []).map(blob => ({
    id: blob.blobId.replaceAll("-", ""), filename: blob.filename, mediaType: blob.mediaType, byteSize: blob.byteSize,
  }));
  const switchCommand = dependencies.chats.store.prepareAgentSwitch({
    kind: "switch-agent", operationId: switchOperationId(prepared.intentId), intentId: prepared.intentId,
    submissionHash, chatId: current.id, incarnationId: current.incarnationId, intent,
    targetOptions: prepared.turn.turnOptions,
    notice: { id: stableId("agent-switch", prepared.intentId), role: "notice", notice,
      content: noticeMessageContent(notice), createdAt: notice.at, seq: sequence.noticeSeq },
    userMessage: { ...source, seq: sequence.userSeq, ...(attachments.length ? { attachments } : {}) },
    assistantMessageId: stableId("assistant", prepared.intentId), assistantSeq: sequence.assistantSeq,
  });
  const { contentHash: _oldHash, ...body } = prepared;
  const frozen = { ...body, switchCommand };
  return { ...frozen, contentHash: canonicalHash(frozen) };
}
