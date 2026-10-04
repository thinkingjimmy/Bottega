/**
 * [INPUT]: Depends on confirmed Chat heads, closed revision-CAS deletion contracts and injected authorized RPCs.
 * [OUTPUT]: Provides immutable deletion attempts, original-receipt retry and explicit conflict decisions.
 * [POS]: Shared deletion controller; browser attempts stay in page memory and desktop persistence belongs to its Store.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { deletionOperationSchema, deletionResultSchema, hashDeletionOperation,
  type DeletionOperation, type DeletionResult } from "@ai-chat/cloud-protocol/lifecycle/model";
export type ChatDeletionState = { stage: "idle" | "saving" | "pending" | "failed" | "conflicted" | "deleted";
  operation: DeletionOperation | null; result: DeletionResult | null };
export type ChatDeletionPorts = { receipt(operationId: string): Promise<DeletionResult | null>; remove(operation: DeletionOperation): Promise<DeletionResult> };
export interface ChatDeletionController {
  snapshot(): ChatDeletionState;
  subscribe(changed: () => void): () => void;
  submit(head: CloudChatHead): Promise<void>;
  retry(): Promise<void>;
  keep(): void | Promise<void>;
}
export class ChatDeletionSession implements ChatDeletionController {
  private value: ChatDeletionState = { stage: "idle", operation: null, result: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly ports: ChatDeletionPorts) {}
  snapshot = () => this.value;
  subscribe = (changed: () => void) => { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; };
  private update(value: ChatDeletionState) { this.value = value; for (const listener of this.listeners) listener(); }
  async submit(head: CloudChatHead) {
    if (!["idle", "conflicted"].includes(this.value.stage)) throw new Error("CHAT_DELETION_DECISION_REQUIRED");
    if (this.value.result?.status === "conflicted" && (this.value.operation?.target.id !== head.chat.id ||
      (this.value.result.currentRevision ?? 0) > head.chat.cloudRevision)) throw new Error("CHAT_DELETION_REVIEW_CHANGED");
    const operation = deletionOperationSchema.parse({ operationId: crypto.randomUUID(), payloadHash: "0".repeat(64),
      target: { kind: "chat", id: head.chat.id, incarnationId: head.chat.incarnationId, expectedRevision: head.chat.cloudRevision } });
    operation.payloadHash = hashDeletionOperation(operation);
    Object.freeze(operation.target); Object.freeze(operation);
    this.update({ stage: "saving", operation, result: null }); await this.deliver(operation);
  }
  async retry() {
    if (this.value.stage !== "failed" || !this.value.operation) throw new Error("CHAT_DELETION_RETRY_UNAVAILABLE");
    const operation = this.value.operation; this.update({ ...this.value, stage: "saving" }); await this.deliver(operation);
  }
  keep() {
    if (this.value.stage !== "conflicted") throw new Error("CHAT_DELETION_DECISION_REQUIRED");
    this.update({ stage: "idle", operation: null, result: null });
  }
  private async deliver(operation: DeletionOperation) {
    const generation = this.generation;
    try {
      const saved = await this.ports.receipt(operation.operationId);
      if (generation !== this.generation) return;
      const result = deletionResultSchema.parse(saved ?? await this.ports.remove(operation));
      if (generation !== this.generation) return;
      if (result.operationId !== operation.operationId || result.payloadHash !== operation.payloadHash ||
        result.status !== "conflicted" && (result.tombstone.entityKind !== operation.target.kind || result.tombstone.entityId !== operation.target.id ||
          operation.target.kind === "chat" && result.tombstone.incarnationId !== operation.target.incarnationId)) throw new Error("CHAT_DELETION_RECEIPT_CHANGED");
      this.update({ stage: result.status === "conflicted" ? "conflicted" : "deleted", operation, result });
    } catch { if (generation === this.generation) this.update({ ...this.value, stage: "failed" }); }
  }
  close() { this.generation++; if (this.value.stage === "saving") this.value = { ...this.value, stage: "failed" }; }
}
