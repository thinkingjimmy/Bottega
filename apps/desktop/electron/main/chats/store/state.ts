/**
 * [INPUT]: Depends on SerialQueue, ChatStoreProjection, the typed SQLite client, Chat metadata/record types, and ChatNotFoundError
 * [OUTPUT]: Provides ChatStoreState — the single mutable cell shared by ChatStore and its read/saga collaborators (metadata map, message revisions, serial queue, projection, warnings, storage failures, published aggregate slot, database client, device id, store revision) plus the primitive accessors they all need
 * [POS]: The composition root of chats/store; collaborators receive this object instead of inheriting from one another
 */

import type { ChatStorageFailure } from "../../../../shared/product-failure";
import type { ChatRecord } from "../../../../shared/chats-ipc";
import { SerialQueue } from "../../persistence/serial-queue";
import { ChatNotFoundError } from "../chat-commit";
import type { ChatMetadata } from "../chat-summary";
import { ChatStoreProjection } from "../chat-store-projection";
import { ChatDatabaseClient } from "../sqlite/database-client";

export type PublishedRecord = Readonly<{
  record: ChatRecord;
  revision: number;
}>;

const clone = <T>(value: T): T => structuredClone(value);

/* 一个可变格子，三个协作者：ChatStore 排队并发布，ChatReadModel 只读投影，
   ChatHistorySagaApi 走 import/continuation 命令。以前它们靠继承互相摸到
   对方的字段——十三个 protected abstract 只是把耦合写成了类型。 */
export class ChatStoreState {
  readonly queue = new SerialQueue();
  readonly metadata = new Map<string, ChatMetadata>();
  readonly messageRevisions = new Map<string, number>();
  readonly warnings: string[] = [];
  readonly storageFailures: ChatStorageFailure[] = [];
  readonly projection: ChatStoreProjection;
  /* 最后 durable generation 的原子发布单元。record 只在队列内部构造且从不
     原地改写；所有外部返回值先 clone，因此快速读可一次取得同代 record+revision。 */
  activeRecord: PublishedRecord | undefined;
  database: ChatDatabaseClient | null = null;
  deviceId: string | null = null;
  storeRevision = 0;

  constructor(
    readonly userData: string,
    readonly now: () => number
  ) {
    this.projection = new ChatStoreProjection(this.metadata);
  }

  requireDatabase() {
    if (!this.database) throw new Error("Chat SQLite database is unavailable");
    return this.database;
  }

  requireDeviceId() {
    if (!this.deviceId) throw new Error("Chat device identity is unavailable");
    return this.deviceId;
  }

  revisionOf(chatId: string) {
    return this.messageRevisions.get(chatId) ?? 0;
  }

  touch() {
    this.storeRevision += 1;
  }

  remember(record: ChatRecord, revision: number) {
    // record 是 parse/schema 的新所有权值；队列内部不得原地改写它。
    this.activeRecord = Object.freeze({ record, revision });
  }

  async readRecord(chatId: string) {
    const record = await this.requireDatabase().execute({
      kind: "get-record",
      chatId,
      deviceId: this.requireDeviceId(),
    });
    if (!record) throw new ChatNotFoundError("聊天账本不存在");
    return record;
  }

  async refreshMetadata(chatId: string) {
    const [record] = await this.requireDatabase().execute({
      kind: "list-metadata",
      deviceId: this.requireDeviceId(),
      chatId,
    });
    if (!record) throw new Error(`Chat ${chatId} is missing from SQLite metadata`);
    this.metadata.set(record.id, record);
    this.messageRevisions.set(record.id, record.chatMessageRevision);
    this.storeRevision += 1;
    return clone(record);
  }
}
