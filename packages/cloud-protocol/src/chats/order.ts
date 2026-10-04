/**
 * [INPUT]: Depends only on stable identities, creation/archive timestamps, optional manual sort keys and portable conversation kinds.
 * [OUTPUT]: Provides shared Chat ordering, the effective order key and its server index projection.
 * [POS]: Pure navigation policy shared by local lists and cloud indexes; activity never moves an active Chat, a drag pins it in creation-time space.
 */
type Kind = "ordinary" | "app-use" | "app-edit";
export type ChatOrder = { id: string; createdAt: number; archivedAt?: number | null; kind?: Kind; sortKey?: number | null };
export const compareIdentity = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
export const chatRoleOrder = (kind?: Kind) => kind === "app-use" ? 0 : kind === "app-edit" ? 1 : 2;
/* A manual position is a "virtual createdAt": rows without one keep the moment they were born, so a new Chat still
   enters at the top and every drag only rewrites the dragged row. Bigger = higher in the list. */
export const chatOrderKey = (chat: Pick<ChatOrder, "createdAt" | "sortKey">) => chat.sortKey ?? chat.createdAt;
export function compareChats(left: ChatOrder, right: ChatOrder, options: { archived?: boolean; appProject?: boolean } = {}) {
  return (options.archived ? (right.archivedAt ?? 0) - (left.archivedAt ?? 0) : 0) ||
    (options.appProject && !options.archived ? chatRoleOrder(left.kind) - chatRoleOrder(right.kind) : 0) ||
    (options.archived ? 0 : chatOrderKey(right) - chatOrderKey(left)) || compareIdentity(left.id, right.id);
}
export function chatOrderIndex(chat: ChatOrder) {
  return { version: 1 as const, created: -chatOrderKey(chat), archived: chat.archivedAt == null ? null : -chat.archivedAt,
    role: chatRoleOrder(chat.kind) };
}
