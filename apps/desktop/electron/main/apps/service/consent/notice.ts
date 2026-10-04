/**
 * [INPUT]: Depends on the shared notice text and a stable id, the App's current Edit Chat and a canonical Chat append.
 * [OUTPUT]: Provides declinedNoticeWriter: writes `app-extension-declined` into the App's Edit Chat once per request (a remote decline names
 *           its device, a timeout says 30 minutes); an App without an Edit Chat gets none.
 * [POS]: apps/service/consent's Chat edge; the broker decides, this only records why the extension was not added (U06-d).
 */
import { noticeMessageContent, type ChatMessage } from "../../../../../shared/ipc/content/chats-ipc";
import { stableId } from "../../../sections/coordinator/coordinator-values";
import type { DeclinedNotice } from "./broker";

export function declinedNoticeWriter(ports: Readonly<{ editChat(appId: string): string | null; append(chatId: string, message: ChatMessage): Promise<unknown>; now(): number }>) {
  return async (declined: DeclinedNotice) => {
    const chatId = ports.editChat(declined.appId);
    if (!chatId) return;
    const notice = { kind: "app-extension-declined" as const, ...declined };
    // One notice per request: a retried write lands on the same id.
    await ports.append(chatId, { id: stableId("notice", `extension-declined:${declined.appId}:${declined.requestId}`), role: "notice",
      content: noticeMessageContent(notice), notice, createdAt: ports.now() } as ChatMessage);
  };
}
