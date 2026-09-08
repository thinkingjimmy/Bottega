/**
 * [INPUT]: Depends on memory-only Agent drafts, canonical runtime reads, submission outcomes, and composer ownership
 * [OUTPUT]: Freezes switch intent, restores precommit failures, and consumes only the matching committed draft without erasing later edits
 * [POS]: Renderer switch submission seam; unknown outcomes retain the original pending operation
 */

import type { ManualTurnSubmission } from "../../../shared/sections-ipc";
import type { SubmissionOutcome } from "../../../shared/submission";
import { readComposer, updateComposer, replaceDraftFiles, retainComposerResources } from "../chat-composer-store";
import { consumeAgentSubmission, markAgentSubmission, readAgentDraft, rejectAgentSubmission } from "./state";
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
  const pending = readAgentDraft(chatId).pending;
  if (!pending?.submitting || pending.submitting !== outcome.intentId) return;
  const committed = outcome.kind === "tombstone" ? outcome.outcome === "persisted" || outcome.custody === "chat-persisted"
    : outcome.kind === "live" && (outcome.custody === "chat-persisted" || outcome.retry === "retry-agent-turn");
  if (!committed) {
    if (outcome.kind === "live" && outcome.phase === "failed" || outcome.kind === "tombstone" && outcome.outcome === "failed") {
      rejectAgentSubmission(chatId, outcome.intentId);
    }
    return;
  }
  const record = await window.chats!.runtimeContext(chatId);
  if (!record || readAgentDraft(chatId).pending?.submitting !== outcome.intentId) return;
  consumeAgentSubmission(chatId, outcome.intentId, record);
  if (readAgentDraft(chatId).pending) return;
  if (readComposer(chatId).draft !== pending.draftIdentity) return;
  replaceDraftFiles(chatId, []);
  updateComposer(chatId, current => ({ ...current, draft: { richValue: [], files: [] } }));
  retainComposerResources(chatId);
}
export { rejectAgentSubmission };
