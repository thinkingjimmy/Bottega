/**
 * [INPUT]: Depends on ChatStore, ChatHomeService, App agent/project validation ports, project serialization, and mutation publication
 * [OUTPUT]: Provides createDormantAppChat, an idempotent Chat Home + canonical App ChatRecord transaction
 * [POS]: chats/lifecycle transaction owner for use-slot identity; ChatsService remains a thin trusted facade
 */

import { randomUUID } from "node:crypto";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { AppChatRole, ChatRecord } from "../../../../shared/chats-ipc";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { ChatMessageMutation, ChatStore } from "../chat-store";

export type DormantAppChatInput = {
  intentId: string;
  id: string;
  appId: string;
  projectId: string;
  appRole: AppChatRole;
  title: string;
};

type Dependencies = {
  store: Pick<ChatStore, "get" | "create">;
  chatHomes: Pick<
    ChatHomeService,
    "assertCanCreateChat" | "beginCreation" | "markPrepared" |
    "commitCreation" | "rollbackCreation"
  > | undefined;
  resolveAgent(appId: string, projectId: string): AgentBackendId | undefined;
  withProject<T>(projectId: string, task: () => Promise<T>): Promise<T>;
  publish(mutation: ChatMessageMutation): void;
  now?: () => number;
  createMessageId?: () => string;
};

export async function createDormantAppChat(
  dependencies: Dependencies,
  input: DormantAppChatInput
): Promise<ChatRecord> {
  const homes = dependencies.chatHomes;
  homes?.assertCanCreateChat();
  const agent = dependencies.resolveAgent(input.appId, input.projectId);
  if (!agent) throw new Error("App 与 Project 绑定无效或 App 不可用");
  const result = await dependencies.withProject(input.projectId, async () => {
    const home = await homes?.beginCreation({
      intentId: input.intentId,
      chatId: input.id,
      submission: input,
      workspaceScope: { kind: "app", appId: input.appId },
    });
    if (!home) throw new Error("Chat Home 服务不可用");
    try {
      await homes!.markPrepared(input.id);
      const existing = await dependencies.store.get(input.id);
      if (existing) {
        assertExisting(existing, input, agent);
        await homes!.commitCreation(input.id);
        return { record: existing, mutation: null };
      }
      const mutation = await dependencies.store.create(
        input.id,
        {
          id: dependencies.createMessageId?.() ??
            `notice_${randomUUID().replaceAll("-", "")}`,
          role: "notice",
          content: "App Studio session is ready.",
          createdAt: dependencies.now?.() ?? Date.now(),
          seq: 1,
          notice: {
            kind: "app-chat-ready",
            appId: input.appId,
            appRole: input.appRole,
          },
        },
        input.projectId,
        agent,
        {
          incarnationId: home.incarnationId,
          homeDir: home.homeDir,
          title: input.title,
          appRole: input.appRole,
          dormantNotice: true,
        }
      );
      await homes!.commitCreation(input.id);
      return { record: mutation.record, mutation };
    } catch (cause) {
      await homes!.rollbackCreation(input.id);
      throw cause;
    }
  });
  if (result.mutation) dependencies.publish(result.mutation);
  return result.record;
}

function assertExisting(
  existing: ChatRecord,
  input: DormantAppChatInput,
  agent: AgentBackendId
) {
  if (
    existing.projectId !== input.projectId ||
    existing.appRole !== input.appRole ||
    existing.agent !== agent
  ) {
    throw new Error("App chat slot 与已有 canonical chat 冲突");
  }
}
