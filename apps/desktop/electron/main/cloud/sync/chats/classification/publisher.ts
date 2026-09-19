/**
 * [INPUT]: Depends on frozen SQLite classification candidates, the original outbox and account-scoped RPCs.
 * [OUTPUT]: Delivers automatic classifications and explicit promotion/rescue confirmations with receipt-first recovery; saga-owned facts commit only through their original lifecycle.
 * [POS]: Main classification delivery; networking runs outside ChatStore's serialized writer queue.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { frozenClassificationSchema } from "@ai-chat/cloud-protocol/chats/encrypted/classification";
import { openClassificationReceipt, prepareClassificationOperation, verifyFrozenClassification } from "@ai-chat/cloud-protocol/chats/encrypted/classification/client";
import { openChatHeadForRequest, type ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { ChatDeliveryCheckpoints } from "../checkpoints";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../../runtime/transport";
import { readOutboxSource, type ChatOutboxItem, type ChatSyncStore } from "../sources";
export class DesktopClassificationPublisher {
  private readonly header;
  constructor(private readonly ports: { store: ChatSyncStore; scope: SyncScope; config: CloudBuildConfig; deviceId: string; crypto(): ChatCipherPort;
    transport: Pick<AccountTransport, "query" | "mutate">; current(): void; changed(): void }) {
    const crypto = ports.crypto();
    if (crypto.session.userId !== ports.scope.userId || crypto.session.deviceId !== ports.deviceId) throw new Error("CLASSIFICATION_SCOPE_CHANGED");
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  }
  async publish(items: ChatOutboxItem[]) {
    return this.deliver(items, "automatic");
  }
  async confirmPromotion(items: ChatOutboxItem[]) {
    return this.deliver(items, "promotion");
  }
  async confirmRescue(items: ChatOutboxItem[]) {
    return this.deliver(items, "rescue");
  }
  private async deliver(items: ChatOutboxItem[], mode: "automatic" | "promotion" | "rescue") {
    const { store, scope, transport, current } = this.ports;
    for (const item of items.filter(item => item.kind === "classification").slice(0, 100)) {
      current(); const { chatId, payload } = await readOutboxSource(store, scope, item);
      const operation = chatClassificationOperationSchema.parse(payload);
      const owner = operation.basePromotion ? "promotion" : operation.projectRescue ? "rescue" : "automatic";
      if (owner !== mode) continue;
      const candidate = await store.read(scope, { type: "classification", lifecycleOperationId: operation.lifecycleOperationId });
      if (item.id !== operation.lifecycleOperationId || operation.chatId !== chatId || candidate.type !== "classification" ||
          !candidate.value || canonicalJson(JSON.parse(candidate.value.operation_json!)) !== canonicalJson(operation)) throw new Error("CLASSIFICATION_SOURCE_CHANGED");
      if (candidate.value.state === "conflicted") continue;
      current();
      let receipt = candidate.value.receipt_json ? chatClassificationReceiptSchema.parse(JSON.parse(candidate.value.receipt_json)) : null;
      if (!receipt) {
        const crypto = this.ports.crypto(), signal = new AbortController().signal;
        if (canonicalJson({ scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }) !== canonicalJson(this.header.encryptedSpace) ||
          crypto.session.userId !== scope.userId || crypto.session.deviceId !== this.ports.deviceId) throw new Error("CLASSIFICATION_SCOPE_CHANGED");
        const checkpoints = new ChatDeliveryCheckpoints(store, scope, item), key = `cipher-classification:${operation.lifecycleOperationId}`;
        let saved = await checkpoints.get(key); current();
        // Frozen ciphertext that predates this attempt is the only evidence that the apply may already have been received.
        const attempted = Boolean(saved);
        if (!saved) {
          const headWire = await transport.query("chats/metadata:head", { ...this.header, chatId }); current();
          if (!headWire) throw new Error("CLASSIFICATION_HEAD_UNAVAILABLE");
          const head = await openChatHeadForRequest(headWire, chatId, crypto, signal); current();
          const baseHead = operation.basePromotion ? await transport.query("bases/pages:head", { ...this.header, baseId: operation.basePromotion.baseId }) : null; current();
          const prepared = await prepareClassificationOperation(operation, head, crypto, signal, baseHead?.schemaRevision); current();
          try { saved = await checkpoints.save(prepared); }
          catch (error) { saved = await checkpoints.get(key); if (!saved) throw error; }
          current();
        }
        const frozen = verifyFrozenClassification(frozenClassificationSchema.parse(saved), operation);
        if (canonicalJson(frozen.encryptedSpace) !== canonicalJson(this.header.encryptedSpace)) throw new Error("CLASSIFICATION_SCOPE_CHANGED");
        // A first attempt has nothing to recover; every later attempt stays receipt-first so a lost response never re-applies.
        let received = attempted ? await transport.query("chats/classification:receipt", { ...this.header, lifecycleOperationId: operation.lifecycleOperationId }) : null; current();
        if (!received) received = await transport.mutate("chats/classification:apply", { ...this.header, operation: frozen.transport }); current();
        receipt = await openClassificationReceipt(received, frozen, crypto, signal); current();
      }
      current();
      if (receipt.lifecycleOperationId !== operation.lifecycleOperationId || receipt.chatId !== chatId ||
          receipt.payloadHash !== operation.payloadHash || receipt.candidateHash !== operation.candidateHash ||
          receipt.sourceDeviceId !== this.ports.deviceId) throw new Error("CLASSIFICATION_RECEIPT_CHANGED");
      await store.mutate(scope, hashChatContent(["classification-confirm", receipt]), {
        type: "confirm-classification", lifecycleOperationId: operation.lifecycleOperationId, receipt });
      current();
      if (receipt.status === "applied" && mode === "automatic") await store.mutate(scope, hashChatContent(["classification-commit", operation.lifecycleOperationId]),
        { type: "commit-classification", lifecycleOperationId: operation.lifecycleOperationId });
      else if (receipt.status !== "applied" && receipt.head) await store.mutate(scope, hashChatContent(["classification-conflict-head", receipt]), { type: "accept-chat-head", head: receipt.head });
      current(); this.ports.changed();
    }
  }
}
