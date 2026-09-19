/**
 * [INPUT]: Depends on native summaries, authority-free mirror heads and separate local facts projections.
 * [OUTPUT]: Merges presentation rows with the shared creation/manual-position/archive and App-role order.
 * [POS]: Sidebar ordering only; never constructs an executable ChatSummary from a mirror.
 */
import { compareChats, type ChatOrder } from "@ai-chat/cloud-protocol/chats/order";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
import type { ChatSummary } from "../../../../shared/chats-ipc";
export type ChatNavigationRow = { kind: "native"; chat: ChatSummary; order: ChatOrder } |
  { kind: "mirror"; head: CloudChatHead; facts?: ChatCatalogFacts; order: ChatOrder };
export function mergeChatRows(native: readonly ChatSummary[], mirrors: readonly CloudChatHead[], facts: ReadonlyMap<string, ChatCatalogFacts>,
  options: { archived?: boolean; appProject?: boolean } = {}): ChatNavigationRow[] {
  const ids = new Set(native.map(chat => chat.id));
  const rows: ChatNavigationRow[] = native.map(chat => ({ kind: "native", chat, order: { ...chat,
    kind: chat.appRole === "use" ? "app-use" : chat.appRole === "edit" ? "app-edit" : "ordinary" } }));
  for (const head of mirrors) {
    if (ids.has(head.chat.id)) continue;
    const view = facts.get(head.chat.id);
    if (view?.state === "deleted") continue;
    rows.push({ kind: "mirror", head, facts: view, order: { ...head.chat, archivedAt: view ? view.archivedAt : head.archivedAt,
      sortKey: view?.sortKey === undefined ? head.chat.sortKey : view.sortKey, kind: head.chat.classification.conversationKind } });
  }
  return rows.sort((left, right) => compareChats(left.order, right.order, options));
}
