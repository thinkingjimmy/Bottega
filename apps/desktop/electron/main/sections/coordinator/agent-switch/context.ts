/**
 * [INPUT]: Depends on the unified history builder, canonical revision targets, and prepared manual custody
 * [OUTPUT]: Freezes the effective history prefix and lookup cut before the admission receipt, excluding superseded revision tails
 * [POS]: Manual context preparation for ordinary, switched, adopted, and Fork continuations
 */

import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import { canonicalHash } from "../coordinator-values";
import { buildHandoff } from "../../../agent/history/builder";
import { REVISION_STALE } from "../../../../../shared/chats-ipc";
export async function freezeManualContext(prepared: PreparedManualTurn, dependencies: CoordinatorDependencies,
  sequence: { noticeSeq?: number; userSeq: number }): Promise<PreparedManualTurn> {
  if (prepared.persistence.kind !== "append") return prepared;
  const chatId = prepared.persistence.input.chatId;
  const revision = prepared.persistence.input.revise;
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
  const allowed = prepared.projectTools.allowedTools.includes("read_chat_history");
  const lookup = allowed ? "available" : prepared.projectTools.builtinIntent.disabledTools.includes("read_chat_history") ? "disabled" : "unsupported";
  const handoff = buildHandoff(history, prepared.input.filter(item => !item.resolvedOnly), lookup);
  const { contentHash: _hash, ...body } = prepared;
  const frozen = { ...body, turn: { ...body.turn, handoff } };
  return { ...frozen, contentHash: canonicalHash(frozen) };
}
