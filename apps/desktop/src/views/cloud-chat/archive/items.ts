/**
 * [INPUT]: Depends on the scoped confirmed catalog, local facts and native Chat identities.
 * [OUTPUT]: Provides archived mirror entries and their catalog loading/retry state.
 * [POS]: Settings archive read model; mirrors stay outside native ArchiveTarget operations.
 */
import { useMemo } from "react";
import { useCloudChatCatalog } from "@/lib/cloud/chat/catalog";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
export type MirrorArchiveItem = { kind: "mirror"; key: string; archivedAt: number; title: string | null; head: CloudChatHead };
export function useCloudArchiveItems() {
  const catalog = useCloudChatCatalog();
  const items = useMemo(() => {
    const facts = new Map(catalog.facts.map(value => [value.chatId, value]));
    return catalog.heads.flatMap((head): MirrorArchiveItem[] => {
      const view = facts.get(head.chat.id), archivedAt = view ? view.archivedAt : head.archivedAt;
      if (view?.residence !== "mirror" || view.state === "deleted" || archivedAt === null) return [];
      return [{ kind: "mirror", key: `chat:${head.chat.id}`, archivedAt, title: view ? view.title : head.chat.title, head }];
    });
  }, [catalog.heads, catalog.facts]);
  return { ...catalog, items };
}
