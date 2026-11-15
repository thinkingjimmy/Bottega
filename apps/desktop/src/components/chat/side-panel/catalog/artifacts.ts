/**
 * [INPUT]: Native Chat identity, scoped timeline paging and persisted subagent parts.
 * [OUTPUT]: Saved Artifact pages for the shared third-column picker.
 * [POS]: Desktop read adapter that leaves transcript position and panel slots to their existing owners.
 */
import { savedMessageArtifacts } from "@ai-chat/chat-ui/side-panel/artifact-picker";
import { getChat, getChatTimelinePage } from "@/lib/chat/session/chats-client";
import type { ChatTimelineCursor } from "../../../../../shared/ipc/content/chats-ipc";

export async function* readNativeArtifactPages(chatId: string, incarnationId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let cursor: ChatTimelineCursor | null = null;
  const [chat, first] = await Promise.all([getChat(chatId), getChatTimelinePage({ chatId, limit: 50 })]);
  if (chat?.incarnationId !== incarnationId) throw new Error("Chat changed");
  let page = first;
  while (true) {
    signal.throwIfAborted();
    if (page?.chatId !== chatId || page.incarnationId !== incarnationId) throw new Error("Chat changed");
    yield [...page.messages].reverse().flatMap(message => savedMessageArtifacts(message, chat.subagents));
    const older = page.olderCursor;
    if (!page.hasMoreBefore || older?.segment === "imported") return;
    if (!older || (cursor && older.beforeSeq >= cursor.beforeSeq)) throw new Error("Invalid transcript cursor");
    cursor = older;
    signal.throwIfAborted();
    page = await getChatTimelinePage({ chatId, cursor, limit: 50 });
  }
}
