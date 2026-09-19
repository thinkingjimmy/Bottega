/**
 * [INPUT]: Depends on the admitted encrypted-space permanent feed, original SQLite cursor and native/mirror custody adapters.
 * [OUTPUT]: Applies Chat deletion before uploads, preserves native recovery and rearchives late local evidence without republishing it.
 * [POS]: Account-owned Chat deletion consumer; other entity owners maintain their own deletion cursors.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { BaseStore } from "../../../bases/base-store";
import { chatIdOf, type ChatOutboxItem } from "../chats/sources";
import { CloudMirrorDeletion } from "./mirrors";
import { pullDeletionPage, type DeletionFeedPorts, type DeletionHead } from "./feed";
import type { RecoverySave } from "../../chat/recovery/save";
export class DesktopChatDeletions {
  private readonly mirrors: CloudMirrorDeletion;
  constructor(private readonly ports: DeletionFeedPorts & { userData: string; bases?: BaseStore; recovery?: Pick<RecoverySave, "save">; assertIdle?(chatId: string): void; changed(): void }) {
    this.mirrors = new CloudMirrorDeletion(ports);
  }
  private async apply(marker: CloudTombstone) {
    const { store, scope, current, bases } = this.ports;
    current();
    for (const { ownerKey, snapshot } of bases?.listAll() ?? []) {
      if (snapshot.meta.owner.kind !== "chat" || snapshot.meta.owner.chatId !== marker.entityId) continue;
      const state = bases!.sync.read(ownerKey, snapshot.meta.ownerInstanceId);
      if (state.scope?.environment === scope.environment && state.scope.userId === scope.userId) {
        await bases!.sync.acceptDeletion(ownerKey, snapshot.meta.ownerInstanceId, scope); current();
      }
    }
    if (await this.mirrors.apply(marker)) return;
    const target = await store.read(scope, { type: "deletion-target", chatId: marker.entityId }); current();
    if (target.type !== "deletion-target" || target.value?.residence !== "native") throw new Error("DELETION_TARGET_CHANGED");
    if (target.value.deletion && target.value.outboxHash === hashChatContent([])) return;
    this.ports.assertIdle?.(marker.entityId);
    const facts = { tombstone: marker, expectedRevision: target.value.revision,
      expectedMessageRevision: target.value.messageRevision, expectedOutboxHash: target.value.outboxHash };
    let recovery: { archiveId: string | null; childId: string | null } | undefined;
    if (this.ports.recovery) {
      const action = { type: "prepare-deleted-chat" as const, ...facts };
      const result = await store.mutate(scope, hashChatContent([scope, action]), action); current();
      if (result.result.type !== "prepare-deleted-chat") throw new Error("CHAT_DELETION_ARCHIVE_UNAVAILABLE");
      const archiveId = result.result.value.archiveId;
      const childId = archiveId ? await this.ports.recovery.save(scope, { chatId: marker.entityId, archiveId }, { currentHome: true }) : null;
      current(); this.ports.assertIdle?.(marker.entityId); recovery = { archiveId, childId };
    }
    const action = { type: "retain-deleted-chat" as const, ...facts, ...(recovery ? { recovery } : {}) };
    await store.mutate(scope, hashChatContent(["retain-deleted-chat", scope, action]), action); current(); this.ports.changed();
  }
  async pull(shared?: DeletionHead) {
    const deleted: string[] = [];
    await pullDeletionPage(this.ports, "chatDeletions", async marker => {
      if (marker.entityKind === "chat") { await this.apply(marker); deleted.push(marker.entityId); }
    }, shared);
    return deleted;
  }
  async retainLate(items: ChatOutboxItem[]) {
    const ids = new Set(items.filter(item => item.kind !== "delete-chat").map(chatIdOf));
    for (const chatId of ids) {
      this.ports.current(); const target = await this.ports.store.read(this.ports.scope, { type: "deletion-target", chatId });
      if (target.type === "deletion-target" && target.value?.deletion) await this.apply(target.value.deletion);
    }
  }
}
