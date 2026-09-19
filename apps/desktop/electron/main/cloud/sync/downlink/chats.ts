/**
 * [INPUT]: Depends on formal bounded native reads, verified private bodies and existing mirror/receipt transactions.
 * [OUTPUT]: Hydrates complete native/imported mirrors across restarts and reconciles executor-independent settled results.
 * [POS]: Main downlink lifetime; incomplete bodies remain explicitly pending and local authority is never synthesized.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import { prepareMessageBlockReader } from "@ai-chat/cloud-protocol/chats/encrypted/messages/batch";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "../chats/sources";
import type { AccountTransport } from "../../runtime/transport";
import type { CloudAction } from "../../../chats/sqlite/cloud/protocol";
import { TurnReceiptConsumer } from "../turn-receipt-consumer";
import { hydrateImportedHistory } from "./imported";
import type { DesktopBlobStore } from "../../files/store";
export class DesktopChatDownlink {
  private get header() { const crypto = this.ports.crypto(); return { ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  private readonly controller = new AbortController();
  private readonly flights = new Map<string, Promise<boolean>>();
  private readonly consumer: TurnReceiptConsumer;
  constructor(private readonly ports: { crypto(): FileCipherPort; config: CloudBuildConfig; scope: SyncScope; store: ChatSyncStore; files: Pick<EncryptedBlobTransfer, "readFile">;
    transport: Pick<AccountTransport, "query">; cache?: Pick<DesktopBlobStore, "read">; current(): void; changed(): void;
    beforeReceipts?(head: CloudChatHead): Promise<void>; afterBody?(head: CloudChatHead): Promise<void>; skipReceipts?: boolean }) {
    this.consumer = new TurnReceiptConsumer({ ...ports, signal: this.controller.signal });
  }
  private current() { this.controller.signal.throwIfAborted(); this.ports.current(); }
  private mutate(action: CloudAction) {
    this.current(); return this.ports.store.mutate(this.ports.scope, hashChatContent(["mirror-delivery", 3, this.ports.scope, action]), action);
  }
  hydrate(head: CloudChatHead) {
    const previous = this.flights.get(head.chat.id); if (previous) return previous;
    const flight = this.read(head); this.flights.set(head.chat.id, flight);
    void flight.finally(() => { if (this.flights.get(head.chat.id) === flight) this.flights.delete(head.chat.id); }).catch(() => {}); return flight;
  }
  private async read(head: CloudChatHead) {
    const { store, scope, transport } = this.ports; this.current();
    const cached = await store.read(scope, { type: "mirror-download", chatId: head.chat.id }); this.current();
    const complete = cached.type === "mirror-download" && cached.value?.complete && cached.value.bodyRevision === head.bodyRevision &&
      cached.value.head.chat.incarnationId === head.chat.incarnationId;
    if (!complete) {
      const native = await transport.query("chats/body/reads:head", { ...this.header, chatId: head.chat.id }); this.current();
      if (native.state !== "ready") return false;
      if (native.bodyRevision !== head.bodyRevision) throw new Error("MIRROR_HEAD_CHANGED");
    }
    const begin = await this.mutate({ type: "begin-mirror-body", head });
    if (begin.result.type !== "begin-mirror-body") throw new Error("MIRROR_DOWNLOAD_UNAVAILABLE");
    const progress = await store.read(scope, { type: "mirror-download", chatId: head.chat.id });
    if (progress.type !== "mirror-download" || !progress.value) throw new Error("MIRROR_DOWNLOAD_UNAVAILABLE");
    if (!progress.value.complete) {
      let beforeSeq = progress.value.beforeSeq;
      for (;;) {
        this.current(); const page = await transport.query("chats/body/reads:page", { ...this.header, chatId: head.chat.id,
          incarnationId: head.chat.incarnationId, throughRevision: head.bodyRevision, afterSeq: 0, beforeSeq, limit: 50 }); this.current();
        const blocks = await prepareMessageBlockReader(page.items.flatMap(item => item.storage.kind === "encrypted" ? [item.storage.message] : []),
          batch => transport.query("chats/body/reads:blocks", { ...this.header, chatId: head.chat.id, blocks: batch }), this.controller.signal); this.current();
        for (const projection of page.items) {
          const body = await readChatBody(projection, head.chat, { crypto: this.ports.crypto,
            readPrefixPage: async (chatId, turnId, afterSeq, throughSeq, signal) => {
              signal.throwIfAborted(); const value = await transport.query("turns/reads:page", { ...this.header, chatId, turnId, afterSeq, throughSeq });
              signal.throwIfAborted(); this.current(); return value;
            },
            readBlock: (_chatId, bodyHash, blockId) => blocks(bodyHash, blockId) }, this.controller.signal); this.current();
          if (body) await this.mutate({ type: "stage-mirror-body", chatId: head.chat.id, bodyRevision: head.bodyRevision, beforeSeq, bodyHash: hashChatContent(body), body });
          else {
            if (projection.storage.kind !== "encrypted-turn-prefix") throw new Error("MIRROR_EMPTY_PREFIX_REQUIRED");
            await this.mutate({ type: "stage-mirror-empty", chatId: head.chat.id, bodyRevision: head.bodyRevision, beforeSeq, prefix: projection.storage.prefix });
          }
          beforeSeq = projection.summary.seq;
        }
        if (page.complete) break;
        if (!page.items.length || page.cursor !== beforeSeq) throw new Error("MIRROR_BODY_PAGE_INVALID");
      }
      await this.mutate({ type: "complete-mirror-body", chatId: head.chat.id, bodyRevision: head.bodyRevision, beforeSeq }); this.current(); this.ports.changed();
    }
    if (!await hydrateImportedHistory({ ...this.ports, signal: this.controller.signal }, head)) return false;
    await this.ports.afterBody?.(head); this.current();
    await this.ports.beforeReceipts?.(head); this.current();
    if (this.ports.skipReceipts) return true;
    let afterSeq = 0;
    for (;;) {
      this.current(); const page = await transport.query("turns/reads:receipts", { ...this.header, chatId: head.chat.id, afterSeq, throughSeq: head.reservedThroughSeq });
      for (const receipt of page.items) { this.current(); await this.consumer.consume(receipt); }
      if (page.complete) return true;
      if (page.cursor === null || page.cursor <= afterSeq) throw new Error("TURN_RECEIPT_CURSOR_INVALID"); afterSeq = page.cursor;
    }
  }
  async close() { this.controller.abort(new Error("DOWNLINK_CLOSED")); await Promise.allSettled(this.flights.values()); }
}
