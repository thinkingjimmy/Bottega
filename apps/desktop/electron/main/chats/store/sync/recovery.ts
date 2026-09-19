/**
 * [INPUT]: Depends on ChatStore's sole queue, rooted scope checks, native aggregate commits and durable operation receipts.
 * [OUTPUT]: Creates one independent recovered Chat and replays its original receipt without rewriting later edits.
 * [POS]: Main Store collaborator; the existing native writer owns attachment references, outbox and all transaction boundaries.
 */
import { createHash } from "node:crypto";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { RecoveryIdentity } from "../../../../../shared/cloud/recovery";
import type { ChatStoreState } from "../state";
import { metadataOf } from "../../chat-summary";
import { ChatMutationOutcomeUnknownError } from "../mutation-outcome";
export class ChatRecoveryStore {
  constructor(private readonly state: ChatStoreState) {}
  commit(scope: SyncScope, identity: RecoveryIdentity, record: ChatRecord, operationId: string) {
    return this.state.queue.enqueue(async () => {
      const database = this.state.requireDatabase(), deviceId = this.state.requireDeviceId();
      await database.execute({ kind: "cloud-read", deviceId, scope, query: { type: "recovery-archive", ...identity } });
      const receipt = await database.execute({ kind: "get-operation-receipt", operationId });
      if (receipt) {
        if (receipt.kind !== "upsert-record" || receipt.targetId !== record.id) throw new Error("CHAT_RECOVERY_IDENTITY_CHANGED");
        const child = await this.state.readRecord(record.id);
        if (child.parentChatId !== identity.chatId || child.incarnationId !== record.incarnationId) throw new Error("CHAT_RECOVERY_CHILD_CHANGED");
        this.state.metadata.set(child.id, metadataOf(child)); this.state.messageRevisions.set(child.id, child.chatMessageRevision);
        this.state.remember(child, child.chatMessageRevision); this.state.touch();
        return child.id;
      }
      if (record.parentChatId !== identity.chatId || record.context.kind !== "ordinary" || record.appRole || record.session || record.grants.length || record.executionDir ||
          this.state.metadata.has(record.id)) throw new Error("CHAT_RECOVERY_CHILD_INELIGIBLE");
      const command = { kind: "upsert-record" as const, operationId, record, deviceId, lifecycleKind: "native" as const, expectedAggregateRevision: null };
      const outcome = await database.execute({ ...command, requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex") });
      if (outcome.status === "outcome_unknown") throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
      if (outcome.status === "rejected") throw new Error(outcome.failure.message);
      this.state.metadata.set(record.id, metadataOf(record)); this.state.messageRevisions.set(record.id, record.chatMessageRevision);
      this.state.remember(record, record.chatMessageRevision); this.state.touch(); return record.id;
    });
  }
}
