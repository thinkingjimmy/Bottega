/**
 * [INPUT]: Depends on Node worker_threads, durable pre-copy Base snapshot descriptors with live identity checks, canonical sizing/digests, Query V1 requests, a per-request AbortSignal, and the bundled query worker entry
 * [OUTPUT]: Provides a lazy off-main Query V1 executor with epoch-safe pre-copy reservation, atomic snapshot pinning, per-surface single queued reservation, abort-driven dequeue/undispatch, typed copy-conflict translation, post-query revision fencing, strict request-shaped worker replies, 700 KiB handoff, absolute deadline, bounded FIFO/cache, and terminating worker custody
 * [POS]: Main-side Query V1 resource owner; the HTTP router supplies authority while this module owns memory and worker lifetime
 */

import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  baseGuiQueryPageSchema,
  type BaseGuiQueryRequestV1,
} from "../../../../../shared/app-gui/query";
import { canonicalDigest, canonicalJson } from "../../gui-build/metadata";
import { apiError } from "./errors";
import type { BaseGuiQuerySnapshotSource } from "./router";

const CACHE_LIMIT = 128 * 1024 * 1024;
const SNAPSHOT_LIMIT = 20 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 500;
const QUERY_QUEUE_TIMEOUT_MS = 100;
const MAX_PENDING = 32;
const RESPONSE_LIMIT = 700 * 1024;

type Reservation = {
  bytes: number;
  baseInstanceId: string;
  revision: number;
  touchedAt: number;
  inFlight: number;
  stale: boolean;
};

type CapacityWaiter = Readonly<{
  surfaceId: string;
  requestId: string;
  enqueuedAt: number;
  bytes: number;
  resolve(): void;
  reject(cause: unknown): void;
  dispose(): void;
}>;

type Pending = {
  resolve(value: unknown): void;
  reject(cause: unknown): void;
  timer: NodeJS.Timeout;
  deadlineAt: number;
  allowStarted: boolean;
  started: boolean;
  validate(value: unknown): unknown;
  dispose(): void;
};

type WorkerReply = Readonly<{
  requestId: string;
  ok: boolean;
  started?: boolean;
  result?: unknown;
  error?: Readonly<{
    message: string;
    status?: number;
    code?: string;
    outcome?: "not-committed" | "unknown";
    issues?: unknown[];
  }>;
}>;

export class BaseGuiQueryExecutor {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly aliases = new Map<string, string>();
  private readonly loading = new Map<string, Promise<string>>();
  private readonly loadingBase = new Map<string, string>();
  private readonly activeByBase = new Map<string, string>();
  private readonly capacityWaiters: CapacityWaiter[] = [];
  private reservedBytes = 0;
  private cacheEpoch = 0;
  private closing = false;

  constructor(private readonly workerEntry: string) {}

