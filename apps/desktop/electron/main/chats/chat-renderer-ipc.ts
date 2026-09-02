/**
 * [INPUT]: Depends on injectable renderer IPC registration, ChatStore, surface-scoped read policy, strict chat/attachment ids, Gallery redaction, and injected rename/remove/attachment ports
 * [OUTPUT]: Provides registerChatRendererIpc for testable scoped projections, bounded timeline/around/outline/find queries with image redaction, main-only storage failures, and validated mutations
 * [POS]: The chats renderer IPC adapter; ChatsService supplies domain callbacks while this module owns channel validation and window scope
 */

import type { BrowserWindow } from "electron";
import { CHATS_CHANNEL } from "../../../shared/chats-ipc";
import {
  rendererIpc,
  type RendererIpcRegistrar,
} from "../ipc-registrar";
import { redactImageDetails } from "../gallery/agent-image-projection";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { ATTACHMENT_ID_PATTERN, CHAT_ID_PATTERN } from "./chat-schema";
import type { ChatStore } from "./chat-store";
import { rejectLegacyRendererWrite } from "./chats-service-guards";
import type {
  ChatFindCursor,
  ChatOutlineCursor,
  ChatOutlineInput,
  ChatTimelineAroundInput,
  ChatTimelinePageInput,
} from "../../../shared/chats-ipc";

type ChatRendererIpcPorts = {
  store: ChatStore;
  isProjectArchived?(projectId: string): boolean;
  assertAdmission(): void;
  rename(input: unknown): Promise<unknown>;
  remove(chatId: string): Promise<void>;
  readAttachment(attachmentId: string): Promise<unknown>;
};

const assertChatId = (chatId: unknown) => {
  if (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId)) {
    throw new Error("聊天 id 格式无效");
  }
  return chatId;
};

const boundedLimit = (value: unknown, fallback: number, maximum: number) =>
  value === undefined
    ? fallback
    : Number.isInteger(value) && Number(value) > 0 && Number(value) <= maximum
      ? Number(value)
      : (() => { throw new Error("分页数量无效"); })();

const timelinePageInput = (value: unknown): ChatTimelinePageInput => {
  if (!value || typeof value !== "object") throw new Error("时间线分页参数无效");
  const input = value as Partial<ChatTimelinePageInput>;
  const chatId = assertChatId(input.chatId);
  const limit = boundedLimit(input.limit, 50, 200);
  if (input.cursor) {
    const cursor = input.cursor;
    if (
      cursor.segment !== "native" && cursor.segment !== "imported" ||
      !Number.isInteger(cursor.beforeSeq) || cursor.beforeSeq < 1 ||
      typeof cursor.incarnationId !== "string" ||
      !Number.isInteger(cursor.nativeMessageRevision) ||
      !(cursor.activeGenerationId === null || typeof cursor.activeGenerationId === "string")
    ) throw new Error("时间线游标无效");
  }
  return { chatId, limit, ...(input.cursor ? { cursor: input.cursor } : {}) };
};

const timelineAroundInput = (value: unknown): ChatTimelineAroundInput => {
  if (!value || typeof value !== "object") throw new Error("时间线定位参数无效");
  const input = value as Partial<ChatTimelineAroundInput>;
  if (typeof input.messageId !== "string" || !CHAT_ID_PATTERN.test(input.messageId)) {
    throw new Error("消息 id 格式无效");
  }
  if (input.fence && (
    typeof input.fence.incarnationId !== "string" ||
    !Number.isInteger(input.fence.nativeMessageRevision) ||
    !(input.fence.activeGenerationId === null || typeof input.fence.activeGenerationId === "string")
  )) {
    throw new Error("时间线定位围栏无效");
  }
  return {
    chatId: assertChatId(input.chatId),
    messageId: input.messageId,
    radius: boundedLimit(input.radius, 25, 100),
    ...(input.fence ? { fence: input.fence } : {}),
  };
};

const findCursor = (value: unknown): ChatFindCursor => {
  if (!value || typeof value !== "object") throw new Error("会话查找游标无效");
  const cursor = value as Partial<ChatFindCursor>;
  if (
    !Number.isInteger(cursor.offset) || Number(cursor.offset) < 0 ||
    typeof cursor.incarnationId !== "string" ||
    !Number.isInteger(cursor.nativeMessageRevision) ||
    !(cursor.activeGenerationId === null || typeof cursor.activeGenerationId === "string")
  ) {
    throw new Error("会话查找游标无效");
  }
  return cursor as ChatFindCursor;
};

