/**
 * [INPUT]: A host-owned Chat reader, creation identity and caller lifetime.
 * [OUTPUT]: Waits for the exact local Chat head before route navigation.
 * [POS]: Shared creation barrier; observing a head never grants execution authority.
 */
import type { ChatListSource } from "../../contracts";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
export function awaitChatHead(chats: Pick<ChatListSource, "head" | "subscribe">, identity: { chatId: string; incarnationId: string }, signal: AbortSignal, timeoutMs = 60_000): Promise<CloudChatHead> {
  return new Promise((resolve, reject) => {
    let finished = false, reading = false, dirty = false, stop = () => {};
    const finish = (head?: CloudChatHead, error?: unknown) => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearInterval(poll); stop(); signal.removeEventListener("abort", abort);
      if (head) resolve(head); else reject(error ?? new Error("CHAT_HEAD_UNAVAILABLE"));
    };
    const abort = () => finish(undefined, signal.reason ?? new Error("CHAT_HEAD_CANCELLED"));
    const read = async () => {
      if (finished) return;
      if (reading) { dirty = true; return; }
      reading = true;
      try {
        const head = await chats.head(identity.chatId, signal);
        if (head?.chat.id !== undefined && (head.chat.id !== identity.chatId || head.chat.incarnationId !== identity.incarnationId)) finish(undefined, new Error("CHAT_IDENTITY_CHANGED"));
        else if (head) finish(head);
      } catch { if (signal.aborted) abort(); }
      finally { reading = false; if (dirty && !finished) { dirty = false; void read(); } }
    };
    const deadline = setTimeout(() => finish(), timeoutMs), poll = setInterval(() => void read(), 2_000);
    signal.addEventListener("abort", abort, { once: true });
    try { stop = chats.subscribe(() => void read(), () => {}); if (finished) stop(); }
    catch (error) { finish(undefined, error); }
    if (signal.aborted) abort(); else void read();
  });
}
