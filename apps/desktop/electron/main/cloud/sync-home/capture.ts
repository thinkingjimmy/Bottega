/**
 * [INPUT]: Depends on approved account scope, terminal coordinator callbacks, Chat outbox jobs and owned Home files.
 * [OUTPUT]: Freezes terminal Home bytes before subsequent local turns; retries transient failures with capped exponential backoff scoped to the current account and outbox, never rescans a permanent one, and exposes per-Chat status, Retry and Skip.
 * Outbox scans prune only unchanged backoffs captured before the scan, preserving concurrent failures.
 * [POS]: Local Home capture owner; SQLite owns scheduling, the skip transaction and account cleanup drains active filesystem work.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatSyncApi } from "../../chats/store/sync/api";
import { homeJobSchema, type HomeTurn } from "../../chats/sqlite/cloud/home/contracts";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { SyncBindingStore } from "../sync/account/binding";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import { chatIdOf, readOutboxSource, type ChatOutboxItem } from "../sync/chats/sources";
import { HomeSourceCustody } from "./custody";
import { readFrozenHome, saveFrozenHome } from "./encryption/source";

/** The Chat's first unfrozen snapshot; the renderer sees it through ExecutionView.homeCapture. */
export type HomeCaptureStatus = { chatId: string; jobId: string; reason: "pending" | "transient" | "permanent"; failures: number; retryAt: number | null };
export const HOME_CAPTURE_FAILED = "HOME_SNAPSHOT_CAPTURE_FAILED";
export const HOME_CAPTURE_UNRECOVERABLE = "HOME_SNAPSHOT_CAPTURE_UNRECOVERABLE";
/* Failures a retry cannot fix: the Home owner or the frozen identity is gone. Everything else (disk full, I/O, locks) is transient. */
const PERMANENT = ["HOME_OWNERSHIP_UNAVAILABLE", "HOME_SOURCE_IDENTITY_CHANGED", "HOME_JOB_IDENTITY_CHANGED"];
const permanent = (error: unknown) => error instanceof Error && PERMANENT.some(code => error.message.includes(code));
/** 2 s doubling to 60 s, with ±20 % jitter so many failed Chats do not rescan in lockstep. */
export function homeRetryDelay(failures: number, random: () => number) {
  return Math.round(Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1)) * (0.8 + 0.4 * random()));
}