const outlineInput = (value: unknown): ChatOutlineInput => {
  if (!value || typeof value !== "object") throw new Error("大纲分页参数无效");
  const input = value as Partial<ChatOutlineInput>;
  let cursor: ChatOutlineCursor | undefined;
  if (input.cursor !== undefined) {
    if (!input.cursor || typeof input.cursor !== "object") throw new Error("大纲游标无效");
    const candidate = input.cursor as Partial<ChatOutlineCursor>;
    if (
      candidate.segment !== "native" && candidate.segment !== "imported" ||
      !(candidate.beforeSeq === null ||
        (Number.isInteger(candidate.beforeSeq) && Number(candidate.beforeSeq) > 0)) ||
      typeof candidate.incarnationId !== "string" ||
      !Number.isInteger(candidate.nativeMessageRevision) ||
      !(candidate.activeGenerationId === null || typeof candidate.activeGenerationId === "string")
    ) throw new Error("大纲游标无效");
    cursor = candidate as ChatOutlineCursor;
  }
  return {
    chatId: assertChatId(input.chatId),
    limit: boundedLimit(input.limit, 100, 200),
    ...(cursor ? { cursor } : {}),
  };
};

export function registerChatRendererIpc(
  window: BrowserWindow,
  rendererUrl: string,
  ports: ChatRendererIpcPorts,
  register: RendererIpcRegistrar = rendererIpc
) {
  register(window, rendererUrl, "拒绝非主窗口的聊天请求")
    .roles("main", "app-window")
    .handleWithContext(CHATS_CHANNEL.list, (context) => {
      const scoped = surfaceWindowController.appWindowUseChat(context);
      const chats = context.role === "main"
        ? ports.store.list()
        : ports.store.list().filter((chat) => chat.id === scoped?.chatId);
      const warning = context.role === "main" ? ports.store.getWarning() : undefined;
      const storageFailures = context.role === "main"
        ? ports.store.getStorageFailures()
        : [];
      return {
        chats: chats.map((chat) => ({
          ...chat,
          effectiveArchived:
            Boolean(chat.archivedAt) ||
            Boolean(chat.projectId && ports.isProjectArchived?.(chat.projectId)),
        })),
        collectionSnapshotRevision: ports.store.getStoreRevision(),
        ...(warning ? { warning } : {}),
        ...(storageFailures.length > 0 ? { storageFailures } : {}),
      };
    })
    .handleWithContext(CHATS_CHANNEL.runtimeContext, async (context, chatId) => {
      const id = assertChatId(chatId);
      surfaceWindowController.assertAppConversationRead(context, id);
      return redactImageDetails(await ports.store.getRuntimeContext(id));
    })
    .handleWithContext(CHATS_CHANNEL.timelinePage, async (context, value) => {
      const input = timelinePageInput(value);
      surfaceWindowController.assertAppConversationRead(context, input.chatId);
      return redactImageDetails(await ports.store.timelinePage(input));
    })
    .handleWithContext(CHATS_CHANNEL.timelineAround, async (context, value) => {
      const input = timelineAroundInput(value);
      surfaceWindowController.assertAppConversationRead(context, input.chatId);
      return redactImageDetails(await ports.store.timelineAround(input));
    })
    .handleWithContext(CHATS_CHANNEL.outlinePage, async (context, value) => {
      const input = outlineInput(value);
      surfaceWindowController.assertAppConversationRead(context, input.chatId);
      return ports.store.outlinePage(input);
    })
    .handleWithContext(CHATS_CHANNEL.findMessages, async (context, value) => {
      if (!value || typeof value !== "object") throw new Error("会话查找参数无效");
      const input = value as {
        chatId?: unknown;
        query?: unknown;
        cursor?: unknown;
        limit?: unknown;
      };
      const chatId = assertChatId(input.chatId);
      if (
        typeof input.query !== "string" ||
        !input.query.trim() ||
        input.query.length > 512
      ) {
        throw new Error("会话查找查询无效");
      }
      const cursor = input.cursor === undefined
        ? undefined
        : findCursor(input.cursor);
      surfaceWindowController.assertAppConversationRead(context, chatId);
      return ports.store.findMessages({
        chatId,
        query: input.query,
        ...(cursor ? { cursor } : {}),
        limit: boundedLimit(input.limit, 100, 200),
      });
    })
    .roles("main")
    .handle(CHATS_CHANNEL.create, rejectLegacyRendererWrite)
    .handle(CHATS_CHANNEL.createForApp, rejectLegacyRendererWrite)
    .handle(CHATS_CHANNEL.append, rejectLegacyRendererWrite)
    .handle(CHATS_CHANNEL.rename, (input) => {
      ports.assertAdmission();
      return ports.rename(input);
    })
    .handle(CHATS_CHANNEL.remove, async (chatId) => {
      ports.assertAdmission();
      await ports.remove(assertChatId(chatId));
    })
    .roles("main", "app-window")
    .handleWithContext(
      CHATS_CHANNEL.readAttachment,
      async (context, attachmentId) => {
        if (
          typeof attachmentId !== "string" ||
          !ATTACHMENT_ID_PATTERN.test(attachmentId)
        ) {
          throw new Error("附件 id 格式无效");
        }
        if (context.role === "app-window") {
          const scoped = surfaceWindowController.appWindowUseChat(context);
          const referenced = scoped
            ? await ports.store.hasAttachmentReference(scoped.chatId, attachmentId)
            : false;
          if (!referenced) {
            throw new Error("App window attachment read rejected");
          }
        }
        return ports.readAttachment(attachmentId);
      }
    );
}
