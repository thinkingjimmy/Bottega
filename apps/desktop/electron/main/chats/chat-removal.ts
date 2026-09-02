/**
 * [INPUT]: Depends on ChatStore, ChatDeletionDriver, conversation lifecycle/cancellation ports, and optional App chat deactivation
 * [OUTPUT]: Provides ChatRemovalController for renderer (which refuses imported readonly Chats), App-held, purge, and Project-held deletion paths
 * [POS]: The chats deletion orchestration boundary; ChatsService delegates removal while durable deletion details remain in ChatDeletionDriver
 */

import type { ChatRecord } from "../../../shared/chats-ipc";
import type { ConversationDeletionMode } from "../deletion/conversation-deletion-coordinator";
import { ChatNotFoundError } from "./chat-commit";
import type { ChatDeletionDriver } from "./chat-deletion";
import type { ChatStore } from "./chat-store";
import type { ChatMetadata } from "./chat-summary";

type ChatLifecycleFacts = Omit<ChatMetadata, "preview">;

type ChatRemovalPorts = {
  store: ChatStore;
  deletion: ChatDeletionDriver;
  withConversationLifecycle<T>(task: () => Promise<T>): Promise<T>;
  isConversationTransitioning?(chatId: string): Promise<boolean>;
  cancelConversations(conversationIds: Iterable<string>): Promise<void>;
  releaseConversations?(conversationIds: Iterable<string>): void;
};

export class ChatRemovalController {
  private appDeactivation: ((
    chat: ChatLifecycleFacts,
    action: "archive" | "delete"
  ) => Promise<void>) | null = null;

  constructor(private readonly ports: ChatRemovalPorts) {}

  configureAppDeactivation(
    handler: (chat: ChatLifecycleFacts, action: "archive" | "delete") => Promise<void>
  ) {
    if (this.appDeactivation) {
      throw new Error("App chat deactivation is already configured");
    }
    this.appDeactivation = handler;
  }

  prepareForArchive(chat: ChatLifecycleFacts) {
    return this.appDeactivation?.(chat, "archive") ?? Promise.resolve();
  }

  assertOrdinaryTurnAllowed(chatId: string) {
    if (this.ports.deletion.hasActive(chatId)) {
      throw new Error("聊天正在删除，不能启动新请求");
    }
  }

  /* 渲染层发起的永久删除仍然拒绝导入的只读会话：产品面把它的垃圾桶
     置灰，这里就是那道栅栏。删除 Project 与清空归档走的是另外两条路，
     它们必须能连只读会话一起带走——仓储层因此不再自己设限。 */
  async remove(chatId: string) {
    const candidate = await this.requireRecord(chatId);
    if (candidate.readOnlyReason === "external-readonly") {
      throw Object.assign(new Error("导入的只读会话不能永久删除"), { status: 409 });
    }
    await this.appDeactivation?.(candidate, "delete");
    const memory = await this.ports.deletion.snapshot(candidate);
    let record: ChatRecord | null = null;
    await this.ports.withConversationLifecycle(async () => {
      if (await this.ports.isConversationTransitioning?.(chatId)) {
        throw Object.assign(
          new Error("聊天正在保存为 App，完成或回滚前不能删除"),
          { status: 409 }
        );
      }
      const current = await this.requireRecord(chatId);
      this.assertSnapshotCurrent(candidate, current);
      record = current;
      await this.ports.deletion.prepare(current, "local-only", memory);
    });
    await this.ports.cancelConversations([chatId]);
    await this.ports.deletion.drive(record!);
    this.ports.releaseConversations?.([chatId]);
  }

  async removeAppChatHeld(chatId: string, appId: string) {
    const candidate = await this.requireRecord(chatId);
    if (
      candidate.context.kind === "ordinary" ||
      candidate.context.appId !== appId
    ) {
      throw new Error("App delete cannot remove an ordinary or foreign chat");
    }
    const memory = await this.ports.deletion.snapshot(candidate);
    const current = await this.requireRecord(chatId);
    this.assertSnapshotCurrent(candidate, current);
    await this.ports.deletion.prepare(current, "local-only", memory);
    await this.ports.cancelConversations([chatId]);
    await this.ports.deletion.drive(current);
    this.ports.releaseConversations?.([chatId]);
  }

  async removeFromPurge(
    chatId: string,
    mode: ConversationDeletionMode = "local-only"
  ) {
    const candidate = await this.requireRecord(chatId);
    const memory = await this.ports.deletion.snapshot(candidate);
    let record: ChatRecord | null = null;
    await this.ports.withConversationLifecycle(async () => {
      const current = await this.requireRecord(chatId);
      this.assertSnapshotCurrent(candidate, current);
      record = current;
      await this.ports.deletion.prepare(current, mode, memory);
    });
    await this.ports.cancelConversations([chatId]);
    await this.ports.deletion.drive(record!, mode);
    this.ports.releaseConversations?.([chatId]);
  }

  async removeByProject(projectId: string, projectLifecycle?: "held") {
    for (const chatId of this.ports.store.listByProject(projectId)) {
      const candidate = await this.requireRecord(chatId);
      const memory = await this.ports.deletion.snapshot(candidate);
      let record: ChatRecord | null = null;
      const prepare = async () => {
        const current = await this.requireRecord(chatId);
        this.assertSnapshotCurrent(candidate, current);
        if (current.projectId !== projectId) return;
        record = current;
        await this.ports.deletion.prepare(current, "local-only", memory);
      };
      if (projectLifecycle === "held") await prepare();
      else await this.ports.withConversationLifecycle(prepare);
      if (!record) continue;
      await this.ports.cancelConversations([chatId]);
      await this.ports.deletion.drive(record);
      this.ports.releaseConversations?.([chatId]);
    }
  }

  private async requireRecord(chatId: string) {
    const record = await this.ports.store.getConversation(chatId);
    if (!record) throw new ChatNotFoundError(chatId);
    return record;
  }

  private assertSnapshotCurrent(expected: ChatRecord, current: ChatRecord) {
    if (
      expected.incarnationId !== current.incarnationId ||
      expected.projectId !== current.projectId
    ) {
      throw Object.assign(new Error("Chat 归属已变化，请重试删除"), {
        status: 409,
      });
    }
  }
}
