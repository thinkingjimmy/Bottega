/**
 * [INPUT]: Depends on the unified history builder, canonical revision targets, and prepared manual custody
 * [OUTPUT]: Freezes history, lookup cuts and imported-replay notices at the caller-owned admission or dispatch boundary, excluding superseded revision tails
 * [POS]: Manual context preparation for ordinary, switched, adopted, and Fork continuations
 */

import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import { canonicalHash } from "../coordinator-values";
import { buildHandoff } from "../../../agent/history/builder";
import { REVISION_STALE } from "../../../../../shared/chats-ipc";
import { noticeMessageContent } from "../../../../../shared/chats-ipc";
export async function freezeManualContext(prepared: PreparedManualTurn, dependencies: Pick<CoordinatorDependencies, "chats">,
  sequence: { noticeSeq?: number; userSeq: number }): Promise<PreparedManualTurn> {
  const replay = prepared.persistence.kind === "adopt" ? prepared.persistence.input.replay : undefined;
  if (prepared.persistence.kind !== "append" && !replay) return prepared;
  const chatId = prepared.persistence.kind === "append" ? prepared.persistence.input.chatId : prepared.persistence.input.id;
  const revision = prepared.persistence.kind === "append" ? prepared.persistence.input.revise : undefined;
  let nativeBeforeSeq = sequence.noticeSeq ?? sequence.userSeq;
  if (revision) {
    const superseded = await dependencies.chats.store.getNativeMessage(chatId, {
      kind: "id", messageId: revision.supersedesUserMessageId,
    });
    if (superseded?.role !== "user") throw new Error(REVISION_STALE);
    nativeBeforeSeq = superseded.seq;
  }
  const history = await dependencies.chats.store.prepareHistory(chatId, nativeBeforeSeq);
  if (!history) throw new Error("CHAT_HISTORY_UNAVAILABLE");
  if (replay && history.binding.view.activeGenerationId !== replay.generationId) throw new Error("Saved-history continuation generation changed");
  const allowed = prepared.projectTools.allowedTools.includes("read_chat_history");
  const lookup = allowed ? "available" : prepared.projectTools.builtinIntent.disabledTools.includes("read_chat_history") ? "disabled" : "unsupported";
  const handoff = buildHandoff(history, prepared.input.filter(item => !item.resolvedOnly), lookup);
  const { contentHash: _hash, ...body } = prepared;
  let persistence = body.persistence;
  if (persistence.kind === "adopt" && replay) {
    const notice = { kind: "agent-switched" as const, from: persistence.input.importOrigin.sourceKind,
      to: persistence.input.agent, at: persistence.input.firstMessage.createdAt, agentRevision: 1, context: handoff.coverage };
    persistence = { ...persistence, input: { ...persistence.input, replay: { ...replay,
      notice: { id: replay.noticeId, role: "notice", notice, seq: 1,
        createdAt: notice.at, content: noticeMessageContent(notice) } } } };
  }
  const frozen = { ...body, persistence, turn: { ...body.turn, handoff } };
  return { ...frozen, contentHash: canonicalHash(frozen) };
}
