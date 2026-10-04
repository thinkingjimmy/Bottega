/**
 * [INPUT]: Depends on the closed Chat bridge and main-owned pending/candidate projections.
 * [OUTPUT]: Adapts durable desktop edits and explicit conflict recovery to the shared facts controls.
 * [POS]: Renderer view controller; its memory holds an in-flight request, never the authoritative outbox.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatFactsController, ChatFactsState } from "@ai-chat/chat-ui/facts-session";
import type { CloudChatBridge } from "../../../../../shared/cloud/chat";
import type { ChatFactsEdit, ChatFactsDecision, ChatFactsView } from "../../../../../shared/cloud/facts";
import { BridgeSession } from "./bridge-session";
type Attempt = { kind: "edit"; input: ChatFactsEdit } | { kind: "resolve"; input: ChatFactsDecision };
export class DesktopChatFacts extends BridgeSession<ChatFactsState> implements ChatFactsController {
  private view: ChatFactsView | null = null;
  private heads = new WeakMap<CloudChatHead, string>();
  private attempt: Attempt | null = null;
  constructor(private bridge: Pick<CloudChatBridge, "facts" | "editFacts" | "resolveFacts" | "onLocalChanged">, private chatId: string) {
    super({ stage: "saving", operation: null, receipt: null }, listener => bridge.onLocalChanged(listener));
  }
  protected get pending() { return Boolean(this.attempt); }
  private install(view: ChatFactsView, saved = false) {
    this.view = view; if (view.head) this.heads.set(view.head, view.queueHash);
    this.update({ stage: view.status === "idle" && saved ? "saved" : view.status, operation: null, receipt: null, candidate: view.candidate, head: view.head });
  }
  async refresh() {
    if (this.busy || this.closed || this.attempt) return;
    const generation = this.generation, reading = ++this.reading;
    try {
      const view = await this.bridge.facts({ chatId: this.chatId });
      if (!this.owns(generation, reading)) return;
      this.install(view, this.value.stage === "pending" || this.value.stage === "saved");
    } catch { if (this.owns(generation, reading)) this.update({ ...this.value, stage: "failed" }); }
  }
  private identity(head: CloudChatHead) {
    const expectedQueueHash = this.heads.get(head);
    if (!expectedQueueHash || head.chat.id !== this.chatId) throw new Error("CHAT_METADATA_REVIEW_CHANGED");
    return { chatId: this.chatId, incarnationId: head.chat.incarnationId, expectedRevision: head.chat.cloudRevision, expectedQueueHash, operationId: crypto.randomUUID() };
  }
  async submit(head: CloudChatHead, changes: ChatFactsEdit["changes"]) {
    if (this.busy || this.attempt || ["conflicted", "deleted"].includes(this.value.stage)) return;
    this.attempt = { kind: "edit", input: { ...this.identity(head), changes: { ...changes } } }; await this.deliver();
  }
  async useMine(head: CloudChatHead) { await this.decide(head, "retry"); }
  async keepCurrent() { if (this.view?.head) await this.decide(this.view.head, "discard"); }
  private async decide(head: CloudChatHead, decision: "retry" | "discard") {
    if (this.busy || this.attempt || this.value.stage !== "conflicted") return;
    this.attempt = { kind: "resolve", input: { ...this.identity(head), decision } }; await this.deliver();
  }
  protected async deliver() {
    if (this.busy || this.closed || !this.attempt) return;
    const attempt = this.attempt, generation = this.generation;
    this.busy = true; this.reading++; this.update({ ...this.value, stage: "saving" });
    try {
      const view = await (attempt.kind === "edit" ? this.bridge.editFacts(attempt.input) : this.bridge.resolveFacts(attempt.input));
      if (generation !== this.generation || this.closed) return;
      this.attempt = null; this.install(view, true);
    } catch {
      if (generation !== this.generation || this.closed) return;
      this.update({ ...this.value, stage: "failed" });
      if (attempt.kind === "resolve") {
        try {
          const view = await this.bridge.facts({ chatId: this.chatId });
          if (generation === this.generation && !this.closed && ["conflicted", "deleted"].includes(view.status)) { this.attempt = null; this.install(view); }
        } catch { /* Retain the original request until its local outcome can be reconciled. */ }
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }
}
