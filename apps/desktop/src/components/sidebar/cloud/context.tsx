/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and confirmed Chat catalogs, account/device metadata, the viewed-computer scope and native Chat identities.
 * [OUTPUT]: Shares one confirmed/pending catalog projection, mirrors deduplicated, scoped to the viewed computer and without workflow Chats (R-35), device labels, the computer scope and retry state.
 * [POS]: Sidebar composition boundary; portable heads never enter the executable ChatsProvider.
 */
import { isWorkflowChat } from "@ai-chat/base-core/metadata/placement-facts";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { CloudDevice } from "@ai-chat/cloud-protocol";
import { useCloudChatCatalog } from "@/lib/cloud/chat/catalog";
import { useChatDevices } from "@/lib/cloud/chat/access/devices";
import { useChats } from "@/components/providers/chats-provider";
import type { ChatCatalogFacts } from "@ai-chat/chat-ui/model";
import { useComputerScope, type ComputerScope } from "@/lib/cloud/computers/scope";
type Value = { heads: CloudChatHead[]; mirrors: CloudChatHead[]; archived: CloudChatHead[]; facts: ReadonlyMap<string, ChatCatalogFacts>; loading: boolean; error: boolean; retry(): void; devices: CloudDevice[]; deviceId: string | null; scope: ComputerScope };
const localScope: ComputerScope = { computers: [], self: null, viewed: null, local: true, now: 0, select: () => {}, selectLocal: () => {}, owns: () => true,
  pinned: [], pinnedHere: () => false, pin: () => {}, describe: () => {}, unpin: () => {} };
const context = createContext<Value>({ heads: [], mirrors: [], archived: [], facts: new Map(), loading: false, error: false, retry: () => {}, devices: [], deviceId: null, scope: localScope });
export const useCloudSidebar = () => useContext(context);
export function CloudSidebarProvider({ children }: { children: ReactNode }) {
  const catalog = useCloudChatCatalog(), { account, devices } = useChatDevices(), { chats } = useChats(), scope = useComputerScope();
  const facts = useMemo(() => new Map(catalog.facts.map(value => [value.chatId, value])), [catalog.facts]);
  const native = new Set(chats.map(chat => chat.id));
  /* A mirror belongs to the computer whose installations hold its owner; one that belongs to no computer of this
     account (a revoked installation) belongs in no computer's sidebar, so it is offered in none of them. A pinned
     Project brings its own Chats with it: they are still the owner's, shown under the row that was pinned here. */
  /* R-35: another computer's workflow Chat is in no list here either; it opens by id from its run. */
  const mirrors = catalog.heads.filter(head => !native.has(head.chat.id) && !isWorkflowChat(head.chat) && facts.get(head.chat.id)?.state !== "deleted" &&
    (scope.owns(head.ownerDeviceId) || scope.pinnedHere(head.chat.classification.projectId)));
  const archived = (head: CloudChatHead) => (facts.has(head.chat.id) ? facts.get(head.chat.id)!.archivedAt : head.archivedAt) !== null;
  return <context.Provider value={{ heads: catalog.heads, mirrors: mirrors.filter(head => !archived(head)), archived: mirrors.filter(archived),
    facts, loading: catalog.loading, error: Boolean(catalog.error), retry: catalog.retry, devices, deviceId: account.deviceId, scope }}>{children}</context.Provider>;
}
