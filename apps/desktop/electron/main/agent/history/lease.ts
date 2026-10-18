/**
 * [INPUT]: Depends on current-turn MCP leases, the serialized Chat reader and current-Chat attachment/workspace ports
 * [OUTPUT]: Provides bounded text/attachment reads, source-verified original bytes, explicit live refresh and view-bound cursors
 * [POS]: History tool handler; neither arguments nor source refs authorize another Chat
 */

import { randomUUID } from "node:crypto";
import type { HistoryBinding, HistoryPosition } from "../../../../shared/chat-agent/history";
import { historyToolInputSchema } from "../../../../shared/chat-agent/history-tool";
import type { ChatStore } from "../../chats/chat-store";
import type { BuiltinMcpLease } from "../../tools/lease";
import type { BuiltinToolset } from "../../tools/registry";
import { builtinCallToolResultBytes } from "../../tools/result";
import { deliverHistoryAttachment, type HistoryAttachmentPorts } from "./attachments";
type Page = { binding: HistoryBinding; position: HistoryPosition };
type HistoryLease = { binding: HistoryBinding; calls: number; bytes: number; attachmentBytes: number; pages: Map<string, Page>; tail: Promise<unknown>; dead: boolean };
export function createChatHistoryToolset(store: Pick<ChatStore, "readHistory">, attachments?: HistoryAttachmentPorts): BuiltinToolset {
  const leases = new WeakMap<BuiltinMcpLease, HistoryLease>();
  return { read_chat_history: async (args, context) => {
    const input = historyToolInputSchema.parse(args);
    const owner = context.lease;
    if (!owner.historyBinding || !owner.allowedTools.includes("read_chat_history") || owner.state === "revoked" || owner.signal.aborted) return { status: "unavailable" };
    let lease = leases.get(owner);
    if (!lease) {
      if (owner.historyBinding.chatId !== owner.chatId || owner.historyBinding.view.incarnationId !== owner.incarnationId) return { status: "unavailable" };
      lease = { binding: structuredClone(owner.historyBinding), calls: 0, bytes: 0, attachmentBytes: 0, pages: new Map(), tail: Promise.resolve(), dead: false };
      leases.set(owner, lease);
      owner.signal.addEventListener("abort", () => { lease!.dead = true; lease!.pages.clear(); }, { once: true });
    }
    const current = lease;
    const execute = async () => {
      const unavailable = () => current.dead || context.signal.aborted || owner.signal.aborted || owner.state === "revoked";
      if (unavailable()) return { status: "unavailable" };
      const attachmentRead = input.mode === "attachment";
      if (current.calls >= 8 || (attachmentRead ? current.attachmentBytes >= 4 * 1024 * 1024 - 1024 : current.bytes >= 96 * 1024 - 1024)) return { status: "budget-exhausted" };
      current.calls++;
      const charge = (result: unknown) => {
        if (attachmentRead) current.attachmentBytes += builtinCallToolResultBytes(result);
        else current.bytes += builtinCallToolResultBytes(result);
        return result;
      };
      if (input.mode === "attachment") {
        if (!attachments) return charge({ status: "unavailable" });
        const verify = () => store.readHistory({ binding: current.binding,
          position: { mode: "chunk", offset: 0, ref: input.ref! }, refresh: false, byteLimit: 15 * 1024 });
        const source = await verify();
        if (unavailable()) return charge({ status: "unavailable" });
        if (source.status !== "ok") return charge({ status: source.status });
        const attachment = source.records.find(record => record.ref.messageId === input.ref!.messageId)?.attachments?.find(item => item.id === input.attachmentId);
        if (!attachment) return charge({ status: "unavailable" });
        try {
          const dataUrl = await attachments.readAttachment(owner.chatId, attachment.id);
          const after = await verify();
          if (unavailable()) return charge({ status: "unavailable" });
          if (after.status !== "ok") return charge({ status: after.status });
          const limit = Math.min(owner.resultByteBudget, 4 * 1024 * 1024 - current.attachmentBytes);
          const result = await deliverHistoryAttachment({ chatId: owner.chatId, attachment, dataUrl,
            workspace: attachments.workspace(owner.chatId, owner.incarnationId), byteLimit: limit });
          if (unavailable()) return charge({ status: "unavailable" });
          if (builtinCallToolResultBytes(result) > limit) return charge({ status: "budget-exhausted" });
          return charge(result);
        } catch { return charge({ status: "unavailable" }); }
      }
      const page = input.cursor ? current.pages.get(input.cursor) : undefined;
      if (input.cursor && (!page || page.position.mode !== input.mode ||
        page.binding.view.nativeMessageRevision !== current.binding.view.nativeMessageRevision ||
        (input.mode === "search" && page.position.query !== input.query) ||
        ("ref" in input && input.ref && JSON.stringify(input.ref) !== JSON.stringify(page.position.ref)))) return charge({ status: "stale" });
      const position: HistoryPosition = page?.position ?? { mode: input.mode, offset: 0,
        ...("query" in input ? { query: input.query } : {}), ...("ref" in input ? { ref: input.ref } : {}) };
      const result = await store.readHistory({ binding: page?.binding ?? current.binding, position,
        refresh: !input.cursor && (input.mode === "recent" || input.mode === "search"),
        byteLimit: Math.min(15 * 1024, owner.resultByteBudget - 1024, 96 * 1024 - current.bytes - 1024) });
      if (current.dead || context.signal.aborted || owner.signal.aborted) return charge({ status: "unavailable" });
      if (result.status === "unavailable") current.dead = true;
      if (result.viewChanged) { current.pages.clear(); current.binding = { ...current.binding, view: result.view }; }
      const cursor = (next: HistoryPosition | null) => {
        if (!next) return null;
        const token = randomUUID(); current.pages.set(token, { binding: structuredClone(current.binding), position: next }); return token;
      };
      const { nextPage, nextChunk, ...body } = result;
      const response = { ...body, pageCursor: cursor(nextPage), chunkCursor: cursor(nextChunk),
        remainingCalls: 8 - current.calls };
      if (builtinCallToolResultBytes(response) > Math.min(16 * 1024, owner.resultByteBudget, 96 * 1024 - current.bytes)) return charge({ status: "budget-exhausted" });
      return charge(response);
    };
    const result = current.tail.then(execute);
    current.tail = result.catch(() => {});
    return result;
  } };
}