export class LocalHomeCapture {
  private closed = false;
  private readonly flights = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  /* Backoff belongs to one account's outbox: a scope change (cleanup, another account) drops it, or a stale due entry re-arms at 0 ms (F06). */
  private readonly backoff = new Map<string, { failures: number; retryAt: number }>();
  private backoffUser: string | null = null;
  private readonly listeners = new Set<(chatId: string) => void>();
  private readonly detach: () => void;
  private readonly random: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pass: Promise<void> | null = null;
  constructor(private readonly input: { config: CloudBuildConfig; userData: string; binding: SyncBindingStore; store: Pick<ChatSyncApi, "read" | "mutate" | "onHomeSettlement">; homes: ChatHomeService;
    own(activity: { close(): Promise<void> }): () => void; random?: () => number }) {
    this.random = input.random ?? Math.random;
    this.detach = input.store.onHomeSettlement(turn => this.capture(turn));
    this.schedule(2_000);
  }
  onChange(listener: (chatId: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(chatId: string) { for (const listener of [...this.listeners]) listener(chatId); }
  /* One timer at the earliest due retry; none while only permanent failures wait (C-29, F-14). */
  private schedule(delay: number) {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, Math.max(0, delay)); this.timer.unref?.();
  }
  private disarm() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private scope() {
    const binding = this.input.binding.snapshot();
    const scope = !this.closed && binding && binding.phase !== "closing" ? { environment: this.input.config.environmentId, userId: binding.userId } : null;
    if ((scope?.userId ?? null) !== this.backoffUser) { this.backoff.clear(); this.backoffUser = scope?.userId ?? null; }
    return scope;
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
        homeSnapshotId: job.expectedSnapshotId, headSeq: job.throughSeq }, job.snapshotId, abort.signal);
      current(); await saveFrozenHome(checkpoints, frozen);
    }).then(() => { if (this.backoff.delete(item.id)) this.changed(chatIdOf(item)); }).catch(async error => {
      if (this.scope()?.userId === scope.userId && !abort.signal.aborted) {
        const lasting = permanent(error), failures = (this.backoff.get(item.id)?.failures ?? 0) + 1;
        this.backoff.set(item.id, { failures, retryAt: lasting ? Infinity : Date.now() + homeRetryDelay(failures, this.random) });
        await this.input.store.mutate(scope, crypto.randomUUID(), {
          type: "attempt-outbox", id: item.id, payloadDigest: item.payload_digest, error: lasting ? HOME_CAPTURE_UNRECOVERABLE : HOME_CAPTURE_FAILED }).catch(() => {});
        this.reschedule(); this.changed(chatIdOf(item));
      }
      throw error;
    }).finally(() => { release(); this.flights.delete(item.id); });
    this.flights.set(item.id, { promise, abort }); return promise;
  }
  private reschedule() {
    const next = Math.min(...[...this.backoff.values()].map(value => value.retryAt));
    if (Number.isFinite(next)) this.schedule(next - Date.now()); else this.disarm();
  }
  flush() {
    if (this.pass) return this.pass;
    const promise = this.retryPending(); this.pass = promise;
    void promise.finally(() => { if (this.pass === promise) this.pass = null; }).catch(() => {}); return promise;
  }
  /* Due jobs only. A job recorded as unrecoverable (also after a restart) waits for an explicit Retry or Skip. */
  private async retryPending() {
    const scope = this.scope(); if (!scope) return;
    let afterId: string | null = null; const queued = new Set<string>();
    const previousBackoff = new Map(this.backoff);
    for (;;) {
      if (this.scope()?.userId !== scope.userId) return;
      const page = await this.input.store.read(scope, { type: "outbox", entityKind: "home-snapshot", afterId, limit: 100 });
      if (page.type !== "outbox") throw new Error("HOME_JOBS_UNAVAILABLE");
      for (const item of page.value) {
        queued.add(item.id); const backoff = this.backoff.get(item.id);
        if (item.last_error === HOME_CAPTURE_UNRECOVERABLE && !backoff) this.backoff.set(item.id, { failures: item.attempts, retryAt: Infinity });
        if ((this.backoff.get(item.id)?.retryAt ?? 0) > Date.now()) continue;
        // Each failure is recorded on its own job; one bad snapshot must not stop the retry of the rest (F-14).
        await this.freeze(scope, item).catch(() => undefined);
      }
      if (page.value.length < 100) break; afterId = page.value.at(-1)!.id;
    }
    // A job that left the outbox (published, skipped elsewhere) keeps no backoff; with nothing due the timer stops.
    for (const [id, previous] of previousBackoff) {
      if (!queued.has(id) && this.backoff.get(id) === previous) this.backoff.delete(id);
    }
    this.reschedule();
  }
  /* Every queued job of the Chat, oldest turn first. The outbox pages by id, which is a content hash, so neither page order nor the
     first page says which job is latest (review 0929 R02). */
  private async pendingJobs(scope: SyncScope, chatId: string) {
    const all: ChatOutboxItem[] = [];
    for (let afterId: string | null = null; ;) {
      const page = await this.input.store.read(scope, { type: "outbox", entityKind: "home-snapshot", chatId, afterId, limit: 100 });
      if (page.type !== "outbox") throw new Error("HOME_JOBS_UNAVAILABLE");
      all.push(...page.value);
      if (page.value.length < 100) break; afterId = page.value.at(-1)!.id;
    }
    all.sort((a, b) => a.seq_or_revision - b.seq_or_revision);
    const pending: ChatOutboxItem[] = [];
    for (const item of all) if (!await new ChatDeliveryCheckpoints(this.input.store, scope, item).get("home-manifest")) pending.push(item);
    return { all, pending };
  }
  /** The Chat's first snapshot that is not frozen yet, which is what the next send waits for; null when nothing blocks it. */
  async status(chatId: string): Promise<HomeCaptureStatus | null> {
    const scope = this.scope(); if (!scope) return null;
    const [item] = (await this.pendingJobs(scope, chatId)).pending; if (!item) return null;
    const backoff = this.backoff.get(item.id);
    const reason = item.last_error === HOME_CAPTURE_UNRECOVERABLE || backoff?.retryAt === Infinity ? "permanent" : item.last_error ? "transient" : "pending";
    return { chatId, jobId: item.id, reason, failures: backoff?.failures ?? item.attempts, retryAt: reason === "transient" && backoff ? backoff.retryAt : null };
  }
  /** Retry now, including a permanent failure whose cause the user may have fixed. */
  async retry(chatId: string) {
    const scope = this.scope(); if (!scope) return null;
    for (const item of (await this.pendingJobs(scope, chatId)).pending) {
      this.backoff.delete(item.id);
      await this.freeze(scope, item).catch(() => undefined);
    }
    this.changed(chatId); return this.status(chatId);
  }
  /** Skip the job the status row named; the store re-checks in one transaction that it is this Chat's latest and still unfrozen (HOME_SKIP_AFTER_CAPTURE). */
  async skip(chatId: string, jobId: string) {
    const scope = this.scope(); if (!scope) return;
    const item = (await this.pendingJobs(scope, chatId)).all.find(job => job.id === jobId); if (!item) return;
    const flight = this.flights.get(item.id);
    if (flight) { flight.abort.abort(); await flight.promise.catch(() => {}); }
    const result = await this.input.store.mutate(scope, hashChatContent(["home-skip", scope, item.id, item.payload_digest]), { type: "skip-home-job", id: item.id, payloadDigest: item.payload_digest, chatId });
    if (result.result.type !== "skip-home-job") throw new Error("HOME_JOB_RECEIPT_INVALID");
    this.backoff.delete(item.id);
    await new HomeSourceCustody(this.input.userData, scope, item.id).release();
    this.reschedule(); this.changed(chatId);
  }
  async close() {
    this.closed = true; this.disarm(); this.detach(); this.listeners.clear();
    const flights = [...this.flights.values()]; for (const flight of flights) flight.abort.abort();
    await Promise.allSettled(flights.map(flight => flight.promise)); await this.pass?.catch(() => {});
  }
}
