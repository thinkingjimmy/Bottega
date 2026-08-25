/**
 * [INPUT]: Depends On Chat All records and O(1) metadata are read-only ports, Memory provider, factory and host runtime registry
 * [OUTPUT]: Provides a combination of memory service options that distinguish between the original reading and the title-level observation reading
 * [POS]: The main/memory/service/support dependence is injected into the border; The facade is only to be kept in operation while coordinating duties
 */

import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { MemoryProvider } from "../../core/provider";
import type { ManagedRuntimeRegistry } from "../../runtime/managed-registry";

export type MemoryServiceOptions = {
  readChat(chatId: string): Promise<ChatRecord | null>;
  readChatRef(chatId: string): Pick<
    ChatRecord,
    "id" | "incarnationId" | "title" | "archivedAt"
  > | null;
  listChatSummaries(): Promise<
    Array<{
      id: string;
      incarnationId: string;
      lastSeq: number;
      trimmedThroughSeq: number;
    }>
  >;
  runtimes: ManagedRuntimeRegistry;
  providerFactory?: (providerId: string, baseUrl: string) => MemoryProvider;
  automaticWorker?: boolean;
  shutdownGraceMs?: number;
};
