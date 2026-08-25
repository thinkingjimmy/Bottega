/**
 * [INPUT]: Depends on ChatStore, title fallback, generators/connect ports and ChatsEvent release ports
 * [OUTPUT]: Provides ChatTitleJobs, unified with generating, fallback, CAS drop-down, connecting sync with drain barrier
 * [POS]: The title of the chats module is asymmetric task owner; ChatsService is only commissioned, not with job collection or wrong branch
 */

import type { ChatRecord, ChatsEvent } from "../../../shared/chats-ipc";
import { errorMessage } from "../errors";
import { fallbackTitle } from "./chat-commit";
import { summaryOfRecord } from "./chat-summary";
import type { ChatStore } from "./chat-store";

type ChatTitleJobOptions = {
  generateTitle(firstMessage: string): Promise<string>;
  onTitleChanged?(record: ChatRecord): Promise<void>;
};

export class ChatTitleJobs {
  private readonly jobs = new Set<Promise<void>>();

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

  sync(record: ChatRecord) {
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

  schedule(record: ChatRecord, firstMessage: string) {
    const job = this.run(record, firstMessage);
    this.jobs.add(job);
    void job.then(
      () => this.jobs.delete(job),
      (cause) => {
        this.jobs.delete(job);
        console.error(`[chats] title job failed chatId=${record.id}`, cause);
      }
    );
  }

  private async run(record: ChatRecord, firstMessage: string) {
    const title = await this.resolveTitle(record.id, firstMessage);
    try {
      const updated = await this.store.setGeneratedTitle(record.id, title);
      this.emit({ type: "upserted", summary: summaryOfRecord(updated) });
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
