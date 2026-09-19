/**
 * [INPUT]: Depends on original SQLite deletion custody, scoped lifecycle RPCs and immutable checkpoints.
 * [OUTPUT]: Recovers original deletion results and resolves conflicts only against retained undeleted local records.
 * [POS]: Main deletion transport; account scope and retained local archives remain owned by their existing stores.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport";
import { assertDeletionReceipt, chatDeletionOperation } from "../../../chats/sqlite/cloud/deletion/model";
import { ChatDeliveryCheckpoints } from "../chats/checkpoints";
import { readOutboxSource, type ChatOutboxItem, type ChatSyncStore } from "../chats/sources";
export class DesktopDeletionPublisher {
  private get header() { const crypto = this.ports.crypto(); return { ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  constructor(private readonly ports: { crypto(): FileCipherPort; store: ChatSyncStore; scope: SyncScope; config: CloudBuildConfig;
    transport: Pick<AccountTransport, "query" | "mutate">; current(): void; changed?(): void }) {
  }
  async publish(items: ChatOutboxItem[]) {
    const { store, scope, transport, current } = this.ports;
    for (const item of items.filter(item => item.kind === "delete-chat").slice(0, 100)) {
      current(); const { chatId, payload } = await readOutboxSource(store, scope, item);
      const operation = chatDeletionOperation(item.id, chatId, payload), checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
      const saved = await checkpoints.get("deletion-receipt"); current();
      const receipt = saved?.kind === "deletion-receipt" ? saved.receipt :
        await transport.query("lifecycle/api:receipt", { ...this.header, operationId: operation.operationId });
      current();
      const confirmed = receipt ?? await transport.mutate("lifecycle/api:remove", { ...this.header, operation });
      current(); assertDeletionReceipt(operation, confirmed);
      if (!saved) await checkpoints.save({ kind: "deletion-receipt", receipt: confirmed });
      if (confirmed.status === "conflicted") {
        const target = await store.read(scope, { type: "deletion-target", chatId }); current();
        // Only a retained, undeleted local record can resume from a rejected request.
        if (target.type !== "deletion-target" || !target.value || target.value.deletion || target.value.incarnationId !== operation.target.incarnationId) throw new Error("CHAT_DELETION_LOCAL_REVIEW_REQUIRED");
        const raw = await transport.query("chats/metadata:head", { ...this.header, chatId }); current();
        if (!raw) throw new Error("CHAT_DELETION_HEAD_CHANGED");
        const head = await openChatHeadForRequest(raw, chatId, this.ports.crypto()); current();
        if (head.chat.incarnationId !== operation.target.incarnationId) throw new Error("CHAT_DELETION_HEAD_CHANGED");
        await store.mutate(scope, hashChatContent(["deletion-conflict-head", item.id, head]), { type: "accept-chat-head", head });
      }
      current(); await store.mutate(scope, hashChatContent(["ack-deletion", item.id, item.payload_digest, confirmed]),
        { type: "ack-outbox", id: item.id, payloadDigest: item.payload_digest });
      this.ports.changed?.();
    }
  }
}
