/**
 * [INPUT]: Verified transcript pages and complete authenticated imported fields.
 * [OUTPUT]: Abortable private search with exact totals, revision-bound pagination and hit locations.
 * [POS]: Cloud search adapter; only identifiers survive scanning, and no plaintext goes to a search service.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { TranscriptSource } from "../contracts";
import type { TranscriptPage } from "../model";
import { importedTextWindow, readImportedField } from "./fields";
type Location = { segment: "native" | "imported"; seq: number };
type Cursor = { offset: number; query: string; revision: number };
export function createTranscriptFind(head: CloudChatHead, source: TranscriptSource) {
  let cached: { query: string; hits: { messageId: string }[]; locations: Map<string, Location> } | undefined;
  return {
    locate: (messageId: string) => cached?.locations.get(messageId),
    async find(input: { chatId: string; query: string; limit: number; cursor?: Cursor }, signal: AbortSignal) {
      signal.throwIfAborted();
      const query = input.query.trim().toLocaleLowerCase();
      if (input.chatId !== head.chat.id || input.cursor && (input.cursor.query !== query || input.cursor.revision !== head.bodyRevision)) throw new Error("CHAT_SEARCH_CHANGED");
      if (!query) return { items: [], total: 0, nextCursor: null };
      if (cached?.query !== query) {
        const hits: { messageId: string }[] = [], locations = new Map<string, Location>();
        for (const segment of ["native", "imported"] as const) {
          let previous: TranscriptPage | undefined;
          do {
            signal.throwIfAborted();
            const page = await source.page({ chatId: head.chat.id, segment, revision: previous?.revision ?? null, generationId: previous?.generationId ?? null,
              beforeSeq: previous?.cursor ?? null, limit: 50 }, signal, head);
            if (page.state !== "ready" || page.incarnationId !== head.chat.incarnationId) throw new Error("CHAT_SEARCH_UNAVAILABLE");
            if (previous && (page.revision !== previous.revision || page.generationId !== previous.generationId)) throw new Error("CHAT_SEARCH_CHANGED");
            for (const body of page.messages) {
              const message = body.message;
              const content = "content" in message ? message.content : "";
              const parts = "parts" in message ? message.parts?.map(part => "text" in part ? part.text : "detail" in part ? part.detail : "").join("\n") : "";
              if (`${content}\n${parts ?? ""}`.toLocaleLowerCase().includes(query)) {
                hits.push({ messageId: message.id }); locations.set(message.id, { segment, seq: message.seq });
              }
            }
            for (const entry of page.imported) {
              const field = entry.fields.find(value => value.field === "content")!;
              const blob = await readImportedField(head.chat.id, field, source, signal);
              if (await contains(blob, query, signal)) { hits.push({ messageId: entry.entryVersionId }); locations.set(entry.entryVersionId, { segment, seq: entry.deliverySeq }); }
            }
            if (!page.complete && (page.cursor === null || page.cursor === previous?.cursor)) throw new Error("CHAT_SEARCH_CURSOR");
            previous = page;
          } while (!previous.complete);
        }
        signal.throwIfAborted(); cached = { query, hits: hits.sort((a, b) => { const left = locations.get(a.messageId)!, right = locations.get(b.messageId)!;
          return Number(left.segment === "native") - Number(right.segment === "native") || left.seq - right.seq; }), locations };
      }
      const offset = input.cursor?.offset ?? 0, end = offset + input.limit;
      return { items: cached.hits.slice(offset, end), total: cached.hits.length,
        nextCursor: end < cached.hits.length ? { offset: end, query, revision: head.bodyRevision } : null };
    },
  };
}
async function contains(blob: Blob, query: string, signal: AbortSignal) {
  let offset: number | null = 0, tail = "";
  while (offset !== null) {
    const window = await importedTextWindow(blob, offset, signal), text = tail + window.text.toLocaleLowerCase();
    if (text.includes(query)) return true;
    tail = query.length > 1 ? text.slice(-(query.length - 1)) : ""; offset = window.next;
  }
  return false;
}
