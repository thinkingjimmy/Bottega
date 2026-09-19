/**
 * [INPUT]: Depends on the ChatStore sync facade and immutable outbox checkpoint contracts.
 * [OUTPUT]: Reads and saves receipt-backed component checkpoints with deterministic local operation identities.
 * [POS]: Main delivery adapter; retained payloads and their roots remain owned by Chat SQLite.
 */
import { frozenFileRecordSchema, type FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { frozenMessageRecordSchema, type MessageCipherJournal } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatDeliveryCheckpointSchema, checkpointKey, type ChatDeliveryCheckpoint } from "../../../chats/sqlite/cloud/delivery/contracts";
import { readChatSource, type ChatOutboxItem, type ChatSyncStore } from "./sources";
export class ChatDeliveryCheckpoints {
  constructor(private readonly store: ChatSyncStore, private readonly scope: SyncScope, private readonly item: ChatOutboxItem) {}
  messageJournal(): MessageCipherJournal {
    return { read: async key => { const value = await this.get(key); return value ? frozenMessageRecordSchema.parse(value) : null; },
      write: async (key, raw) => {
        const value = frozenMessageRecordSchema.parse(raw);
        if (checkpointKey(value) !== key) throw new Error("MESSAGE_CHECKPOINT_KEY_MISMATCH");
        const existing = await this.get(key); if (existing) return frozenMessageRecordSchema.parse(existing);
        try { return frozenMessageRecordSchema.parse(await this.save(value)); }
        catch (error) { const winner = await this.get(key); if (winner) return frozenMessageRecordSchema.parse(winner); throw error; }
      } };
  }
  fileJournal(): FrozenFileJournal {
    return { read: async key => { const value = await this.get(key); return value ? frozenFileRecordSchema.parse(value) : null; },
      write: async (key, raw) => {
        const value = frozenFileRecordSchema.parse(raw);
        if (checkpointKey(value) !== key) throw new Error("FILE_CHECKPOINT_KEY_MISMATCH");
        const existing = await this.get(key); if (existing) return frozenFileRecordSchema.parse(existing);
        try { return frozenFileRecordSchema.parse(await this.save(value)); }
        catch (error) {
          const winner = await this.get(key); if (winner) return frozenFileRecordSchema.parse(winner); throw error;
        }
      } };
  }
  async get(key: string) {
    const result = await this.store.read(this.scope, { type: "outbox-checkpoint", id: this.item.id, key });
    if (result.type !== "outbox-checkpoint") throw new Error("CHAT_CHECKPOINT_INVALID");
    return result.value ? chatDeliveryCheckpointSchema.parse(await readChatSource(this.store, this.scope, result.value)) : null;
  }
  async save(checkpoint: ChatDeliveryCheckpoint) {
    const value = chatDeliveryCheckpointSchema.parse(checkpoint);
    const receipt = await this.store.mutate(this.scope, hashChatContent(["chat-delivery", this.item.id, checkpointKey(value), value]), {
      type: "save-outbox-checkpoint", id: this.item.id, payloadDigest: this.item.payload_digest, checkpoint: value,
    });
    if (receipt.result.type !== "save-outbox-checkpoint") throw new Error("CHAT_CHECKPOINT_RECEIPT_INVALID");
    return value;
  }
}
