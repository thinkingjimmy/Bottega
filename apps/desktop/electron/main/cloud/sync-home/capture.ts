/**
 * [INPUT]: Depends on approved account scope, terminal coordinator callbacks, Chat outbox jobs and owned Home files.
 * [OUTPUT]: Freezes terminal Home bytes before subsequent local turns and retries incomplete copies while transport is paused.
 * [POS]: Local Home capture owner; SQLite owns scheduling and account cleanup drains active filesystem work.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatSyncApi } from "../../chats/store/sync/api";
import { homeJobSchema, type HomeTurn } from "../../chats/sqlite/cloud/home/contracts";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { SyncBindingStore } from "../sync/account/binding";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import { readOutboxSource, type ChatOutboxItem } from "../sync/chats/sources";
import { HomeSourceCustody } from "./custody";
import { readFrozenHome, saveFrozenHome } from "./encryption/source";
export class LocalHomeCapture {
  private closed = false;
  private readonly flights = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  private readonly detach: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private retry: Promise<void> | null = null;
  constructor(private readonly input: { config: CloudBuildConfig; userData: string; binding: SyncBindingStore; store: Pick<ChatSyncApi, "read" | "mutate" | "onHomeSettlement">; homes: ChatHomeService;
    own(activity: { close(): Promise<void> }): () => void }) {
    this.detach = input.store.onHomeSettlement(turn => this.capture(turn));
    this.timer = setInterval(() => { void this.flush().catch(() => {}); }, 2000); this.timer.unref();
  }
  private scope() {
    const binding = this.input.binding.snapshot();
    return !this.closed && binding && binding.phase !== "closing" ? { environment: this.input.config.environmentId, userId: binding.userId } : null;
  }
  async capture(turn: HomeTurn) {
    const scope = this.scope(); if (!scope) return;
    const result = await this.input.store.mutate(scope, hashChatContent(["home-capture", scope, turn]), { type: "capture-home-job", turn });
    if (result.result.type !== "capture-home-job") throw new Error("HOME_JOB_RECEIPT_INVALID");
    if (!result.result.value) return;
    const pending = await this.input.store.read(scope, { type: "outbox", id: result.result.value.id, entityKind: "home-snapshot", afterId: null, limit: 1 });
    if (pending.type !== "outbox") throw new Error("HOME_JOB_UNAVAILABLE");
    if (pending.value[0]) await this.freeze(scope, pending.value[0]);
  }
  private freeze(scope: SyncScope, item: ChatOutboxItem) {
    const existing = this.flights.get(item.id); if (existing) return existing.promise;
    const abort = new AbortController();
    const current = () => {
      abort.signal.throwIfAborted();
      if (this.scope()?.userId !== scope.userId) throw new Error("HOME_CAPTURE_SCOPE_CLOSED");
    };
    current();
    const release = this.input.own({ close: async () => { abort.abort(); await promise.catch(() => {}); } });
    const promise = Promise.resolve().then(async () => {
      current(); const checkpoints = new ChatDeliveryCheckpoints(this.input.store, scope, item);
      if (await readFrozenHome(checkpoints)) return;
      const source = await readOutboxSource(this.input.store, scope, item), job = homeJobSchema.parse(source.payload); current();
      if (source.chatId !== job.chatId || job.id !== item.id) throw new Error("HOME_JOB_IDENTITY_CHANGED");
      const custody = new HomeSourceCustody(this.input.userData, scope, item.id);
      const frozen = await custody.capture(this.input.homes, { chat: { id: job.chatId, incarnationId: job.incarnationId },
        executionEpoch: job.executionEpoch, homeSnapshotId: job.expectedSnapshotId, headSeq: job.throughSeq }, job.snapshotId, abort.signal);
      current(); await saveFrozenHome(checkpoints, frozen);
    }).catch(async error => {
      if (this.scope()?.userId === scope.userId && !abort.signal.aborted) await this.input.store.mutate(scope, crypto.randomUUID(), {
        type: "attempt-outbox", id: item.id, payloadDigest: item.payload_digest, error: "HOME_SNAPSHOT_CAPTURE_FAILED" }).catch(() => {});
      throw error;
    }).finally(() => { release(); this.flights.delete(item.id); });
    this.flights.set(item.id, { promise, abort }); return promise;
  }
  flush() {
    if (this.retry) return this.retry;
    const promise = this.retryPending(); this.retry = promise;
    void promise.finally(() => { if (this.retry === promise) this.retry = null; }).catch(() => {}); return promise;
  }
  private async retryPending() {
    const scope = this.scope(); if (!scope) return;
    let afterId: string | null = null;
    for (;;) {
      if (this.scope()?.userId !== scope.userId) return;
      const page = await this.input.store.read(scope, { type: "outbox", entityKind: "home-snapshot", afterId, limit: 100 });
      if (page.type !== "outbox") throw new Error("HOME_JOBS_UNAVAILABLE");
      for (const item of page.value) await this.freeze(scope, item);
      if (page.value.length < 100) return; afterId = page.value.at(-1)!.id;
    }
  }
  async close() {
    this.closed = true; clearInterval(this.timer); this.detach();
    const flights = [...this.flights.values()]; for (const flight of flights) flight.abort.abort();
    await Promise.allSettled(flights.map(flight => flight.promise)); await this.retry?.catch(() => {});
  }
}
