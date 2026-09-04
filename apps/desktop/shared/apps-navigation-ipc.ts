/**
 * [INPUT]: Depends on shared Chat roles, Chat start evidence, and immutable App destination identifiers
 * [OUTPUT]: Provides App chat-slot, History keyset pagination, App Use open, Editor resume, and exact Editor chat intent DTOs
 * [POS]: Shared Apps navigation wire vocabulary; durable App records and the bridge API re-export these focused contracts
 */

import type { AppChatRole } from "./chats-ipc";
import type { ChatStartState } from "./placement/facts";

export type AppChatSlot = {
  id: string;
  incarnationId: string;
  state: "draft" | "canonical";
  revision: number;
};

export type EnsureAppChatSlotInput = {
  appId: string;
  role: AppChatRole;
  requestId: string;
  mode?: "reuse" | "new";
};

export type EnsureAppChatSlotResult = AppChatSlot;

export type AppUseHistoryItem = Readonly<{
  chatId: string;
  incarnationId: string;
  title: string | null;
  preview: string | null;
  updatedAt: number;
  createdAt: number;
  startState: ChatStartState;
  active: boolean;
}>;

export type ListAppUseHistoryInput = Readonly<{
  appId: string;
  cursor?: string;
  pageSize?: number;
  expectedSnapshotRevision?: string;
}>;

/**
 * `snapshotRevision` 是客户端手里那份清单的指纹，`latestSnapshotRevision` 是当下的；
 * 两者不等即「列表已变」，翻页本身不因此失败——游标就是排序键，天然接得上。
 */
export type AppUseHistoryPage = Readonly<{
  snapshotRevision: string;
  latestSnapshotRevision: string;
  items: AppUseHistoryItem[];
  nextCursor: string | null;
}>;

export type OpenAppUseChatInput = Readonly<{
  appId: string;
  chatId: string;
  incarnationId: string;
  requestId: string;
}>;

export type OpenAppEditorInput = Readonly<{
  appId: string;
  requestId: string;
  mode?: "resume" | "new";
}>;

export type OpenAppEditorChatInput = Readonly<{
  appId: string;
  projectId: string;
  chatId: string;
  incarnationId: string;
  requestId: string;
}>;
