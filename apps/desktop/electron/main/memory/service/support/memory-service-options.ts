/**
 * [INPUT]: Depends On Chat All records and O(1) metadata are read-only ports, Memory provider, factory, host runtime registry and the platform capability matrix
 * [OUTPUT]: Provides a combination of memory service options that distinguish between the original reading and the title-level observation reading
 * [POS]: The main/memory/service/support dependence is injected into the border; The facade is only to be kept in operation while coordinating duties
 */

import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { PlatformCapabilities } from "../../../../../shared/platform-capabilities";
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
  /* 必给，不可缺省。"没人告诉我这台机器行不行"唯一安全的读法是拒绝，
     而可选字段的缺省只能是放行——那正是把安全门写成默认开着。 */
  platformSupport: PlatformCapabilities;
  providerFactory?: (providerId: string, baseUrl: string) => MemoryProvider;
  automaticWorker?: boolean;
  shutdownGraceMs?: number;
};
