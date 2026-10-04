/**
 * [INPUT]: Depends on catalog subscriptions, durable confirmed heads and restartable Chat hydration.
 * [OUTPUT]: Discovers owners before upload, retries incomplete workspace admission and schedules fair concurrent background reads with confirmed deletion eviction and open-Chat priority; a head whose owner has not published its body waits with a backoff instead of re-running the pass.
 * [POS]: Main downlink coordinator; memory only caches work scheduling, while Stores own progress and content.
 */
import { protocolHeader, type CloudFunctionArgs } from "@ai-chat/cloud-protocol";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { pullCatalogs, type CatalogPorts } from "./catalogs";
import { DesktopChatDownlink } from "./chats";
import type { DesktopBlobStore } from "../../files/store";
// A live catalog subscription is the primary refresh; the polls below are only a safety net for a missed notification.
const CATALOG_FLOOR = 300_000, WORKSPACE_FLOOR = 300_000, HYDRATE_BATCH = 16, HYDRATE_LANES = 4;
/* Another computer's first upload, or one it abandoned, leaves a head with no body for as long as it likes; the pass used
   to re-run every 250 ms for it (A-04). Such a head is asked again after this backoff, or at once when its signature or the
   catalog moves. */
const OWNER_WAIT_MIN = 30_000, OWNER_WAIT_MAX = 300_000;
type DownlinkTransport = CatalogPorts["transport"] & {
  watchChatCatalog?(input: CloudFunctionArgs<"chats/metadata:catalog">, changed: () => void, failed: (error: unknown) => void): () => void;
};
export class DesktopDownlink {
  private readonly chats: DesktopChatDownlink;
  private readonly heads = new Map<string, CloudChatHead>();
  private readonly checked = new Map<string, string>();
  private readonly visited = new Map<string, number>();
  private readonly waiting = new Map<string, { signature: string; delay: number; due: number }>();
  private ordinal = 0;
  private loaded = false;
  private dirty = true;
  private lastCatalogRead = 0;
  private lastProjectRead = 0;
  private workspaceIncomplete = true;
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly ports: CatalogPorts & { transport: DownlinkTransport; files: Pick<EncryptedBlobTransfer, "readFile">; cache?: Pick<DesktopBlobStore, "read">;
    wake(): void; failure(error: unknown): void; beforeReceipts?(head: CloudChatHead): Promise<void>; afterBody?(head: CloudChatHead): Promise<void> }) {
    this.chats = new DesktopChatDownlink({ ...ports, store: ports.chats });
  }
  start() {
    const crypto = this.ports.crypto();
    // Subscriptions outlive their socket (T20-1b), so a second start must release the first rather than leave it attached.
    this.unsubscribe?.();
    this.unsubscribe = this.ports.transport.watchChatCatalog?.({ ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } },
      () => { this.dirty = true; for (const entry of this.waiting.values()) entry.due = 0; this.ports.wake(); },
      error => { this.dirty = true; this.ports.failure(error); }) ?? null;
  }
  forget(chatIds: string[]) {
    for (const chatId of chatIds) { this.heads.delete(chatId); this.checked.delete(chatId); this.visited.delete(chatId); this.waiting.delete(chatId); }
  }
  private async load() {
    if (this.loaded) return;
    let afterId: string | null = null;
    for (;;) {
      this.ports.current(); const page = await this.ports.chats.read(this.ports.scope, { type: "confirmed-chat-page", afterId, limit: 50 });
      if (page.type !== "confirmed-chat-page") throw new Error("CHAT_HEADS_UNAVAILABLE");
      for (const head of page.value.items) this.heads.set(head.chat.id, head);
      if (page.value.complete) break;
      if (!page.value.cursor || page.value.cursor === afterId) throw new Error("CHAT_CATALOG_CURSOR_INVALID"); afterId = page.value.cursor;
    }
    this.loaded = true;
  }
  async discover() {
    this.ports.current(); await this.load();
    const now = Date.now(), projectsDue = this.workspaceIncomplete || now - this.lastProjectRead >= WORKSPACE_FLOOR;
    if (this.dirty || now - this.lastCatalogRead >= CATALOG_FLOOR || projectsDue) {
      this.dirty = false;
      try {
        let workspaceFailed = false;
        const heads = await pullCatalogs({ ...this.ports, failure: error => { workspaceFailed = true; this.ports.failure(error); } }, projectsDue);
        for (const head of heads) this.heads.set(head.chat.id, head);
        this.lastCatalogRead = now;
        if (projectsDue) { this.lastProjectRead = now; this.workspaceIncomplete = workspaceFailed; }
      } catch (error) { this.dirty = true; this.loaded = false; throw error; }
    }
  }
  /** `downloading` heads still owe a read, `waiting` ones wait on their owner, `progressed` says whether another pass now would do more. */
  async flush(dirtyChatIds: Set<string>) {
    await this.discover();
    const now = Date.now(), owed = (head: CloudChatHead) => this.checked.get(head.chat.id) !== this.signature(head);
    const waits = (head: CloudChatHead) => this.waiting.get(head.chat.id)?.signature === this.signature(head) && !dirtyChatIds.has(head.chat.id);
    const pending = [...this.heads.values()].filter(head => (dirtyChatIds.has(head.chat.id) || owed(head)) && !(waits(head) && now < this.waiting.get(head.chat.id)!.due));
    pending.sort((a, b) => (this.visited.get(a.chat.id) ?? 0) - (this.visited.get(b.chat.id) ?? 0));
    const batch = pending.slice(0, HYDRATE_BATCH); let next = 0, hydrated = 0;
    const lane = async () => {
      for (let index = next++; index < batch.length; index = next++) {
        const head = batch[index]!, signature = this.signature(head);
        this.ports.current(); this.visited.set(head.chat.id, ++this.ordinal);
        try {
          if (await this.chats.hydrate(head)) { this.checked.set(head.chat.id, signature); this.waiting.delete(head.chat.id); hydrated++; continue; }
          const previous = this.waiting.get(head.chat.id), delay = previous?.signature === signature ? Math.min(previous.delay * 2, OWNER_WAIT_MAX) : OWNER_WAIT_MIN;
          this.waiting.set(head.chat.id, { signature, delay, due: Date.now() + delay });
        } catch (error) { this.ports.failure(error); }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(HYDRATE_LANES, batch.length)) }, lane));
    const unread = [...this.heads.values()].filter(owed), waiting = unread.filter(waits).length;
    return { downloading: unread.length - waiting, waiting, progressed: hydrated > 0 || pending.length > batch.length };
  }
  async open(chatId: string) {
    this.ports.current();
    const local = await this.ports.chats.read(this.ports.scope, { type: "chat-metadata", chatId });
    if (local.type !== "chat-metadata" || !local.value.head) throw new Error("CHAT_HEAD_UNAVAILABLE");
    const head = local.value.head;
    this.heads.set(chatId, head);
    if (await this.chats.hydrate(head)) { this.checked.set(chatId, this.signature(head)); this.waiting.delete(chatId); }
  }
  private signature(head: CloudChatHead) { return hashChatContent([head.bodyRevision, head.reservedThroughSeq, head.openTurnId]); }
  async close() { this.unsubscribe?.(); this.unsubscribe = null; await this.chats.close(); }
}
