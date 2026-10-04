/**
 * [INPUT]: Depends on shared Agent/Chat contracts, Chat Home ownership, attachment export dependencies, fork-home capabilities, and deletion policy
 * [OUTPUT]: Defines Chat persistence ports, adoption readiness context and title generation/eligibility subscriptions.
 * [POS]: apps/desktop/electron/main/chats/service; Type-only composition boundary separating service wiring from runtime Chat orchestration
 */

import type { AgentBackendId, SessionRef } from "../../../../shared/ipc/agent/agent-ipc";
import type { AppChatRole, ChatRecord } from "../../../../shared/ipc/content/chats-ipc";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { AttachmentExportDependencies } from "../attachments/attachment-export";
import type { ChatDeletionOptions } from "../lifecycle/chat-deletion";
import type { ChatForkHomePort } from "../fork/chat-fork-service";

type ChatHomeCreationPort = ChatForkHomePort & Pick<ChatHomeService,
  "committedCreationEvidence" | "isolateCommittedCreation" |
  "assertDeletionAdmissible" | "releaseWorktreeForDeletion" |
  "releaseHomeForDeletion">;

export type ChatsServiceOptions = ChatDeletionOptions & {
  recoverTitleJobs?: boolean;
  generateTitle: (firstMessage: string, context?: { chatId: string }) => Promise<string>;
  subscribeTitleEligibility?(wake: () => void): () => void;
  libraryRoot: () => string | null;
  exportsRoot: string;
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
  assertAgentReady?: (agent: AgentBackendId, operation?: {
    conversationId: string; requestId: string; cwd: string; model?: string;
  }) => Promise<void>;
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
    origin: "local" | "remote";
  }) => Promise<void>;
  onAdoptedSessionBound?: (session: SessionRef, chatId: string) => void;
};
