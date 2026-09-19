/**
 * [INPUT]: Confirmed native/imported pages and immutable Chat identity.
 * [OUTPUT]: A 400-row canonical outline with exact segment/sequence navigation and revision fences.
 * [POS]: Portable outline reader; authenticated imported previews avoid downloading full historical blobs.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { TranscriptSource } from "../contracts";
import type { TranscriptPage } from "../model";
import type { CanonicalOutlineItem } from "../../ui/conversation/timeline/outline-model";
export function createTranscriptOutline(head: CloudChatHead, source: TranscriptSource) {
  let locations = new Map<string, { segment: "native" | "imported"; seq: number }>();
  return { locate: (id: string) => locations.get(id), async read(signal: AbortSignal): Promise<CanonicalOutlineItem[]> {
    const items: CanonicalOutlineItem[] = [], nextLocations = new Map<string, { segment: "native" | "imported"; seq: number }>();
    for (const segment of ["native", "imported"] as const) {
      let previous: TranscriptPage | undefined;
      while (items.length < 400) {
        signal.throwIfAborted();
        const page = await source.page({ chatId: head.chat.id, segment, revision: previous?.revision ?? null,
          generationId: previous?.generationId ?? null, beforeSeq: previous?.cursor ?? null, limit: 50 }, signal, head);
        if (page.chatId !== head.chat.id || page.incarnationId !== head.chat.incarnationId || page.segment !== segment || page.state !== "ready") throw new Error("CHAT_OUTLINE_UNAVAILABLE");
        if (previous && (page.revision !== previous.revision || page.generationId !== previous.generationId)) throw new Error("CHAT_OUTLINE_STALE");
        const rows = segment === "native" ? page.messages.map(({ message }) => ({ messageId: message.id, seq: message.seq, role: message.role,
          text: "content" in message ? message.content.slice(0, 512) : "" })) : page.imported.map(entry => ({ messageId: entry.entryVersionId, seq: entry.deliverySeq, role: entry.role, text: entry.preview.slice(0, 512) }));
        for (const row of rows.sort((a, b) => b.seq - a.seq).slice(0, 400 - items.length)) {
          if (nextLocations.has(row.messageId)) throw new Error("CHAT_OUTLINE_STALE");
          items.unshift(row); nextLocations.set(row.messageId, { segment, seq: row.seq });
        }
        if (page.complete) break;
        if (page.cursor === null || previous && page.cursor >= previous.cursor!) throw new Error("CHAT_OUTLINE_CURSOR");
        previous = page;
      }
    }
    signal.throwIfAborted(); locations = nextLocations; return items;
  } };
}
