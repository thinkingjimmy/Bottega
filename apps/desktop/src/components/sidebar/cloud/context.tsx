/**
 * [INPUT]: Depends on confirmed Chat catalogs, account/device metadata and native Chat identities.
 * [OUTPUT]: Shares one confirmed/pending catalog projection, deduplicated mirrors, device labels and retry state.
 * [POS]: Sidebar composition boundary; portable heads never enter the executable ChatsProvider.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { CloudDevice } from "@ai-chat/cloud-protocol";
import { useCloudChatCatalog } from "@/lib/cloud/chat/catalog";
import { useChatDevices } from "@/lib/cloud/chat/devices";
import { useChats } from "@/components/providers/chats-provider";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
type Value = { heads: CloudChatHead[]; mirrors: CloudChatHead[]; archived: CloudChatHead[]; facts: ReadonlyMap<string, ChatCatalogFacts>; loading: boolean; error: boolean; retry(): void; devices: CloudDevice[]; deviceId: string | null };
const context = createContext<Value>({ heads: [], mirrors: [], archived: [], facts: new Map(), loading: false, error: false, retry: () => {}, devices: [], deviceId: null });
export const useCloudSidebar = () => useContext(context);
export function CloudSidebarProvider({ children }: { children: ReactNode }) {
  const catalog = useCloudChatCatalog(), { account, devices } = useChatDevices(), { chats } = useChats();
  const facts = useMemo(() => new Map(catalog.facts.map(value => [value.chatId, value])), [catalog.facts]);
  const native = new Set(chats.map(chat => chat.id));
  const mirrors = catalog.heads.filter(head => !native.has(head.chat.id) && facts.get(head.chat.id)?.state !== "deleted");
  const archived = (head: CloudChatHead) => (facts.has(head.chat.id) ? facts.get(head.chat.id)!.archivedAt : head.archivedAt) !== null;
  return <context.Provider value={{ heads: catalog.heads, mirrors: mirrors.filter(head => !archived(head)), archived: mirrors.filter(archived),
    facts, loading: catalog.loading, error: Boolean(catalog.error), retry: catalog.retry, devices, deviceId: account.deviceId }}>{children}</context.Provider>;
}
