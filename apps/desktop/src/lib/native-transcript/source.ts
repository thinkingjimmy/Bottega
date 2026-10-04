/**
 * [INPUT]: Depends on the chats timeline IPC (timelinePage / timelineAround) and the shared TranscriptSession's source, row and head contracts
 * [OUTPUT]: Provides nativeTranscriptSource and nativeTranscriptRows: the desktop's native Chat as a SessionSource of ChatMessage rows (TASK-25 S4d)
 * [POS]: lib/native-transcript's read port; the shared session owns the window, this only maps the native IPC's cursor pages onto its segments
 */

import type { SessionHead, SessionPage, SessionSource, TranscriptRows } from "@ai-chat/chat-ui/transcript-session";
import type { ChatMessage, ChatTimelineCursor, ChatTimelinePage, ChatTimelinePageInput, ChatTimelineAroundInput } from "../../../shared/ipc/content/chats-ipc";

type TimelineBridge = Readonly<{
  timelinePage(input: ChatTimelinePageInput): Promise<ChatTimelinePage | null>;
  timelineAround(input: ChatTimelineAroundInput): Promise<ChatTimelinePage | null>;
}>;
type Fence = Pick<ChatTimelineCursor, "incarnationId" | "nativeMessageRevision" | "activeGenerationId">;

const isImported = (row: ChatMessage) => row.segment === "imported";

export const nativeTranscriptRows: TranscriptRows<ChatMessage, ChatMessage> = {
  nativeSeq: (row) => row.seq,
  nativeKey: (row) => row.id,
  importedKey: (row) => row.id,
  imported: async (page) => [...page.imported].sort((a, b) => a.seq - b.seq).map((entry) => ({ kind: "imported" as const, entry })),
};

export function nativeTranscriptSource(bridge: TimelineBridge): SessionSource<ChatMessage, ChatMessage, SessionHead> {
  const fences = new Map<string, Fence>();
  const read = async (input: ChatTimelinePageInput) => {
    let page: ChatTimelinePage | null;
    try {
      page = await bridge.timelinePage(input);
    } catch (cause) {
      // The native fence moved (a rewrite or a new generation): the session answers this by reading the tail again.
      if (String(cause).includes("CHAT_TIMELINE_STALE")) throw new Error("CHAT_BODY_CHANGED");
      throw cause;
    }
    if (!page) throw new Error("CHAT_TIMELINE_UNAVAILABLE");
    fences.set(input.chatId, { incarnationId: page.incarnationId, nativeMessageRevision: page.nativeMessageRevision, activeGenerationId: page.activeGenerationId });
    return page;
  };
  return {
    async page(input) {
      const imported = input.segment === "imported";
      let fence = fences.get(input.chatId);
      if (imported && !fence) { await read({ chatId: input.chatId, limit: 1 }); fence = fences.get(input.chatId); }
      const cursor: ChatTimelineCursor | null = imported
        ? { segment: "imported", beforeSeq: input.beforeSeq ?? Number.MAX_SAFE_INTEGER, ...fence! }
        : input.beforeSeq !== null && fence ? { segment: "native", beforeSeq: input.beforeSeq, ...fence } : null;
      const page = await read({ chatId: input.chatId, cursor, limit: input.limit });
      // The native IPC runs from the native tail into the imported prefix on one page; each segment keeps only its own rows.
      let rows = page.messages.filter((row) => isImported(row) === imported);
      const exhausted = !page.hasMoreBefore || (!imported && page.olderCursor?.segment === "imported") || rows.length < page.messages.length;
      let complete = exhausted;
      if (input.afterSeq !== undefined) {
        // The IPC has no afterSeq: a tail read covers every appended row only if it reaches back to afterSeq.
        complete = exhausted || rows.some((row) => row.seq <= input.afterSeq! + 1);
        rows = rows.filter((row) => row.seq > input.afterSeq!);
      }
      const oldest = rows.reduce((low, row) => Math.min(low, row.seq), Number.MAX_SAFE_INTEGER);
      const result: SessionPage<ChatMessage, ChatMessage> = {
        chatId: input.chatId, incarnationId: page.incarnationId, segment: input.segment, revision: page.nativeMessageRevision,
        generationId: page.activeGenerationId, state: "ready", messages: imported ? [] : rows, imported: imported ? rows : [],
        cursor: complete || !rows.length ? null : oldest, complete: complete || !rows.length,
      };
      return result;
    },
    async locate(chatId, messageId) {
      const page = await bridge.timelineAround({ chatId, messageId, radius: 1 });
      const hit = page?.messages.find((row) => row.id === messageId);
      return hit ? { segment: isImported(hit) ? "imported" : "native", seq: hit.seq } : null;
    },
    subscribe: () => () => {},
  };
}
