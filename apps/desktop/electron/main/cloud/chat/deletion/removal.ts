/**
 * [INPUT]: Depends on actual Chat scope, the original reviewed deletion outbox and current account lifecycle ownership.
 * [OUTPUT]: Requires the original cloud result before generic or batch native cleanup may remove local resources.
 * [POS]: Native removal handoff; offline/unknown/conflicted results keep content and never allocate a replacement request.
 */
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { randomUUID } from "node:crypto";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { CloudAccountState } from "../../../../../shared/cloud-ipc";
import { sameScope } from "../../../../../shared/local-storage/contracts";
import type { SyncBindingStore } from "../../sync/account/binding";
import type { AccountTransport } from "../../runtime/transport";
import type { ChatSyncStore } from "../../sync/chats/sources";
import { DesktopDeletionPublisher } from "../../sync/deletion/publisher";
export class CloudChatRemoval {
  private flights = new Map<string, Promise<void>>();
  constructor(private ports: { crypto(): FileCipherPort; config: CloudBuildConfig; store: ChatSyncStore; binding: Pick<SyncBindingStore, "snapshot">;
    account(): CloudAccountState; transport: Pick<AccountTransport, "query" | "mutate">; changed(): void;
    own(activity: { close(): Promise<void> }): () => void }) {}
  prepare(chatId: string) {
    const previous = this.flights.get(chatId); if (previous) return previous;
    const flight = this.run(chatId).finally(() => { if (this.flights.get(chatId) === flight) this.flights.delete(chatId); });
    this.flights.set(chatId, flight); return flight;
  }
  private async run(chatId: string) {
    const { store } = this.ports, state = await store.read(null, { type: "removal-state", chatId });
    if (state.type !== "removal-state") throw new Error("CHAT_REMOVAL_STATE_UNAVAILABLE");
    if (!state.value?.scope) return;
    const { scope, incarnationId } = state.value; let closed = false;
    const current = () => {
      const binding = this.ports.binding.snapshot(), account = this.ports.account();
      if (closed || !binding || binding.phase !== "active" || account.profile?.userId !== scope.userId ||
        !["ready", "temporarily-offline"].includes(account.status) || !sameScope(scope, { environment: this.ports.config.environmentId, userId: binding.userId })) throw new Error("CHAT_ACCOUNT_CHANGED");
    };
    let work: Promise<void> | undefined;
    const release = this.ports.own({ close: async () => { closed = true; await work?.catch(() => undefined); } });
    try {
      work = Promise.resolve().then(async () => {
        current(); const target = await store.read(scope, { type: "deletion-target", chatId }); current();
        if (target.type === "deletion-target" && target.value?.deletion) return;
        const result = await store.read(scope, { type: "chat-deletion", chatId }); current();
        if (result.type !== "chat-deletion") throw new Error("CHAT_DELETION_UNAVAILABLE");
        const view = result.value;
        if (view.result?.status === "conflicted") throw new Error("CHAT_DELETION_REVIEW_REQUIRED");
        if (view.result) return;
        if (!view.pending) {
          if (!view.head || view.head.chat.incarnationId !== incarnationId) throw new Error("CHAT_SYNC_INITIALIZATION_REQUIRED");
          const operationId = randomUUID();
          await store.mutate(scope, operationId, { type: "request-chat-deletion", chatId, incarnationId, operationId,
            expectedRevision: view.head.chat.cloudRevision, expectedReviewHash: view.reviewHash }); current(); this.ports.changed();
        }
        if (this.ports.account().status !== "ready" || this.ports.binding.snapshot()?.paused) throw new Error("CHAT_DELETION_PENDING");
        const outbox = await store.read(scope, { type: "outbox", chatId, entityKind: "tombstone", afterId: null, limit: 2 }); current();
        if (outbox.type !== "outbox" || outbox.value.length !== 1 || outbox.value[0]!.kind !== "delete-chat") throw new Error("CHAT_DELETION_REQUEST_CHANGED");
        await new DesktopDeletionPublisher({ ...this.ports, scope, current }).publish(outbox.value); current();
        const delivered = await store.read(scope, { type: "chat-deletion", chatId }); current();
        if (delivered.type !== "chat-deletion" || !delivered.value.result || delivered.value.result.status === "conflicted") throw new Error("CHAT_DELETION_REVIEW_REQUIRED");
      });
      await work;
    } finally { release(); }
  }
}
