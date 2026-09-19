/**
 * [INPUT]: Depends on original business outbox sources, scoped RPCs and verified local body/checkpoint state.
 * [OUTPUT]: Delivers ordered executor options and asks the sole SQLite writer to retire covered commits.
 * [POS]: Incremental delivery adapter; no second queue or mutable upload baseline is introduced.
 */
import { type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { publishEncryptedOptions } from "../encryption/options";
import { chatOptionsOperationSchema } from "@ai-chat/cloud-protocol/chats/options-sync";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../../runtime/transport";
import { businessOutboxKinds } from "../../../../chats/sqlite/cloud/delivery/options/model";
import { ChatDeliveryCheckpoints } from "../checkpoints";
import { chatIdOf, readOutboxSource, type ChatOutboxItem, type ChatSyncStore } from "../sources";
export class IncrementalChatPublisher {
  private retirementCursor = "";
  constructor(private readonly ports: { store: ChatSyncStore; scope: SyncScope; config: CloudBuildConfig; deviceId: string;
    transport: Pick<AccountTransport, "query" | "mutate">; crypto(): FileCipherPort; current(): void }) {}
  async publish(items: ChatOutboxItem[], signal = new AbortController().signal) {
    const { store, scope, current } = this.ports, blocked = new Set<string>();
    const failures: Error[] = [];
    for (const item of [...items].filter(item => item.kind === "update-chat-facts")
      .sort((a, b) => a.seq_or_revision - b.seq_or_revision || a.created_at - b.created_at || a.id.localeCompare(b.id)).slice(0, 100)) {
      current(); const { chatId, payload } = await readOutboxSource(store, scope, item);
      if (blocked.has(chatId)) continue;
      const source = payload as { optionsOperation?: unknown }; if (!source.optionsOperation) continue;
      const operation = chatOptionsOperationSchema.parse(source.optionsOperation), checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
      const saved = await checkpoints.get("options-receipt");
      current();
      const receipt = saved?.kind === "options-receipt" ? saved.receipt :
        await publishEncryptedOptions({ ...this.ports, userId: scope.userId }, operation, checkpoints, signal);
      current(); if (!receipt) { blocked.add(chatId); continue; }
      if (receipt.operationId !== operation.operationId || receipt.payloadHash !== operation.payloadHash ||
        receipt.chatId !== chatId || receipt.sourceDeviceId !== this.ports.deviceId) throw new Error("OPTIONS_RECEIPT_IDENTITY_MISMATCH");
      if (!saved) await checkpoints.save({ kind: "options-receipt", receipt });
      if (!["applied", "converged", "superseded"].includes(receipt.status)) {
        blocked.add(chatId); const failure = new Error(`CHAT_OPTIONS_${receipt.status.toUpperCase()}`); failures.push(failure);
        await store.mutate(scope, hashChatContent(["options-failure", receipt]), { type: "attempt-outbox", id: item.id,
          payloadDigest: item.payload_digest, error: failure.message });
      }
    }
    return failures;
  }
  async retire(items: ChatOutboxItem[]) {
    const { store, scope, current } = this.ports, proofs = new Map<string, unknown>();
    const candidates = items.filter(item => businessOutboxKinds.has(item.kind)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const page = candidates.filter(item => item.id > this.retirementCursor).slice(0, 100);
    // At the tail, reset and let the next pass start over; replaying page one here re-mutates commits already retired.
    if (!page.length) { this.retirementCursor = ""; return; }
    for (const item of page) {
      current(); const chatId = chatIdOf(item);
      if (!proofs.has(chatId)) proofs.set(chatId, [await store.read(scope, { type: "chat-metadata", chatId }),
        await store.read(scope, { type: "mirror-download", chatId })]);
      const checkpoint = await new ChatDeliveryCheckpoints(store, scope, item).get("options-receipt");
      current(); await store.mutate(scope, hashChatContent(["retire-covered-commit", item.id, item.payload_digest, item.metadata_status, proofs.get(chatId), checkpoint]),
        { type: "retire-covered-commit", id: item.id, payloadDigest: item.payload_digest });
      this.retirementCursor = item.id;
    }
  }
}
