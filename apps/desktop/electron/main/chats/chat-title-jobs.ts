/**
 * [INPUT]: Depends on ChatStore, title fallback, generators/connect ports and ChatsEvent release ports
 * [OUTPUT]: Provides durable title-outbox recovery, at-least-once dispatch, job/source CAS effect, fallback generation, sync, and drain barrier
 * [POS]: Title outbox worker for chats; ChatStore owns the durable job and ChatsService only triggers delivery
 */

import type { ChatRecord, ChatsEvent } from "../../../shared/chats-ipc";
import type { ChatTitleJob } from "../../../shared/placement/facts";
import { errorMessage } from "../errors";
import { fallbackTitle } from "./chat-commit";
import { summaryOfChat } from "./chat-summary";
import type { ChatStore } from "./chat-store";

type ChatTitleJobOptions = {
  generateTitle(firstMessage: string): Promise<string>;
  onTitleChanged?(
    record: Pick<ChatRecord, "id" | "incarnationId" | "title">
  ): Promise<void>;
};

type ChatTitleFacts = Pick<ChatRecord, "id" | "titleJob">;

export class ChatTitleJobs {
  private readonly jobs = new Set<Promise<void>>();
  private readonly activeJobIds = new Set<string>();

  constructor(
    private readonly store: ChatStore,
    private readonly options: ChatTitleJobOptions,
    private readonly emit: (event: ChatsEvent) => void
  ) {}

  async drain() {
    while (this.jobs.size) {
      await Promise.allSettled([...this.jobs]);
    }
  }

  sync(record: Pick<ChatRecord, "id" | "incarnationId" | "title">) {
    try {
      const pending = this.options.onTitleChanged?.(record);
      if (pending) {
        void pending.catch((cause) => {
          console.warn(`[chats] title sync failed chatId=${record.id}`, cause);
        });
      }
    } catch (cause) {
      console.warn(`[chats] title sync failed chatId=${record.id}`, cause);
    }
  }

  /* 只有还挂着 pending 的那几条才值得回一趟数据库：整库启动时逐条问
     「第一条用户消息是什么」，等于为一件根本不会发生的事付全表的钱。 */
  async recover() {
    for (const summary of this.store.list()) {
      const record = this.store.getMetadata(summary.id);
      if (record?.titleJob.state !== "pending") continue;
      const firstUser = await this.store.getNativeMessage(summary.id, {
        kind: "first-user",
      });
      if (firstUser) this.schedule(record, firstUser.content);
    }
  }

  schedule(record: ChatTitleFacts, firstMessage: string) {
    if (record.titleJob.state !== "pending") return;
    const jobId = record.titleJob.jobId;
    if (this.activeJobIds.has(jobId)) return;
    this.activeJobIds.add(jobId);
    const job = this.run(record, firstMessage, record.titleJob);
    this.jobs.add(job);
    void job.then(
      () => {
        this.jobs.delete(job);
        this.activeJobIds.delete(jobId);
      },
      (cause) => {
        this.jobs.delete(job);
        this.activeJobIds.delete(jobId);
        console.error(`[chats] title job failed chatId=${record.id}`, cause);
      }
    );
  }

  private async run(
    record: ChatTitleFacts,
    firstMessage: string,
    receipt: Extract<ChatTitleJob, { state: "pending" }>
  ) {
    const title = await this.resolveTitle(record.id, firstMessage);
    try {
      const updated = await this.store.setGeneratedTitle(
        record.id,
        title,
        receipt
      );
      this.emit({
        type: "upserted",
        summary: summaryOfChat(updated),
        chatRecordRevision: updated.chatRecordRevision,
        collectionSnapshotRevision: this.store.getStoreRevision(),
      });
      this.sync(updated);
    } catch (cause) {
      if (!this.store.has(record.id)) return;
      const message = `聊天标题保存失败：${errorMessage(cause)}`;
      console.error(`[chats] ${message}`, cause);
      this.emit({ type: "warning", message });
    }
  }

  private async resolveTitle(chatId: string, firstMessage: string) {
    if (!firstMessage.trim()) return fallbackTitle(firstMessage);
    try {
      return await this.options.generateTitle(firstMessage);
    } catch (cause) {
      console.warn(`[chats] title generation failed chatId=${chatId}`, cause);
      return fallbackTitle(firstMessage);
    }
  }
}
