/**
 * [INPUT]: Depends on memory-only Agent drafts, canonical runtime reads, submission outcomes, history adoption, and composer ownership
 * [OUTPUT]: Freezes switch intent, restores precommit failures, and consumes matching native/adoption drafts without erasing later edits
 * [POS]: Renderer switch submission seam; unknown outcomes retain the original pending operation
 */

import type { ManualTurnSubmission } from "../../../shared/sections-ipc";
import type { SubmissionOutcome } from "../../../shared/submission";
import { readComposer, updateComposer, replaceDraftFiles, retainComposerResources } from "../chat-composer-store";
import { consumeAgentSubmission, markAgentSubmission, readAgentDraft, receiveCanonicalAgent, rejectAgentSubmission, updateAgentDraft } from "./state";
import { adoptHistory } from "../history/client";
import { getSubmissionOutcome } from "../sections-client";
import { reportedFailure } from "@ai-chat/ui/lib/errors";
import { translate } from "../../../shared/i18n/runtime";
import { effectiveLocale } from "../i18n-locale";
export function assertNoPendingAgent(chatId: string) {
  if (readAgentDraft(chatId).pending) throw new Error(translate(effectiveLocale(), "chat.agentSwitch.adjacent"));
}
export function bindAgentSubmission(envelope: ManualTurnSubmission) {
  const state = readAgentDraft(envelope.turn.scope.conversationId);
  if (!envelope.agentSwitch) return;
  if (!state.pending || state.pending.submitting || state.pending.stale || JSON.stringify(state.pending.intent) !== JSON.stringify(envelope.agentSwitch)) throw new Error(translate(effectiveLocale(), "chat.agentSwitch.stale"));
  markAgentSubmission(envelope.turn.scope.conversationId, envelope.intentId, state.pending.generation,
    readComposer(envelope.turn.scope.conversationId).draft);
}
export async function reconcileAgentSubmission(chatId: string, outcome: SubmissionOutcome) {
  const { pending, adoption } = readAgentDraft(chatId);
  if (pending?.submitting !== outcome.intentId && adoption?.intentId !== outcome.intentId) return;
  if (!submissionCommitted(outcome)) {
    if (outcome.kind === "live" && outcome.phase === "failed" || outcome.kind === "tombstone" && outcome.outcome === "failed") {
      rejectAgentSubmission(chatId, outcome.intentId);
      updateAgentDraft(chatId, state => state.adoption?.intentId === outcome.intentId
        ? { ...state, adoption: undefined, adoptionError: translate(effectiveLocale(), "chat.runtime.queue.notPersisted") } : state);
    }
    return;
  }
  const record = await window.chats!.runtimeContext(chatId);
  const current = readAgentDraft(chatId);
  if (!record || current.pending?.submitting !== outcome.intentId && current.adoption?.intentId !== outcome.intentId) return;
  if (adoption && (record.readOnlyReason || record.incarnationId !== adoption.incarnationId)) return;
  if (adoption) receiveCanonicalAgent(chatId, record);
  if (pending?.submitting === outcome.intentId) consumeAgentSubmission(chatId, outcome.intentId, record);
  if (readAgentDraft(chatId).pending) return;
  updateAgentDraft(chatId, state => state.adoption?.intentId === outcome.intentId ? { ...state, adoption: undefined } : state);
  if (readComposer(chatId).draft !== (adoption?.draftIdentity ?? pending?.draftIdentity)) return;
  replaceDraftFiles(chatId, []);
  updateComposer(chatId, current => ({ ...current, draft: { richValue: [], files: [] } }));
  retainComposerResources(chatId);
}
export { rejectAgentSubmission };

function submissionCommitted(outcome: SubmissionOutcome) {
  return outcome.kind === "tombstone" ? outcome.outcome === "persisted" || outcome.custody === "chat-persisted"
    : outcome.kind === "live" && (outcome.custody === "chat-persisted" || outcome.retry === "retry-agent-turn");
}

export async function submitHistoryAdoption(chatId: string, input: Parameters<typeof adoptHistory>[0]) {
  const captured = readAgentDraft(chatId);
  if (captured.adoption || captured.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
  const requestId = crypto.randomUUID();
  const generation = captured.pending?.generation;
  const draft = readComposer(chatId).draft;
  updateAgentDraft(chatId, state => ({ ...state, adoptionError: undefined, adoption: { requestId, generation: captured.generation, draftIdentity: draft } }));
  if (generation !== undefined) markAgentSubmission(chatId, requestId, generation, draft);
  try {
    const receipt = await adoptHistory(input);
    updateAgentDraft(chatId, state => state.adoption?.requestId === requestId
      ? { ...state, adoption: { ...state.adoption, intentId: receipt.intentId, incarnationId: receipt.incarnationId } } : state);
    if (generation !== undefined && receipt.chatId === chatId) {
      markAgentSubmission(chatId, receipt.intentId, generation, draft, receipt.incarnationId);
    }
    const outcome = await getSubmissionOutcome(receipt.intentId).catch(() => null);
    if (outcome) await reconcileAgentSubmission(chatId, outcome).catch(() => undefined);
    if (!outcome || !submissionCommitted(outcome)) {
      if (outcome && (outcome.kind === "live" && outcome.phase === "failed" || outcome.kind === "tombstone" && outcome.outcome === "failed")) {
        throw new Error(translate(effectiveLocale(), "chat.runtime.queue.notPersisted"));
      }
      throw reportedFailure(new Error(translate(effectiveLocale(), "chat.agentSwitch.recovering")));
    }
    return receipt;
  } catch (cause) {
    const adoption = readAgentDraft(chatId).adoption;
    if (adoption?.requestId === requestId && !adoption.intentId) {
      rejectAgentSubmission(chatId, requestId);
      updateAgentDraft(chatId, state => state.adoption?.requestId === requestId ? { ...state, adoption: undefined } : state);
    }
    throw cause;
  }
}
