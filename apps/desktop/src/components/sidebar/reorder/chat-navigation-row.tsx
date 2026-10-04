/**
 * [INPUT]: Depends on the eager reorder context, the merged navigation row union and the native/mirror row components.
 * [OUTPUT]: Provides a plain navigation row and delegates drag bindings to the lazily injected runtime component.
 * [POS]: The per-row half of components/sidebar/reorder; ChatNavigationRows maps through it, and outside a ChatReorderList it degrades to a plain row.
 */
import { ChatThreadItem } from "../chat/chat-thread-item";
import { CloudChatRow } from "../cloud/rows";
import type { ChatNavigationRow as NavigationRow } from "../cloud/order";
import { useChatReorder } from "./context";
import type { ChatRowReorderProps } from "./row-props";

export type ChatNavigationRowProps = { row: NavigationRow; project?: boolean; editBadge?: string };

export function ChatNavigationRow(props: ChatNavigationRowProps) {
  const Binding = useChatReorder()?.Row;
  return Binding ? <Binding {...props} /> : <PlainChatNavigationRow {...props} />;
}

export function PlainChatNavigationRow({ row, project = false, editBadge, reorder: state }: ChatNavigationRowProps & { reorder?: ChatRowReorderProps }) {
  return row.kind === "native"
    ? <ChatThreadItem chat={row.chat} variant={project ? "sub" : "root"} badge={row.chat.appRole === "edit" ? editBadge : undefined} reorder={state} />
    : <CloudChatRow head={row.head} facts={row.facts} project={project} badge={row.head.chat.classification.conversationKind === "app-edit" ? editBadge : undefined}
        reorder={state && { itemRef: state.itemRef, dropEdge: state.dropEdge, suppressed: state.suppressed }} />;
}
