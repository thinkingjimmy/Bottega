/**
 * [INPUT]: Depends on authenticated complete downlink, scoped native transactions and ordinary recovery Forks.
 * [OUTPUT]: Adopts existing identities and reconciles superseded native tails into one divergence-keyed Fork before consuming canonical receipts, once per unchanged head and local content.
 * [POS]: Shared main convergence owner; it never claims execution or uploads old backup values.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../../chats/chat-store";
import type { RecoverySave } from "../../chat/recovery/save";
import type { ChatOutboxItem } from "../chats/sources";
const SETTLED_LIMIT = 500;
export class DesktopChatConvergence {
  private flights = new Map<string, Promise<void>>();
  /* What this process already converged: the canonical head plus the local content and queue it left
     behind. Identical inputs would rewrite the identical canonical history, so the pass is skipped
     instead of replaying it at every downlink pass. Session-scoped; a restart converges once more. */
  private settled = new Map<string, string>();
  constructor(private readonly input: { scope: SyncScope; deviceId: string; chats: ChatStore; recovery: Pick<RecoverySave, "save">;
    current(): void; assertIdle(chatId: string): void; changed(): void }) {}
  reconcile(head: CloudChatHead, initial?: ChatOutboxItem, force = false) {
    const prior = this.flights.get(head.chat.id); if (prior) return prior;
    const flight = this.perform(head, initial, force); this.flights.set(head.chat.id, flight);
    void flight.finally(() => { this.flights.delete(head.chat.id); }).catch(() => {}); return flight;
  }
  private settle(chatId: string, signature: string) {
    this.settled.delete(chatId); this.settled.set(chatId, signature);
    for (const key of this.settled.keys()) { if (this.settled.size <= SETTLED_LIMIT) break; this.settled.delete(key); }
  }
  private async perform(head: CloudChatHead, initial?: ChatOutboxItem, force = false) {
    const { chats, scope } = this.input, id = head.chat.id;
    this.input.current();
    if (head.chat.classification.conversationKind !== "ordinary" || !chats.getMetadata(id) || head.openTurnId) return;
    const local = await chats.sync.read(scope, { type: "local-execution", chatId: id }); this.input.current();
    if (local.type !== "local-execution" || !local.value || local.value.residence === "mirror" || local.value.deleted) return;
    if (!initial && !force && head.ownerDeviceId === this.input.deviceId) return;
    if (!initial) {
      const queue = await chats.sync.read(scope, { type: "metadata-outbox", chatId: id, limit: 100 });
      if (queue.type === "metadata-outbox" && queue.value.some(item => item.kind === "initialize")) return;
    }
    this.input.assertIdle(id);
    const target = await chats.sync.read(scope, { type: "turn-target", chatId: id }); this.input.current();
    if (target.type !== "turn-target" || !target.value) throw new Error("CHAT_CONVERGENCE_SOURCE_UNAVAILABLE");
    const facts = { head, expectedMessageRevision: target.value.messageRevision, expectedOutboxDigest: target.value.outboxDigest,
      initial: initial ? { id: initial.id, payloadDigest: initial.payload_digest } : null };
    const signature = hashChatContent([head, target.value.messageRevision, target.value.outboxDigest]);
    if (!initial && this.settled.get(id) === signature) return;
    const prepare = { ...facts, type: "prepare-chat-convergence" as const };
    const result = await chats.sync.mutate(scope, hashChatContent([scope, prepare]), prepare); this.input.current();
    if (result.result.type !== "prepare-chat-convergence") throw new Error("CHAT_CONVERGENCE_SOURCE_UNAVAILABLE");
    const { archiveId, startSeq } = result.result.value;
    /* The Fork is named after the divergence, so a retry that archives a longer tail after the user
       finished another turn grows the child it already made instead of adding a second copy. */
    const childId = archiveId === null || startSeq === null ? null
      : await this.input.recovery.save(scope, { chatId: id, archiveId }, { currentHome: true, divergence: { incarnationId: head.chat.incarnationId, startSeq } });
    this.input.current(); this.input.assertIdle(id);
    const commit = { ...facts, type: "commit-chat-convergence" as const, archiveId, childId, startSeq };
    await chats.sync.mutate(scope, hashChatContent([scope, commit]), commit); this.input.current(); this.input.changed();
    const settled = await chats.sync.read(scope, { type: "turn-target", chatId: id }); this.input.current();
    if (settled.type === "turn-target" && settled.value) this.settle(id, hashChatContent([head, settled.value.messageRevision, settled.value.outboxDigest]));
  }
}
