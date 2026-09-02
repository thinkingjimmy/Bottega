/**
 * [INPUT]: Depends on ChatStore revisions, Gallery redaction, renderer-event-bus, surface residence lookup, and the current main window
 * [OUTPUT]: Provides publishChatEvent and publishChatMutation with monotonic revisions, global storage-failure delivery, and ownership-scoped chat delivery
 * [POS]: The chats renderer event edge; ChatsService publishes durable facts without owning projection/routing policy
 */

import type { BrowserWindow } from "electron";
import { CHATS_CHANNEL, type ChatsEvent } from "../../../shared/chats-ipc";
import { redactImageDetails } from "../gallery/agent-image-projection";
import { rendererEventBus } from "../window/surfaces/renderer-event-bus";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import type { ChatMessageMutation, ChatStore } from "./chat-store";
import { summaryOfRecord as summaryOf } from "./chat-summary";

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
