/**
 * [INPUT]: Depends on Chat/Attachment Store, durable ConversationDeletionCoordinator, Memory Space, only derivative function/section effect, port and name resource releaser
 * [OUTPUT]: Provides ChatDeletionDriver: local-only/cleanup-and-rebuild prepare/drive Both sections are deleted, restarted, activated fence and coordinatorless synchronous degradation
 * [POS]: The chat module removes the adaptive layer; ChatsService is only responsible for admission/cancel, and deletes journal and resource details without leaking back to the main page
 */

import type { ChatRecord, ChatsEvent } from "../../../shared/chats-ipc";
import type {
  ConversationDeletionCoordinator,
  ConversationDeletionMode,
  ConversationDeletionResource,
  DeletionMemoryIntent,
  DeletionRecord,
} from "../deletion/conversation-deletion-coordinator";
import type { AttachmentStore } from "./attachment-store";
import type { ChatStore } from "./chat-store";
import { memorySpaceId } from "../memory/core/domain";

export type ChatDeletionOptions = {
  validateDeletionFence?: (record: DeletionRecord) => void;
  fenceConversation?: (record: DeletionRecord) => Promise<void>;
  memoryDeletion?: {
    snapshot(record: DeletionRecord, operationId: string): Promise<DeletionMemoryIntent>;
    applyPolicy(intent: DeletionMemoryIntent): Promise<{ receiptDigest: string }>;
    drain(intent: DeletionMemoryIntent): Promise<void>;
    applyDelivery(intent: DeletionMemoryIntent): Promise<ReadonlyArray<{ receiptDigest: string }>>;
    verifyReceipts(
      intent: DeletionMemoryIntent,
      policyReceiptDigest: string,
      deliveryReceiptDigests: readonly string[],
      mode: ConversationDeletionMode
    ): Promise<void> | void;
  };
  deletionResources?: readonly ConversationDeletionResource[];
  deletionCoordinator?: ConversationDeletionCoordinator;
};

const NO_MEMORY_DELETION = {
  snapshot: async (record: DeletionRecord, operationId: string) => ({
    operationId,
    sourceSessionKey: `${record.id}:${record.incarnationId}`,
    memorySpaceId: memorySpaceId({
      kind: "chat",
      chatId: record.id,
      incarnationId: record.incarnationId,
      sharingGeneration: 1,
    }),
  }),
  applyPolicy: async () => ({ receiptDigest: "no-memory" }),
  drain: async () => undefined,
  applyDelivery: async () => [],
  verifyReceipts: async (
    _intent: DeletionMemoryIntent,
    policyReceiptDigest: string,
    deliveryReceiptDigests: readonly string[]
  ) => {
    if (policyReceiptDigest !== "no-memory" || deliveryReceiptDigests.length) {
      throw new Error("无 Memory 删除 receipt 不一致");
    }
  },
};

export class ChatDeletionDriver {
  constructor(
    private readonly store: ChatStore,
    private readonly attachments: AttachmentStore,
    private readonly options: ChatDeletionOptions,
    private readonly emit: (event: ChatsEvent) => void
  ) {}

  hasActive(chatId: string) {
    return this.options.deletionCoordinator?.hasActive(chatId) ?? false;
  }

  recover(waitForCompletion = true) {
    return this.options.deletionCoordinator?.recover(
      this.callbacks(),
      waitForCompletion
    );
  }

  async remove(
    record: ChatRecord,
    mode: ConversationDeletionMode = "local-only"
  ) {
    await this.prepare(record, mode);
    return this.drive(record, mode);
  }

  async prepare(
    record: ChatRecord,
    mode: ConversationDeletionMode = "local-only",
    preparedMemory?: DeletionMemoryIntent
  ) {
    const coordinator = this.options.deletionCoordinator;
    if (coordinator) {
      return coordinator.prepare(record, this.callbacks(), mode, preparedMemory);
    }
  }

  snapshot(record: DeletionRecord) {
    const operationId = `delete:${record.id}:${record.incarnationId}`;
    return this.memory().snapshot(record, operationId);
  }

  async drive(
    record: ChatRecord,
    mode: ConversationDeletionMode = "local-only"
  ) {
    const coordinator = this.options.deletionCoordinator;
    if (coordinator) {
      return coordinator.drive(record, this.callbacks());
    }
    const memory = this.memory();
    const operationId = `delete:${record.id}:${record.incarnationId}`;
    const intent = await memory.snapshot(record, operationId);
    await this.options.fenceConversation?.(record);
    await memory.applyPolicy(intent);
    await memory.drain(intent);
    if (mode === "cleanup-and-rebuild") await memory.applyDelivery(intent);
    const metas = await this.store.remove(record.id, record.incarnationId);
    for (const resource of this.resources()) {
      await resource.release(record, metas, "deleted-proven");
    }
    this.emit({ type: "removed", chatId: record.id });
  }

  private callbacks() {
    const memory = this.memory();
    return {
      validateFence: (record: DeletionRecord) =>
        this.options.validateDeletionFence?.(record),
      snapshot: (record: DeletionRecord, operationId: string) =>
        memory.snapshot(record, operationId),
      fence: async (record: DeletionRecord) => {
        await this.options.fenceConversation?.(record);
      },
      applyPolicy: (intent: DeletionMemoryIntent) => memory.applyPolicy(intent),
      drain: (intent: DeletionMemoryIntent) => memory.drain(intent),
      applyDelivery: (intent: DeletionMemoryIntent) =>
        memory.applyDelivery(intent),
      verifyReceipts: (
        intent: DeletionMemoryIntent,
        policyReceiptDigest: string,
        deliveryReceiptDigests: readonly string[],
        mode: ConversationDeletionMode
      ) => memory.verifyReceipts(
        intent,
        policyReceiptDigest,
        deliveryReceiptDigests,
        mode
      ),
      removeChat: async (record: DeletionRecord) => {
        if (!this.store.has(record.id)) return;
        await this.store.remove(record.id, record.incarnationId);
      },
      onChatRemoved: (record: DeletionRecord) => {
        this.emit({ type: "removed", chatId: record.id });
      },
      onCleanupError: (record: DeletionRecord, _cause: unknown) => {
        const message = `聊天 ${record.id} 删除待完成，应用会在启动时继续`;
        this.store.pushWarning(message);
        this.emit({ type: "warning", message });
      },
      resources: this.resources(),
    };
  }

  private resources(): ConversationDeletionResource[] {
    return [
      ...(this.options.deletionResources ?? []),
      {
        id: "attachments",
        release: async (_record, attachments) => {
          const { failed } = await this.attachments.remove([...attachments]);
          if (failed.length) throw new Error(`${failed.length} 个附件删除失败`);
        },
      },
    ];
  }

  private memory() {
    return this.options.memoryDeletion ?? NO_MEMORY_DELETION;
  }
}
