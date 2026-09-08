/**
 * [INPUT]: Depends on ChatStore, title fallback, generators/connect ports and ChatsEvent release ports
 * [OUTPUT]: Runs durable title jobs with typed authentication deferral, original receipt CAS, coalesced eligibility wakes, finite drain and lifecycle-controlled subscription.
 * [POS]: Title outbox worker for chats; ChatStore owns the durable job and ChatsService only triggers delivery
 */

import type { ChatRecord, ChatsEvent } from "../../../shared/chats-ipc";
import type { ChatTitleJob } from "../../../shared/placement/facts";
import { errorMessage } from "../errors";
import { fallbackTitle } from "./chat-commit";
import { summaryOfChat } from "./chat-summary";
import type { ChatStore } from "./chat-store";

type ChatTitleJobOptions = {
  generateTitle(firstMessage: string, context?: { chatId: string }): Promise<string>;
  subscribeTitleEligibility?(wake: () => void): () => void;
  onTitleChanged?(
    record: Pick<ChatRecord, "id" | "incarnationId" | "title">
  ): Promise<void>;
};

type ChatTitleFacts = Pick<ChatRecord, "id" | "titleJob">;

export class TitleEligibilityDeferred extends Error {
  readonly name = "TitleEligibilityDeferred";
  constructor() { super("Title authentication is not yet confirmed"); }
}

export class ChatTitleJobs {
  private readonly jobs = new Set<Promise<void>>();
  private readonly activeJobIds = new Set<string>();
  private wakeRevision = 0;
  private unsubscribe?: () => void;
  private closed = true;

  constructor(
    private readonly store: ChatStore,
    private readonly options: ChatTitleJobOptions,
    private readonly emit: (event: ChatsEvent) => void
  ) { this.reopen(); }

  async wake() {
    if (this.closed) return;
    this.wakeRevision += 1;
    const recovery = this.recover();
    this.jobs.add(recovery);
    try { await recovery; } finally { this.jobs.delete(recovery); }
  }
  close() { this.closed = true; this.unsubscribe?.(); this.unsubscribe = undefined; }
  reopen() {
    if (!this.closed) return;
    this.closed = false;
    this.unsubscribe = this.options.subscribeTitleEligibility?.(() => { void this.wake(); });
  }

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
    if (this.closed || record.titleJob.state !== "pending") return;
    const jobId = record.titleJob.jobId;
    if (this.activeJobIds.has(jobId)) return;
    this.activeJobIds.add(jobId);
    const startedRevision = this.wakeRevision;
    const job = this.run(record, firstMessage, record.titleJob);
    this.jobs.add(job);
    void job.then(
      () => {
        this.jobs.delete(job);
        this.activeJobIds.delete(jobId);
        if (this.wakeRevision !== startedRevision) {
          const current = this.store.getMetadata(record.id);
          if (current?.titleJob.state === "pending") this.schedule(current, firstMessage);
        }
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
    const current = this.store.getMetadata(record.id);
    if (!current || current.titleJob.state !== "pending" || current.titleJob.jobId !== receipt.jobId) return;
    const title = await this.resolveTitle(record.id, firstMessage);
    if (title === undefined) return;
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
      return await this.options.generateTitle(firstMessage, { chatId });
    } catch (cause) {
      if (cause instanceof TitleEligibilityDeferred) return undefined;
      console.warn(`[chats] title generation failed chatId=${chatId}`, cause);
      return fallbackTitle(firstMessage);
    }
  }
}
