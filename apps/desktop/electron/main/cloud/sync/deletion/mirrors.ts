/**
 * [INPUT]: Depends on confirmed account-scoped tombstones, minimal mirror targets and the existing deletion coordinator.
 * [OUTPUT]: Drives mirror removal through the durable fence/policy/drain/removal journal and resumes the same identity after interruption.
 * [POS]: Cloud mirror lifecycle adapter; native content requires its own local retention decision.
 */
import { join } from "node:path";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { ConversationDeletionCoordinator } from "../../../deletion/conversation-deletion-coordinator";
import type { ChatSyncStore } from "../chats/sources";
export class CloudMirrorDeletion {
  private readonly coordinator: ConversationDeletionCoordinator;
  constructor(private readonly ports: { userData: string; scope: SyncScope; store: ChatSyncStore; current(): void; changed(): void }) {
    this.coordinator = new ConversationDeletionCoordinator(join(ports.userData, "cloud-mirror-deletions", hashChatContent(ports.scope)));
  }
  async apply(marker: CloudTombstone) {
    const { store, scope, current } = this.ports;
    current(); if (marker.entityKind !== "chat") throw new Error("CHAT_TOMBSTONE_REQUIRED");
    const result = await store.read(scope, { type: "deletion-target", chatId: marker.entityId }); current();
    if (result.type !== "deletion-target") throw new Error("DELETION_TARGET_UNAVAILABLE");
    const target = result.value;
    if (target?.residence === "native") return false;
    if (target && marker.incarnationId !== null && marker.incarnationId !== target.incarnationId) throw new Error("DELETION_INCARNATION_CHANGED");
    const incarnationId = target?.incarnationId ?? marker.incarnationId;
    if (!incarnationId) return true;
    const record = { id: marker.entityId, incarnationId, messages: [], ...(target?.projectId ? { projectId: target.projectId } : {}) };
    const receiptDigest = hashChatContent(["mirror-no-local-memory", scope, record.id, record.incarnationId]);
    await this.coordinator.remove(record, {
      snapshot: async (_record, operationId) => ({ operationId, sourceSessionKey: `${record.id}:${record.incarnationId}`, memorySpaceId: receiptDigest }),
      validateFence: current, fence: async () => current(), applyPolicy: async () => ({ receiptDigest }), drain: async () => current(), applyDelivery: async () => [],
      verifyReceipts: (_intent, policy, deliveries, mode) => { current(); if (policy !== receiptDigest || deliveries.length || mode !== "local-only") throw new Error("MIRROR_DELETION_RECEIPT_INVALID"); },
      removeChat: async () => {
        current(); await store.mutate(scope, hashChatContent(["remove-cloud-mirror", scope, marker]), { type: "remove-cloud-mirror", tombstone: marker }); current();
      },
      onChatRemoved: () => this.ports.changed(), onCleanupError() {}, resources: [],
    });
    current(); return true;
  }
}
