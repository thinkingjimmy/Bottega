/**
 * [INPUT]: Depends on shared Agent/Chat contracts, Chat Home ownership, attachment export dependencies, fork-home capabilities, and deletion policy
 * [OUTPUT]: Provides the complete dependency contract used to compose ChatsService
 * [POS]: Type-only composition boundary separating service wiring from runtime Chat orchestration
 */

import type { AgentBackendId, SessionRef } from "../../../shared/agent-ipc";
import type { AppChatRole, ChatRecord } from "../../../shared/chats-ipc";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { AttachmentExportDependencies } from "./attachment-export";
import type { ChatDeletionOptions } from "./chat-deletion";
import type { ChatForkHomePort } from "./chat-fork-service";

type ChatHomeCreationPort = ChatForkHomePort & Pick<ChatHomeService,
  "committedCreationEvidence" | "isolateCommittedCreation" |
  "assertDeletionAdmissible" | "releaseWorktreeForDeletion" |
  "releaseHomeForDeletion">;

export type ChatsServiceOptions = ChatDeletionOptions & {
  recoverTitleJobs?: boolean;
  generateTitle: (firstMessage: string) => Promise<string>;
  attachmentsRoot: string;
  exportsRoot?: string;
  attachmentExportFs?: AttachmentExportDependencies;
  withProject?: <T>(projectId: string, task: () => Promise<T>) => Promise<T>;
  withConversationLifecycle: <T>(task: () => Promise<T>) => Promise<T>;
  isConversationTransitioning?: (chatId: string) => Promise<boolean>;
  cancelConversations: (conversationIds: Iterable<string>) => Promise<void>;
  releaseConversations?: (conversationIds: Iterable<string>) => void;
  onTitleChanged?: (
    record: Pick<ChatRecord, "id" | "incarnationId" | "title">
  ) => Promise<void>;
  resolveAppAgent?: (appId: string, projectId: string) => AgentBackendId | undefined;
  assertAgentReady?: (agent: AgentBackendId) => Promise<void>;
  chatHomes?: ChatHomeCreationPort;
  isProjectArchived?: (projectId: string) => boolean;
  isAppProject?: (projectId: string) => boolean;
  resolveProjectWorkspace?: (
    projectId: string
  ) => string | null | Promise<string | null>;
  onAppChatCreated?: (input: {
    appId: string;
    chatId: string;
    appRole: AppChatRole;
  }) => Promise<void>;
  onAdoptedSessionBound?: (session: SessionRef, chatId: string) => void;
};
