/**
 * [INPUT]: Depends on fixed deletion IPC and main-owned pending/results with stable review hashes.
 * [OUTPUT]: Adapts durable deletion and original IPC retries to the shared confirmation controller.
 * [POS]: Renderer view controller; the SQLite outbox remains the only delivery queue.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatDeletionController, ChatDeletionState } from "@ai-chat/chat-ui/deletion-session";
import type { CloudChatBridge } from "../../../../../shared/cloud/chat";
import type { ChatDeletionRequest, ChatDeletionKeep, ChatDeletionView } from "../../../../../shared/cloud/deletion";
import { BridgeSession } from "./bridge-session";
type Attempt = { kind: "request"; input: ChatDeletionRequest } | { kind: "keep"; input: ChatDeletionKeep };
type DeletionState = ChatDeletionState & { head: CloudChatHead | null };
export class DesktopChatDeletion extends BridgeSession<DeletionState> implements ChatDeletionController {
  private view: ChatDeletionView | null = null;
  private reviews = new WeakMap<CloudChatHead, string>();
  private attempt: Attempt | null = null;
  constructor(private bridge: Pick<CloudChatBridge, "deletion" | "requestDeletion" | "keepDeletion" | "onLocalChanged">, private chatId: string) {
    super({ stage: "idle", operation: null, result: null, head: null }, listener => bridge.onLocalChanged(listener));
  }
  protected get pending() { return Boolean(this.attempt); }
  private install(view: ChatDeletionView) {
    this.view = view; if (view.head) this.reviews.set(view.head, view.reviewHash);
    this.update({ head: view.head, operation: view.operation, result: view.result,
      stage: view.result && view.result.status !== "conflicted" ? "deleted" : view.pending ? "pending" : view.result ? "conflicted" : "idle" });
  }
  async refresh() {
    if (this.busy || this.closed || this.attempt) return;
    const generation = this.generation, reading = ++this.reading;
    try { const view = await this.bridge.deletion({ chatId: this.chatId }); if (this.owns(generation, reading)) this.install(view); }
    catch { if (this.owns(generation, reading)) this.update({ ...this.value, stage: "failed" }); }
  }
  async submit(head: CloudChatHead) {
    if (this.busy || this.attempt || !["idle", "conflicted"].includes(this.value.stage)) return;
    const expectedReviewHash = this.reviews.get(head);
    if (!expectedReviewHash || head.chat.id !== this.chatId) throw new Error("CHAT_DELETION_REVIEW_CHANGED");
    this.attempt = { kind: "request", input: { chatId: this.chatId, incarnationId: head.chat.incarnationId, expectedRevision: head.chat.cloudRevision,
      expectedReviewHash, operationId: crypto.randomUUID() } }; await this.deliver();
  }
  async keep() {
    if (this.busy || this.attempt || this.value.stage !== "conflicted" || !this.view) return;
    if (!this.view.result) { this.install(this.view); return; }
    this.attempt = { kind: "keep", input: { chatId: this.chatId, expectedReviewHash: this.view.reviewHash, operationId: crypto.randomUUID() } }; await this.deliver();
  }
  protected async deliver() {
    if (this.busy || this.closed || !this.attempt) return;
    const attempt = this.attempt, generation = this.generation;
    this.busy = true; this.reading++; this.update({ ...this.value, stage: "saving" });
    try {
      const view = await (attempt.kind === "request" ? this.bridge.requestDeletion(attempt.input) : this.bridge.keepDeletion(attempt.input));
      if (generation !== this.generation || this.closed) return;
      this.attempt = null; this.install(view);
    } catch (cause) {
      if (generation !== this.generation || this.closed) return;
      if (cause instanceof Error && ["CHAT_DELETION_REVIEW_CHANGED", "CHAT_DELETION_NOT_READY"].includes(cause.message)) {
        try {
          const view = await this.bridge.deletion({ chatId: this.chatId });
          if (generation !== this.generation || this.closed) return;
          this.attempt = null; this.install(view);
          if (!view.pending && !view.result) this.update({ ...this.value, stage: "conflicted" });
          return;
        } catch { /* A failed read still preserves the original request for reconciliation. */ }
      }
      // The original IPC may have committed. Never replace its identity on a transport error.
      this.update({ ...this.value, stage: "failed" });
    } finally { if (generation === this.generation) this.busy = false; }
  }
}
