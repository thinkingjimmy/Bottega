/**
 * [INPUT]: Exact native messages, Subagent snapshots and path-free Gallery occurrence identities.
 * [OUTPUT]: Resolves completed images only within the named assistant's reachable Subagent tree.
 * [POS]: Shared canonical proof for Gallery preview, synchronization and lease reissue.
 */
import type { ChatStore } from "../../chats/chat-store";
import type { GallerySourceRef } from "../../../../shared/gallery-media-ipc";
import type { ChatToolPart } from "../../../../shared/chats-ipc";

export async function canonicalImage(store: ChatStore, source: GallerySourceRef, subagentId: string | null = null) {
  const message = await store.getNativeMessage(source.chatId, { kind: "seq", seq: source.assistantSeq });
  if (message?.role !== "assistant") return { canonical: Boolean(message), image: undefined };
  let parts = message.parts;
  if (subagentId) {
    const agents = await store.getNativeSubagents(source.chatId);
    const pending = (parts ?? []).flatMap(part => part.type === "subagent" ? [part.agentThreadId] : []), seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const part of agents?.[id]?.parts ?? []) if (part.type === "subagent") pending.push(part.agentThreadId);
    }
    parts = seen.has(subagentId) ? agents?.[subagentId]?.parts : undefined;
  }
  const image = parts?.find((part): part is ChatToolPart => part.type === "tool" && part.tool === "image" && part.status === "completed" && part.itemId === source.itemId);
  return { canonical: true, image };
}
