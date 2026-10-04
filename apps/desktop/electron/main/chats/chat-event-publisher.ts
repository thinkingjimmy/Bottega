/**
 * [INPUT]: Depends on ChatStore revisions, Gallery redaction, renderer-event-bus, surface residence lookup, and the current main window
 * [OUTPUT]: Provides publishChatEvent and publishChatMutation with monotonic revisions, global storage-failure delivery, and ownership-scoped chat delivery; ChatEvents, the ChatsService event edge (in-process observers, emit/emitMutation and the publish* facts: upserted, record, storage failure, warning (kept for the next snapshot and sent live), session invalidated, recovery truncated, effective archive)
 * [POS]: The chats renderer event edge; ChatsService publishes durable facts without owning projection/routing policy
 */

import type { BrowserWindow } from "electron";
import { CHATS_CHANNEL, type ChatsEvent } from "../../../shared/ipc/content/chats-ipc";
import { redactImageDetails } from "../gallery/agent-image-projection";
import { rendererEventBus } from "../window/surfaces/renderer-event-bus";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import type { ChatMessageMutation, ChatStore } from "./chat-store";
import { summaryOfChatLike, summaryOfRecord as summaryOf, type ChatMetadata } from "./projection/chat-summary";
import type { ChatRecord } from "../../../shared/ipc/content/chats-ipc";
import type { ChatStorageFailure } from "../../../shared/product/product-failure";

export function publishChatMutation(
  mutation: ChatMessageMutation,
  emit: (event: ChatsEvent) => void
) {
  emit({ type: "upserted", summary: summaryOf(mutation.record) });
  if (mutation.appended.length === 0) return;
  if (mutation.mode === "replace") {
    emit({
      type: "messages",
      chatId: mutation.record.id,
      incarnationId: mutation.record.incarnationId,
      revision: mutation.revision,
      mode: "replace",
      messages: structuredClone(mutation.record.messages),
    });
    return;
  }
  emit({
    type: "messages-delta",
    chatId: mutation.record.id,
    incarnationId: mutation.record.incarnationId,
    revision: mutation.revision,
    appended: structuredClone(mutation.appended),
  });
}

export function publishChatEvent(input: {
  event: ChatsEvent;
  store: ChatStore;
  window: BrowserWindow | null;
}) {
  const { event } = input;
  const revisioned: ChatsEvent =
    event.type === "upserted"
      ? {
          ...event,
          chatRecordRevision:
            event.chatRecordRevision ?? event.summary.chatRecordRevision,
          collectionSnapshotRevision:
            event.collectionSnapshotRevision ?? input.store.getStoreRevision(),
        }
      : event.type === "removed"
        ? {
            ...event,
            chatRecordRevision: event.chatRecordRevision ?? 1,
            collectionSnapshotRevision:
              event.collectionSnapshotRevision ?? input.store.getStoreRevision(),
          }
        : event.type === "messages" || event.type === "messages-delta"
          ? {
              ...event,
              chatMessageRevision: event.chatMessageRevision ?? event.revision,
            }
          : event;
  const projected = redactImageDetails(revisioned);
  let delivered = rendererEventBus.toRole("main", CHATS_CHANNEL.event, projected);
  const chatId = event.type === "upserted"
    ? event.summary.id
    : event.type === "warning" || event.type === "storage-failure"
      ? null
      : event.chatId;
  const appId = chatId && surfaceWindowController.appIdForActiveUseChat(chatId);
  if (appId) {
    delivered += rendererEventBus.toApp(
      appId,
      CHATS_CHANNEL.event,
      projected
    );
  }
  if (!delivered && input.window && !input.window.isDestroyed()) {
    input.window.webContents.send(CHATS_CHANNEL.event, projected);
  }
}

/** ChatsService's event edge: in-process observers first (one failing never blocks the rest), then the renderer via publishChatEvent. */
export class ChatEvents {
  private readonly eventListeners = new Set<(event: ChatsEvent) => void>();
  constructor(
    private readonly store: ChatStore,
    private readonly window: () => BrowserWindow | null
  ) {}
  onEvent(listener: (event: ChatsEvent) => void) { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; }
  emit(event: ChatsEvent) {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch (cause) { console.warn("[chats] observer failed", cause); }
    }
    publishChatEvent({ event, store: this.store, window: this.window() });
  }
  emitMutation(mutation: ChatMessageMutation) {
    publishChatMutation(mutation, (event) => this.emit(event));
  }
  publishUpserted(summary: ReturnType<typeof summaryOfChatLike>) {
    this.emit({ type: "upserted", summary });
  }
  publishRecord(record: ChatRecord | ChatMetadata) {
    this.emit({
      type: "upserted",
      summary: summaryOfChatLike(record),
    });
  }
  /* 维护闸门这类全局失败没有 chatId：先进 store 的失败清单（重新拉快照也
     看得到），再广播给在线侧栏，两步一个入口，渲染层不必分先来后到。 */
  publishStorageFailure(failure: ChatStorageFailure) {
    this.store.pushStorageFailure(failure);
    this.emit({ type: "storage-failure", failure });
  }
  /** A notice with no chatId: kept for the next snapshot and sent to a window that already read one (it never re-reads on its own). */
  publishWarning(message: string) {
    this.store.pushWarning(message);
    this.emit({ type: "warning", message });
  }
  publishSessionInvalidated(record: Pick<ChatRecord, "id" | "incarnationId">) {
    this.emit({
      type: "session-invalidated",
      chatId: record.id,
      incarnationId: record.incarnationId,
    });
  }
  publishRecoveryTruncated(
    chatId: string,
    currentMessageId: string,
    inheritedThroughSeq: number
  ) {
    this.emit({
      type: "recovery-truncated",
      chatId,
      currentMessageId,
      inheritedThroughSeq,
    });
  }
  publishEffectiveArchive(
    record: ChatRecord | ChatMetadata,
    effectiveArchived: boolean
  ) {
    this.emit({
      type: "upserted",
      summary: {
        ...summaryOfChatLike(record),
        effectiveArchived,
      },
    });
  }
}
