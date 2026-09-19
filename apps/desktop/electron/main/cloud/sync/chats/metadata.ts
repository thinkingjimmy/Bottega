/**
 * [INPUT]: Depends on ChatStore's captured metadata intents, immutable checkpoints and scoped cloud RPCs.
 * [OUTPUT]: Serializes title/archive operations, resolves causal baselines from original receipts and reconciles cloud heads.
 * [POS]: Main metadata transport; local optimistic edits and conflict candidates remain in the existing Chat outbox.
 */
import { type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { hashChatMetadataOperation } from "@ai-chat/cloud-protocol/chats/metadata";
import { EncryptedChatMetadata } from "./encryption/metadata";
import type { ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport";
import { chatMetadataIntentSchema } from "../../../chats/sqlite/cloud/delivery/metadata-contracts";
import { ChatDeliveryCheckpoints } from "./checkpoints";
import type { ChatSyncStore } from "./sources";
type Ports = { crypto(): ChatCipherPort; store: ChatSyncStore; scope: SyncScope; config: CloudBuildConfig; deviceId: string;
  transport: Pick<AccountTransport, "query" | "mutate">; changed(chatId: string): void; failure(chatId: string, error: unknown): void };
export class DesktopChatMetadataSync {
  private closed = false;
  private readonly flights = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private readonly encrypted: EncryptedChatMetadata;
  constructor(private readonly ports: Ports) {
    if (ports.scope.environment !== ports.config.environmentId) throw new Error("environment-mismatch");
    this.encrypted = new EncryptedChatMetadata({ ...ports, userId: ports.scope.userId });
  }
  flush(chatId: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.dirty.add(chatId); const previous = this.flights.get(chatId); if (previous) return previous;
    const flight = this.deliver(chatId).catch(error => { if (!this.closed) this.ports.failure(chatId, error); });
    this.flights.set(chatId, flight);
    void flight.finally(() => { if (this.flights.get(chatId) === flight) this.flights.delete(chatId); }); return flight;
  }
  private async deliver(chatId: string) {
    const { store, scope } = this.ports; let sent = 0;
    while (!this.closed && this.dirty.delete(chatId)) {
      const page = await store.read(scope, { type: "metadata-outbox", chatId, limit: 100 });
      if (this.closed) return;
      if (page.type !== "metadata-outbox") throw new Error("CHAT_METADATA_QUEUE_INVALID");
      const item = page.value.find(item => item.metadata_status === "queued");
      if (!item) {
        if (page.value.some(item => item.metadata_status === "conflicted")) return;
        const head = await this.encrypted.head(chatId);
        if (this.closed) return;
        if (!head) throw new Error("CHAT_CLOUD_METADATA_UNAVAILABLE");
        await store.mutate(scope, hashChatContent(["chat-metadata-head", head]), { type: "accept-chat-head", head });
        if (!this.closed) this.ports.changed(chatId);
        continue;
      }
      if (sent >= 64) { setTimeout(() => { void this.flush(chatId); }, 0).unref(); continue; }
      const checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
      const intent = chatMetadataIntentSchema.parse(JSON.parse(item.metadata_intent_json!));
      let saved = await checkpoints.get("metadata-operation");
      if (!saved) {
        const basis = intent.kind === "patch" && intent.basis.kind === "receipt" ?
          await this.encrypted.receipt(intent.basis.operationId) : null;
        if (this.closed) return;
        if (intent.kind === "patch" && intent.basis.kind === "receipt" && !basis) return;
        if (basis && (!basis.head || !["applied", "converged"].includes(basis.status))) throw new Error("CHAT_METADATA_PREDECESSOR_CONFLICT");
        const command = intent.kind === "create" ? { kind: "create" as const, chat: intent.chat, lifecycleKind: intent.lifecycleKind, archivedAt: intent.archivedAt } :
          { kind: "patch" as const, incarnationId: intent.incarnationId, expectedRevision: intent.basis.kind === "revision" ? intent.basis.revision : basis!.head!.chat.cloudRevision,
            changes: intent.changes };
        const operation = { operationId: intent.operationId, chatId, payloadHash: "0".repeat(64), command };
        saved = await checkpoints.save({ kind: "metadata-operation", basis, operation: { ...operation, payloadHash: hashChatMetadataOperation(operation) } });
      }
      if (this.closed) return;
      if (saved.kind !== "metadata-operation") throw new Error("CHAT_METADATA_CHECKPOINT_INVALID");
      const receipt = await this.encrypted.deliver(checkpoints, saved.operation);
      if (this.closed) return;
      if (receipt.operationId !== saved.operation.operationId || receipt.payloadHash !== saved.operation.payloadHash ||
        receipt.chatId !== chatId || receipt.sourceDeviceId !== this.ports.deviceId) throw new Error("CHAT_METADATA_RECEIPT_MISMATCH");
      await checkpoints.save({ kind: "metadata-receipt", receipt });
      if (!this.closed) this.ports.changed(chatId);
      sent++; this.dirty.add(chatId);
    }
  }
  async close() { this.closed = true; this.dirty.clear(); await Promise.all(this.flights.values()); }
}
