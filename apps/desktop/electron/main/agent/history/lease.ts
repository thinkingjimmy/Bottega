/**
 * [INPUT]: Depends on current-turn MCP leases, opaque random cursors, and the serialized Chat worker reader
 * [OUTPUT]: Provides independent history call/byte budgets, explicit live refresh, and view-bound page/chunk cursors
 * [POS]: History tool handler; neither arguments nor source refs authorize another Chat
 */

import { randomUUID } from "node:crypto";
import type { HistoryBinding, HistoryPosition } from "../../../../shared/chat-agent/history";
import { historyToolInputSchema } from "../../../../shared/chat-agent/history-tool";
import type { ChatStore } from "../../chats/chat-store";
import type { BuiltinMcpLease } from "../../tools/lease";
import type { BuiltinToolset } from "../../tools/registry";
import { builtinCallToolResultBytes } from "../../tools/result";
type Page = { binding: HistoryBinding; position: HistoryPosition };
type HistoryLease = { binding: HistoryBinding; calls: number; bytes: number; pages: Map<string, Page>; tail: Promise<unknown>; dead: boolean };
export function createChatHistoryToolset(store: Pick<ChatStore, "readHistory">): BuiltinToolset {
  const leases = new WeakMap<BuiltinMcpLease, HistoryLease>();
  return { read_chat_history: async (args, context) => {
    const input = historyToolInputSchema.parse(args);
    const owner = context.lease;
    if (!owner.historyBinding || !owner.allowedTools.includes("read_chat_history") || owner.state === "revoked" || owner.signal.aborted) return { status: "unavailable" };
    let lease = leases.get(owner);
    if (!lease) {
      if (owner.historyBinding.chatId !== owner.chatId || owner.historyBinding.view.incarnationId !== owner.incarnationId) return { status: "unavailable" };
      lease = { binding: structuredClone(owner.historyBinding), calls: 0, bytes: 0, pages: new Map(), tail: Promise.resolve(), dead: false };
      leases.set(owner, lease);
      owner.signal.addEventListener("abort", () => { lease!.dead = true; lease!.pages.clear(); }, { once: true });
    }
    const current = lease;
    const execute = async () => {
      if (current.dead || context.signal.aborted) return { status: "unavailable" };
      if (current.calls >= 8 || current.bytes >= 96 * 1024 - 1024) return { status: "budget-exhausted" };
      current.calls++;
      const charge = (result: unknown) => { current.bytes += builtinCallToolResultBytes(result); return result; };
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
