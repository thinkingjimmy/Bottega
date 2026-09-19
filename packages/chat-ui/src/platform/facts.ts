/**
 * [INPUT]: Depends on closed Chat metadata operations, confirmed heads and injected receipt/apply ports.
 * [OUTPUT]: Defines a common facts controller and preserves immutable page-memory attempts, explicit decisions and original-receipt retry.
 * [POS]: Shared title/archive intent controller; desktop durable capture remains in its existing Store.
 */
import type { FrozenChatMetadata } from "@ai-chat/cloud-protocol/chats/encrypted/model";
import type { z } from "zod";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { chatMetadataOperationSchema, chatMetadataPatchSchema, chatMetadataReceiptSchema, hashChatMetadataOperation,
  type ChatMetadataOperation, type ChatMetadataReceipt } from "@ai-chat/cloud-protocol/chats/metadata";
type ChatFactsPorts = { prepare?(operation: ChatMetadataOperation, basis: CloudChatHead): Promise<FrozenChatMetadata>;
  receipt(operationId: string, frozen?: FrozenChatMetadata): Promise<ChatMetadataReceipt | null>;
  apply(operation: ChatMetadataOperation, frozen?: FrozenChatMetadata): Promise<ChatMetadataReceipt> };
export type ChatFactsState = { stage: "idle" | "saving" | "saved" | "pending" | "failed" | "conflicted" | "deleted"; operation: ChatMetadataOperation | null; receipt: ChatMetadataReceipt | null;
  frozen?: FrozenChatMetadata;
  candidate?: z.infer<typeof chatMetadataPatchSchema> | null; head?: CloudChatHead | null };
export interface ChatFactsController {
  snapshot(): ChatFactsState;
  subscribe(changed: () => void): () => void;
  submit(head: CloudChatHead, changes: z.infer<typeof chatMetadataPatchSchema>): Promise<void>;
  retry(): Promise<void>;
  useMine(head: CloudChatHead): Promise<void>;
  keepCurrent(): void | Promise<void>;
}
export class ChatFactsSession {
  private value: ChatFactsState = { stage: "idle", operation: null, receipt: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly ports: ChatFactsPorts) {}
  snapshot = () => this.value;
  subscribe = (changed: () => void) => { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; };
  private update(value: ChatFactsState) { this.value = value; for (const listener of this.listeners) listener(); }
  submit(head: CloudChatHead, changes: z.infer<typeof chatMetadataPatchSchema>) {
    if (["saving", "failed", "conflicted", "deleted"].includes(this.value.stage)) throw new Error("CHAT_FACTS_DECISION_REQUIRED");
    return this.start(head, changes);
  }
  private start(head: CloudChatHead, changes: z.infer<typeof chatMetadataPatchSchema>) {
    const operation = chatMetadataOperationSchema.parse({ operationId: crypto.randomUUID(), chatId: head.chat.id, payloadHash: "0".repeat(64),
      command: { kind: "patch", incarnationId: head.chat.incarnationId, expectedRevision: head.chat.cloudRevision, changes } });
    operation.payloadHash = hashChatMetadataOperation(operation);
    if (operation.command.kind === "patch") Object.freeze(operation.command.changes);
    Object.freeze(operation.command); Object.freeze(operation);
    this.update({ stage: "saving", operation, receipt: null, head }); return this.deliver(operation);
  }
  retry() {
    if (this.value.stage !== "failed" || !this.value.operation) throw new Error("CHAT_FACTS_RETRY_UNAVAILABLE");
    const operation = this.value.operation; this.update({ ...this.value, stage: "saving" }); return this.deliver(operation);
  }
  useMine(head: CloudChatHead) {
    const { operation, receipt } = this.value;
    if (this.value.stage !== "conflicted" || operation?.command.kind !== "patch" || !receipt?.head || head.chat.id !== operation.chatId ||
      head.chat.incarnationId !== operation.command.incarnationId || head.chat.cloudRevision < receipt.head.chat.cloudRevision) throw new Error("CHAT_FACTS_BASELINE_CHANGED");
    return this.start(head, operation.command.changes);
  }
  keepCurrent() {
    if (this.value.stage !== "conflicted") throw new Error("CHAT_FACTS_DECISION_UNAVAILABLE");
    this.update({ stage: "idle", operation: null, receipt: null });
  }
  private async deliver(operation: ChatMetadataOperation) {
    const generation = this.generation;
    try {
      let frozen = this.value.frozen;
      if (!frozen && this.ports.prepare) {
        if (!this.value.head) throw new Error("CHAT_FACTS_BASELINE_REQUIRED");
        frozen = await this.ports.prepare(operation, this.value.head);
        if (generation !== this.generation) return;
        if (frozen.plaintextHash !== operation.payloadHash) throw new Error("CHAT_FACTS_HASH_PAIR_CHANGED");
        this.value = { ...this.value, frozen };
      }
      const saved = await this.ports.receipt(operation.operationId, frozen);
      if (generation !== this.generation) return;
      const receipt = chatMetadataReceiptSchema.parse(saved ?? await this.ports.apply(operation, frozen));
      if (generation !== this.generation) return;
      if (receipt.operationId !== operation.operationId || receipt.chatId !== operation.chatId || receipt.payloadHash !== operation.payloadHash ||
        receipt.head && (receipt.head.chat.id !== operation.chatId || operation.command.kind === "patch" && receipt.head.chat.incarnationId !== operation.command.incarnationId)) throw new Error("CHAT_FACTS_RECEIPT_CHANGED");
      this.update({ stage: receipt.status === "applied" || receipt.status === "converged" ? "saved" : receipt.status, operation, receipt, frozen });
    } catch { if (generation === this.generation) this.update({ ...this.value, stage: "failed" }); }
  }
  close() { this.generation++; delete this.value.frozen; if (this.value.stage === "saving") this.value = { ...this.value, stage: "failed" }; }
}
