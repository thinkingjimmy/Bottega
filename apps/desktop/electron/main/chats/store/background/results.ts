/**
 * [INPUT]: Uses ChatStoreState, exact retained-execution results and existing SQLite aggregate receipts.
 * [OUTPUT]: Exports BackgroundResultCommit and persistBackgroundResults for original command result updates.
 * [POS]: Narrow post-turn persistence boundary; not exposed through renderer mutation IPC.
 */
import { truncateUtf8 } from "@ai-chat/cloud-protocol/turns/text/truncate-utf8";
import { TOOL_DETAIL_BYTE_LIMIT } from "../../../../../shared/ipc/agent/agent-ipc";
import { NATIVE_BACKGROUND_PENDING_DETAIL, type NativeBackgroundResult } from "../../../../../shared/ipc/agent/background-ipc";
import { metadataOf } from "../../projection/chat-summary";
import { withCommitRevisions } from "../../lifecycle/chat-record-lifecycle";
import { normalizeMessage } from "../../chat-commit";
import type { ChatStoreState } from "../state";
import { persistRecordToStorage } from "../persistence";
import type { ChatMessageMutation } from "../mutation-outcome";

export type BackgroundResultCommit = {
  chatId: string; incarnationId: string; requestId: string; messageId: string; results: NativeBackgroundResult[];
};
function resultDetail(previous: string | undefined, result: NativeBackgroundResult) {
  const footer = result.outcome === "unknown" ? "Execution result unknown." : result.outcome === "stopped" ? "Stopped by user." : `Exit code: ${result.exitCode}`;
  if (previous?.endsWith(footer) && (!result.output || previous.includes(result.output))) return previous;
  const original = previous?.startsWith(NATIVE_BACKGROUND_PENDING_DETAIL) ? previous.slice(NATIVE_BACKGROUND_PENDING_DETAIL.length).trimStart() : previous;
  const value = [result.output || original, footer].filter(Boolean).join("\n");
  if (Buffer.byteLength(value) <= TOOL_DETAIL_BYTE_LIMIT) return value;
  const suffix = Array.from(value).reverse().join("");
  return "[Output truncated]\n" + Array.from(truncateUtf8(suffix, TOOL_DETAIL_BYTE_LIMIT - 20).value).reverse().join("");
}
export function persistBackgroundResults(state: ChatStoreState, input: BackgroundResultCommit, notify: () => void): Promise<ChatMessageMutation> {
  return state.queue.enqueue(async () => {
    const current = await state.readRecord(input.chatId);
    if (current.incarnationId !== input.incarnationId || current.readOnlyReason === "external-readonly") throw new Error("Background result Chat identity changed");
    const index = current.messages.findIndex(row => row.id === input.messageId);
    const message = current.messages[index];
    if (!message || message.role !== "assistant" || message.backend !== "codex" || message.turnId !== input.requestId) throw new Error("Background result has no original assistant message");
    const results = new Map(input.results.map(result => [result.itemId, result]));
    if (!results.size || results.size !== input.results.length || [...results.keys()].some(id => !id.startsWith(`${input.requestId}:`))) throw new Error("Background result request identity changed");
    const parts = message.parts?.map(part => {
      if (part.type !== "tool" || part.tool !== "command") return part;
      const result = results.get(part.itemId);
      if (!result) return part;
      results.delete(part.itemId);
      const { completionReason: _reason, ...original } = part;
      return { ...original, completion: result.outcome === "stopped" || result.outcome === "unknown" ? "interrupted" as const : "complete" as const,
        ...(result.outcome === "stopped" ? { completionReason: "source-cancelled" as const } : result.outcome === "unknown" ? { completionReason: "execution-unconfirmed" as const } : {}), status: result.outcome === "failed" || result.outcome === "unknown" ? "failed" as const : "completed" as const, detail: resultDetail(part.detail, result) };
    });
    if (results.size) throw new Error("Background result does not own an original command");
    const updated = normalizeMessage({ ...message, parts });
    const messages = current.messages.map((row, at) => at === index ? updated : row);
    const record = withCommitRevisions(current, { ...current, messages, updatedAt: state.now() }, true);
    await persistRecordToStorage({ record, database: state.database, deviceId: state.deviceId, expectedAggregateRevision: current.chatRecordRevision, onCommit: notify });
    state.metadata.set(record.id, metadataOf(record));
    state.messageRevisions.set(record.id, record.chatMessageRevision);
    state.remember(record, record.chatMessageRevision); state.touch();
    return { record: structuredClone(record), revision: record.chatMessageRevision, appended: [structuredClone(updated)], storedMessage: structuredClone(updated), mode: "replace" };
  });
}