  async query(input: {
    source: BaseGuiQuerySnapshotSource;
    request: BaseGuiQueryRequestV1;
    cursorKey: Uint8Array;
    surfaceId: string;
    signal?: AbortSignal;
  }) {
    const deadline = Date.now() + QUERY_TIMEOUT_MS;
    const signal = input.signal;
    assertLive(signal);
    const { snapshotKey, reservation } = await this.acquire(input, deadline);
    try {
      assertLive(signal);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw apiError(408, "query_timeout", "Query exceeded its 500 ms wall budget");
      }
      const result = await this.send({
        type: "query",
        snapshotKey,
        request: input.request,
        cursorKey: [...input.cursorKey],
        deadlineAt: deadline,
      }, remaining, Math.min(QUERY_QUEUE_TIMEOUT_MS, remaining), true, (value) =>
        validateQueryResult(value, input.request, input.source), signal
      );
      const current = await input.source.currentIdentity();
      if (
        !current ||
        current.baseInstanceId !== input.source.baseInstanceId ||
        current.revision !== input.source.revision
      ) throw apiError(409, "query_revision_changed", "Base revision changed while the query was executing");
      return result;
    } finally {
      reservation.inFlight -= 1;
      if (reservation.inFlight < 0) this.quarantine("Query snapshot refcount became negative");
      if (reservation.stale && reservation.inFlight === 0) this.drop(snapshotKey);
      this.serviceCapacityWaiters();
    }
  }

  /* 取快照与钉引用必须在同一个同步块里完成：ensureSnapshot 可能返回一个
     早已解析的别名，等本协程被唤醒时，另一条查询的 finally 已经把
     inFlight===0 的快照回收掉了。先 get 再 ++，中间不许出现 await。 */
  private async acquire(
    input: Readonly<{ source: BaseGuiQuerySnapshotSource; surfaceId: string; signal?: AbortSignal }>,
    deadline: number
  ) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshotKey = await this.ensureSnapshot(input, deadline);
      const reservation = this.reservations.get(snapshotKey);
      if (reservation) {
        reservation.inFlight += 1;
        reservation.touchedAt = Date.now();
        return { snapshotKey, reservation };
      }
    }
    throw apiError(409, "query_revision_changed", "Base query snapshot was evicted before this query started");
  }

  async shutdown() {
    this.closing = true;
    const worker = this.worker;
    this.worker = null;
    this.rejectPending(apiError(503, "query_executor_closed", "Query executor is closed"));
    this.clearCache();
    if (worker) await worker.terminate();
  }

  private ensureSnapshot(
    input: Readonly<{ source: BaseGuiQuerySnapshotSource; surfaceId: string; signal?: AbortSignal }>,
    deadline: number
  ) {
    const descriptorKey = identity(input.source);
    const alias = this.aliases.get(descriptorKey);
    if (alias && this.reservations.has(alias)) return Promise.resolve(alias);
    const existing = this.loading.get(descriptorKey);
    if (existing) return existing;
    const loading = this.register(descriptorKey, input, deadline).finally(() => {
      if (this.loading.get(descriptorKey) !== loading) return;
      this.loading.delete(descriptorKey);
      this.loadingBase.delete(descriptorKey);
    });
    this.loading.set(descriptorKey, loading);
    this.loadingBase.set(descriptorKey, input.source.baseInstanceId);
    return loading;
  }

  private async register(
    descriptorKey: string,
    input: Readonly<{ source: BaseGuiQuerySnapshotSource; surfaceId: string; signal?: AbortSignal }>,
    deadline: number
  ) {
    const source = input.source;
    if (source.expectedRowsBytes > SNAPSHOT_LIMIT) {
      throw apiError(413, "query_budget_exceeded", "Base snapshot exceeds 20 MiB");
    }
    this.assertBaseSlot(source.baseInstanceId, descriptorKey);
    await this.reserveExpected(source.expectedRowsBytes, deadline, input.surfaceId, input.signal);
    const cacheEpoch = this.cacheEpoch;
    let chargedBytes = source.expectedRowsBytes;
    let snapshotKey = "";
    try {
      /* Bases 的 copyQuerySnapshot 用无 code 的 409 表达「拷贝前 revision
         已变」。在这个边界把它翻译成契约错误，否则它会以 internal_error
         的形态漏到 App。 */
      const snapshot = await source.copy().catch((cause: unknown) => {
        throw untypedConflict(cause)
          ? apiError(409, "query_revision_changed", "Base revision changed during snapshot copy")
          : cause;
      });
      if (this.cacheEpoch !== cacheEpoch || this.closing) {
        throw apiError(503, "query_executor_reset", "Query executor cache was reset during snapshot copy");
      }
      if (
        snapshot.meta.ownerInstanceId !== source.baseInstanceId ||
        snapshot.meta.revision !== source.revision
      ) {
        throw apiError(409, "query_revision_changed", "Base revision changed during snapshot copy");
      }
      const bytes = Buffer.byteLength(canonicalJson(snapshot.rows));
      if (bytes > source.expectedRowsBytes || bytes > SNAPSHOT_LIMIT) {
        throw apiError(503, "query_snapshot_capacity", "Durable Base rows byte identity was exceeded");
      }
      snapshotKey = `${descriptorKey}:${canonicalDigest(snapshot)}`;
      this.reservedBytes -= source.expectedRowsBytes - bytes;
      chargedBytes = bytes;
      this.reservations.set(snapshotKey, {
        bytes,
        baseInstanceId: source.baseInstanceId,
        revision: source.revision,
        touchedAt: Date.now(),
        inFlight: 0,
        stale: false,
      });
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw apiError(408, "query_timeout", "Query exceeded its 500 ms wall budget during snapshot copy");
      }
      await this.send(
        { type: "register", snapshotKey, snapshot, rowsBytes: bytes },
        remaining,
        undefined,
        false,
        validateRegisterResult,
        input.signal
      );
      this.aliases.set(descriptorKey, snapshotKey);
      this.activateSnapshot(source.baseInstanceId, snapshotKey);
      return snapshotKey;
    } catch (cause) {
      if (snapshotKey && this.reservations.has(snapshotKey)) {
        this.drop(snapshotKey);
      } else if (this.cacheEpoch === cacheEpoch) {
        this.reservedBytes -= chargedBytes;
        if (this.reservedBytes < 0) this.quarantine("Query snapshot charge became negative");
        this.serviceCapacityWaiters();
      }
      throw cause;
    }
  }

  private async reserveExpected(
    bytes: number,
    deadline: number,
    surfaceId: string,
    signal: AbortSignal | undefined
  ) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > SNAPSHOT_LIMIT) {
      throw apiError(413, "query_budget_exceeded", "Base snapshot byte reservation is invalid");
    }
    if (this.tryReserve(bytes)) return;
    /* 每个 surface 最多一个排队中的预留：没有这条身份约束，一个 App 循环
       重试就能把 32 个槽位全部占满，其他 surface 永远抢不到容量。 */
    if (this.capacityWaiters.some((item) => item.surfaceId === surfaceId)) {
      throw apiError(503, "query_snapshot_capacity", "This surface already has a queued snapshot reservation");
    }
    if (this.capacityWaiters.length >= MAX_PENDING) {
      throw apiError(503, "query_snapshot_capacity", "Query snapshot reservation queue is full");
    }
    const remaining = Math.min(QUERY_QUEUE_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) {
      throw apiError(503, "query_snapshot_capacity", "Query snapshot reservation timed out");
    }
    await new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const remove = () => {
        const index = this.capacityWaiters.findIndex((item) => item.requestId === requestId);
        if (index >= 0) this.capacityWaiters.splice(index, 1);
      };
      const timer = setTimeout(() => {
        remove();
        reject(apiError(503, "query_snapshot_capacity", "Query snapshot reservation timed out"));
      }, remaining);
      const onAbort = () => {
        remove();
        clearTimeout(timer);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.capacityWaiters.push({
        surfaceId,
        requestId,
        enqueuedAt: Date.now(),
        bytes,
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      });
      this.capacityWaiters.sort((left, right) =>
        left.enqueuedAt - right.enqueuedAt || compareText(left.requestId, right.requestId)
      );
    });
  }

  private tryReserve(bytes: number) {
    while (this.reservedBytes + bytes > CACHE_LIMIT) {
      const victim = [...this.reservations.entries()]
        .filter(([, value]) => value.inFlight === 0)
        .sort((left, right) =>
          left[1].touchedAt - right[1].touchedAt || compareText(left[0], right[0])
        )[0];
      if (!victim) return false;
      this.drop(victim[0], false);
    }
    this.reservedBytes += bytes;
    return true;
  }

  private serviceCapacityWaiters() {
    while (this.capacityWaiters.length) {
      const waiter = this.capacityWaiters[0]!;
      if (!this.tryReserve(waiter.bytes)) return;
      this.capacityWaiters.shift();
      waiter.dispose();
      waiter.resolve();
    }
  }

  private assertBaseSlot(baseInstanceId: string, descriptorKey: string) {
    const existing = [...this.reservations.entries()]
      .filter(([, value]) => value.baseInstanceId === baseInstanceId)
      .sort((left, right) => right[1].revision - left[1].revision);
    for (const [key, value] of existing.slice(1)) {
      if (value.inFlight === 0) this.drop(key, false);
    }
    const retained = existing.filter(([key]) => this.reservations.has(key));
    const occupied = new Set(retained.map(([, value]) => identity(value)));
    for (const [loadingKey, loadingBase] of this.loadingBase) {
      if (loadingBase === baseInstanceId) occupied.add(loadingKey);
    }
    if (!occupied.has(descriptorKey) && occupied.size >= 2) {
      throw apiError(503, "query_snapshot_capacity", "Base already retains active and previous query snapshots");
    }
  }

  private activateSnapshot(baseInstanceId: string, snapshotKey: string) {
    const previous = this.activeByBase.get(baseInstanceId);
    this.activeByBase.set(baseInstanceId, snapshotKey);
    if (!previous || previous === snapshotKey) return;
    const reservation = this.reservations.get(previous);
    if (!reservation) return;
    reservation.stale = true;
    if (reservation.inFlight === 0) this.drop(previous);
  }

  private drop(snapshotKey: string, wake = true) {
    const reservation = this.reservations.get(snapshotKey);
    if (!reservation) return;
    this.reservedBytes -= reservation.bytes;
    if (this.reservedBytes < 0) this.quarantine("Query snapshot charge became negative");
    this.reservations.delete(snapshotKey);
    for (const [alias, key] of this.aliases) {
      if (key === snapshotKey) this.aliases.delete(alias);
    }
    if (this.activeByBase.get(reservation.baseInstanceId) === snapshotKey) {
      this.activeByBase.delete(reservation.baseInstanceId);
    }
    this.worker?.postMessage({ type: "evict", snapshotKey });
    if (wake) this.serviceCapacityWaiters();
  }

  private send(
    message: Record<string, unknown>,
    timeoutMs: number,
    queueTimeoutMs: number | undefined,
    allowStarted: boolean,
    validate: (value: unknown) => unknown,
    signal?: AbortSignal
  ) {
    if (this.closing) {
      return Promise.reject(apiError(503, "query_executor_closed", "Query executor is closed"));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(apiError(429, "query_queue_full", "Query worker queue is full"));
    }
    const worker = this.ensureWorker();
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => queueTimeoutMs
        ? this.rejectQueued(requestId)
        : this.failWorker(apiError(408, "query_timeout", "Query worker exceeded its wall budget")),
      queueTimeoutMs ?? timeoutMs);
      /* 客户端断开时立刻放弃这条 pending：worker 迟到的回复会因为找不到
         requestId 被 receive 丢弃，不需要也不应该 terminate worker。 */
      const onAbort = () => this.rejectPendingRequest(requestId, abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        deadlineAt: Date.now() + timeoutMs,
        allowStarted,
        started: false,
        validate,
        dispose: () => signal?.removeEventListener("abort", onAbort),
      });
      worker.postMessage({
        ...message,
        requestId,
        ...(queueTimeoutMs
          ? { queueDeadlineAt: Date.now() + queueTimeoutMs }
          : {}),
      });
    });
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerEntry);
    worker.unref();
    worker.on("message", (reply: unknown) => this.receive(reply));
    worker.on("error", (cause) => this.failWorker(cause));
    worker.on("exit", (code) => {
      if (this.worker === worker && code !== 0) {
        this.failWorker(apiError(503, "query_worker_exit", `Query worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    return worker;
  }

  private receive(value: unknown) {
    let reply: WorkerReply;
    try {
      reply = parseWorkerReply(value);
    } catch (cause) {
      this.failWorker(cause);
      return;
    }
    const pending = this.pending.get(reply.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (reply.started) {
      if (!pending.allowStarted) {
        this.failWorker(apiError(503, "query_worker_invalid", "Query worker sent an unexpected started envelope"));
        return;
      }
      pending.started = true;
      const remaining = pending.deadlineAt - Date.now();
      if (remaining <= 0) {
        this.failWorker(apiError(408, "query_timeout", "Query worker exceeded its 500 ms wall budget"));
        return;
      }
      pending.timer = setTimeout(() => {
        this.failWorker(apiError(408, "query_timeout", "Query worker exceeded its 500 ms wall budget"));
      }, remaining);
      return;
    }
    if (reply.ok) {
      try {
        const result = pending.validate(reply.result);
        this.pending.delete(reply.requestId);
        pending.dispose();
        pending.resolve(result);
      } catch (cause) {
        pending.reject(cause);
        this.pending.delete(reply.requestId);
        pending.dispose();
        this.failWorker(cause);
      }
      return;
    }
    this.pending.delete(reply.requestId);
    pending.dispose();
    pending.reject(Object.assign(new Error(reply.error?.message ?? "Query worker failed"), {
      status: reply.error?.status ?? 500,
      code: reply.error?.code ?? "query_worker_failed",
      outcome: reply.error?.outcome ?? "unknown",
      ...(reply.error?.issues ? { issues: reply.error.issues } : {}),
    }));
  }

  private failWorker(cause: unknown) {
    const worker = this.worker;
    this.worker = null;
    this.rejectPending(cause);
    this.clearCache();
    if (worker) void worker.terminate();
  }

  private rejectQueued(requestId: string) {
    const pending = this.pending.get(requestId);
    if (!pending || pending.started) return;
    this.rejectPendingRequest(
      requestId,
      apiError(429, "query_queue_timeout", "Query worker queue exceeded 100 ms")
    );
  }

  private rejectPendingRequest(requestId: string, cause: unknown) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.dispose();
    pending.reject(cause);
  }

  private rejectPending(cause: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.dispose();
      pending.reject(cause);
    }
    this.pending.clear();
  }

  private clearCache() {
    this.cacheEpoch += 1;
    this.reservations.clear();
    this.aliases.clear();
    this.loading.clear();
    this.loadingBase.clear();
    this.activeByBase.clear();
    this.reservedBytes = 0;
    while (this.capacityWaiters.length) {
      const waiter = this.capacityWaiters.shift()!;
      waiter.dispose();
      waiter.reject(apiError(503, "query_executor_reset", "Query executor cache was reset"));
    }
  }

  private quarantine(message: string): never {
    const error = apiError(503, "query_executor_quarantined", message);
    this.failWorker(error);
    throw error;
  }
}

function identity(source: Pick<BaseGuiQuerySnapshotSource, "baseInstanceId" | "revision">) {
  return `${source.baseInstanceId}:${source.revision}`;
}

function abortError() {
  return apiError(499, "client_aborted", "Query client aborted the request");
}

function assertLive(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

/* BaseStoreConflictError 只有 status=409 而没有 code；带 code 的错误已经是
   契约错误，原样上抛。 */
function untypedConflict(cause: unknown) {
  const error = cause as { status?: unknown; code?: unknown } | null;
  return error?.status === 409 && typeof error.code !== "string";
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRegisterResult(value: unknown) {
  if (!isRecord(value) || !exactKeys(value, ["registered"]) || value.registered !== true) {
    throw apiError(503, "query_worker_invalid", "Query worker returned an invalid registration result");
  }
  return { registered: true } as const;
}

function validateQueryResult(
  value: unknown,
  request: BaseGuiQueryRequestV1,
  source: Pick<BaseGuiQuerySnapshotSource, "baseInstanceId" | "revision">
) {
  const parsed = baseGuiQueryPageSchema(request).safeParse(value);
  if (!parsed.success) {
    throw apiError(503, "query_worker_invalid", "Query worker returned an invalid request-shaped page");
  }
  if (
    parsed.data.baseInstanceId !== source.baseInstanceId ||
    parsed.data.revision !== source.revision
  ) {
    throw apiError(503, "query_worker_invalid", "Query worker returned the wrong Base snapshot identity");
  }
  if (Buffer.byteLength(canonicalJson(parsed.data)) > RESPONSE_LIMIT) {
    throw apiError(503, "query_worker_invalid", "Query worker response exceeds 700 KiB");
  }
  return parsed.data;
}

function parseWorkerReply(value: unknown): WorkerReply {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.ok !== "boolean") {
    throw apiError(503, "query_worker_invalid", "Query worker envelope is invalid");
  }
  if (value.started === true) {
    if (value.ok !== true || !exactKeys(value, ["requestId", "ok", "started"])) {
      throw apiError(503, "query_worker_invalid", "Query worker started envelope is invalid");
    }
    return value as WorkerReply;
  }
  if (value.ok === true) {
    if (!exactKeys(value, ["requestId", "ok", "result"])) {
      throw apiError(503, "query_worker_invalid", "Query worker success envelope is invalid");
    }
    return value as WorkerReply;
  }
  if (!exactKeys(value, ["requestId", "ok", "error"]) || !validWorkerError(value.error)) {
    throw apiError(503, "query_worker_invalid", "Query worker error envelope is invalid");
  }
  return value as WorkerReply;
}

function validWorkerError(value: unknown) {
  if (!isRecord(value) || typeof value.message !== "string" || value.message.length > 4_096) return false;
  if (!Object.keys(value).every((key) => ["message", "status", "code", "outcome", "issues"].includes(key))) return false;
  if (value.status !== undefined && (!Number.isInteger(value.status) || Number(value.status) < 400 || Number(value.status) > 599)) return false;
  if (value.code !== undefined && (typeof value.code !== "string" || value.code.length > 120)) return false;
  if (value.outcome !== undefined && value.outcome !== "not-committed" && value.outcome !== "unknown") return false;
  return value.issues === undefined || Array.isArray(value.issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}
