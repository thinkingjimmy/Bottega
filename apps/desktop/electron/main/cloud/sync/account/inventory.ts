/**
 * [INPUT]: Depends on canonical Chat projections and the SQLite account mirror catalog.
 * [OUTPUT]: Reads bounded mirror metadata and complete Base owner identities without creating local execution bindings.
 * [POS]: Early Store mounting and cleanup inventory shared by the main composition and scope planner.
 */
import type { SyncScope, PortableChat } from "../../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../../chats/chat-store";
export async function mirrorChatCatalog(chats: ChatStore, scope: SyncScope) {
  const items: PortableChat[] = []; let cursor: string | null = null;
  do {
    const page = await chats.sync.read(scope, { type: "mirror-catalog", afterId: cursor, limit: 100 });
    if (page.type !== "mirror-catalog") throw new Error("SYNC_CHAT_INVENTORY_UNAVAILABLE");
    items.push(...page.value.items);
    if (items.length > 10000) throw new Error("SYNC_CHAT_INVENTORY_LIMIT");
    cursor = page.value.cursor;
  } while (cursor !== null);
  return items;
}
export async function baseIdentityCatalog(chats: ChatStore, scope: SyncScope | null) {
  const identities = new Map(chats.listBaseIdentities().map(identity => [identity.chatId, identity]));
  if (scope) for (const chat of await mirrorChatCatalog(chats, scope)) {
    const existing = identities.get(chat.id);
    if (existing && existing.incarnationId !== chat.incarnationId) throw new Error("BASE_OWNER_IDENTITY_CONFLICT");
    identities.set(chat.id, { chatId: chat.id, incarnationId: chat.incarnationId, title: chat.title });
  }
  return identities;
}
