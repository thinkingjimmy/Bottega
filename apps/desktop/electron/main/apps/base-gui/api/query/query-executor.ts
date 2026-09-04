/**
 * [INPUT]: Depends on the Query V1 worker transport, durable pre-copy Base snapshot descriptors with live identity checks, Query V1 requests, and a per-request AbortSignal
 * [OUTPUT]: Provides a lazy off-main Query V1 executor with epoch-safe pre-copy reservation, born-pinned snapshot registration, LRU eviction, immediate typed rejection once the byte budget is exhausted, typed copy-conflict translation, post-query revision fencing, request-shaped page validation, and a 128 MiB canonical-JSON byte budget
 * [POS]: Main-side Query V1 resource owner of api/query/; the parent api/router.ts supplies authority, query-worker-client.ts owns the thread, and this module owns memory
 */

import {
  baseGuiQueryPageSchema,
  type BaseGuiQueryRequestV1,
} from "../../../../../../shared/app-gui/query";
import { canonicalJson } from "../../../gui-build/metadata";
import { apiError } from "../errors";
import { abortError, exactKeys, isRecord, QueryWorkerClient } from "./query-worker-client";
import type { BaseGuiQuerySnapshotSource } from "../router";

/* 128 MiB 记的是快照行的规范 JSON 字节数，不是 V8 堆占用：它是一条会计口径
   的额度，用来防止无界缓存，不承诺进程 RSS。 */
const CACHE_LIMIT = 128 * 1024 * 1024;
const SNAPSHOT_LIMIT = 20 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 500;
const QUERY_QUEUE_TIMEOUT_MS = 100;
const RESPONSE_LIMIT = 700 * 1024;

type Reservation = {
  bytes: number;
  baseInstanceId: string;
  revision: number;
  touchedAt: number;
  inFlight: number;
  stale: boolean;
};

type SnapshotInput = Readonly<{
  source: BaseGuiQuerySnapshotSource;
  signal?: AbortSignal;
}>;

export class BaseGuiQueryExecutor {
  private readonly worker: QueryWorkerClient;
  private readonly reservations = new Map<string, Reservation>();
  private readonly loading = new Map<string, Promise<Reservation>>();
  private readonly loadingBase = new Map<string, string>();
  private readonly activeByBase = new Map<string, string>();
  private reservedBytes = 0;
  private cacheEpoch = 0;

  constructor(workerEntry: string) {
    this.worker = new QueryWorkerClient(workerEntry, () => this.clearCache());
  }

  async query(input: {
    source: BaseGuiQuerySnapshotSource;
    request: BaseGuiQueryRequestV1;
    cursorKey: Uint8Array;
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
      const result = await this.worker.send({
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
    }
  }

  shutdown() {
    return this.worker.close();
  }

  /* 快照身份就是 (baseInstanceId, revision)：revision 严格 +1，同一份身份不可能
     指向两份不同的行。取快照与钉引用必须落在同一个同步块里——先 get 再 ++，
     中间不许出现 await，否则被唤醒时它可能已经被回收。 */
  private async acquire(input: SnapshotInput, deadline: number) {
    const snapshotKey = identity(input.source);
    const cached = this.reservations.get(snapshotKey);
    if (cached) return { snapshotKey, reservation: pin(cached) };
    const loading = this.loading.get(snapshotKey);
    /* 注册者以 inFlight:1 建仓，那枚钉直接归它；后到的等待者在 await 返回的
       同一个同步块里补钉，此刻注册者的钉还按着，快照不会被淘汰。 */
    if (!loading) return { snapshotKey, reservation: await this.register(snapshotKey, input, deadline) };
    return { snapshotKey, reservation: pin(await loading) };
  }

  private register(snapshotKey: string, input: SnapshotInput, deadline: number) {
    const loading = this.load(snapshotKey, input, deadline).finally(() => {
      if (this.loading.get(snapshotKey) !== loading) return;
      this.loading.delete(snapshotKey);
      this.loadingBase.delete(snapshotKey);
    });
    this.loading.set(snapshotKey, loading);
    this.loadingBase.set(snapshotKey, input.source.baseInstanceId);
    return loading;
  }

  private async load(
    snapshotKey: string,
    input: SnapshotInput,
    deadline: number
  ): Promise<Reservation> {
    const source = input.source;
    if (source.expectedRowsBytes > SNAPSHOT_LIMIT) {
      throw apiError(413, "query_budget_exceeded", "Base snapshot exceeds 20 MiB");
    }
    this.assertBaseSlot(source.baseInstanceId, snapshotKey);
    this.reserveExpected(source.expectedRowsBytes);
    const cacheEpoch = this.cacheEpoch;
    try {
      /* Bases 的 copyQuerySnapshot 用无 code 的 409 表达「拷贝前 revision
         已变」。在这个边界把它翻译成契约错误，否则它会以 internal_error
         的形态漏到 App。 */
      const snapshot = await source.copy().catch((cause: unknown) => {
        throw untypedConflict(cause)
          ? apiError(409, "query_revision_changed", "Base revision changed during snapshot copy")
          : cause;
      });
      if (this.cacheEpoch !== cacheEpoch || this.worker.closed) {
        throw apiError(503, "query_executor_reset", "Query executor cache was reset during snapshot copy");
      }
      if (
        snapshot.meta.ownerInstanceId !== source.baseInstanceId ||
        snapshot.meta.revision !== source.revision
      ) {
        throw apiError(409, "query_revision_changed", "Base revision changed during snapshot copy");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw apiError(408, "query_timeout", "Query exceeded its 500 ms wall budget during snapshot copy");
      }
      /* 收费口径是 source.expectedRowsBytes：它来自持久层，是一个上界。为了
         把它换成「精确值」而在主线程上规范序列化 + 摘要整份快照，是拿几十
         毫秒的卡顿去买一个额度里根本用不上的精度。 */
      await this.worker.send(
        { type: "register", snapshotKey, snapshot, rowsBytes: source.expectedRowsBytes },
        remaining,
        undefined,
        false,
        validateRegisterResult,
        input.signal
      );
      /* 建仓即带钉：先以 inFlight:0 落表再去 await 注册，中途一次淘汰就能把
         它抽走，等注册回来时钉的已经是一具空壳。 */
      const reservation: Reservation = {
        bytes: source.expectedRowsBytes,
        baseInstanceId: source.baseInstanceId,
        revision: source.revision,
        touchedAt: Date.now(),
        inFlight: 1,
        stale: false,
      };
      this.reservations.set(snapshotKey, reservation);
      this.activateSnapshot(source.baseInstanceId, snapshotKey);
      return reservation;
    } catch (cause) {
      if (this.cacheEpoch === cacheEpoch) {
        this.reservedBytes -= source.expectedRowsBytes;
        if (this.reservedBytes < 0) this.quarantine("Query snapshot charge became negative");
      }
      throw cause;
    }
  }

  /* assertBaseSlot 已把每个 Base 钉死在两份 ≤20 MiB 的快照上：要撑满 128 MiB
     额度得有四个 Base 同时各钉两份满快照。为这种形状排一条队，等的是一次几乎
     不会到来的释放，只把同一个 503 推迟 100 ms——容量耗尽就当场按契约拒绝。 */
  private reserveExpected(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > SNAPSHOT_LIMIT) {
      throw apiError(413, "query_budget_exceeded", "Base snapshot byte reservation is invalid");
    }
    if (this.tryReserve(bytes)) return;
    throw apiError(503, "query_snapshot_capacity", "Query snapshot cache is at its 128 MiB budget");
  }

  private tryReserve(bytes: number) {
    while (this.reservedBytes + bytes > CACHE_LIMIT) {
      const victim = [...this.reservations.entries()]
        .filter(([, value]) => value.inFlight === 0)
        .sort((left, right) =>
          left[1].touchedAt - right[1].touchedAt || compareText(left[0], right[0])
        )[0];
      if (!victim) return false;
      this.drop(victim[0]);
    }
    this.reservedBytes += bytes;
    return true;
  }

  private assertBaseSlot(baseInstanceId: string, snapshotKey: string) {
    const existing = [...this.reservations.entries()]
      .filter(([, value]) => value.baseInstanceId === baseInstanceId)
      .sort((left, right) => right[1].revision - left[1].revision);
    for (const [key, value] of existing.slice(1)) {
      if (value.inFlight === 0) this.drop(key);
    }
    const occupied = new Set(existing.map(([key]) => key).filter((key) => this.reservations.has(key)));
    for (const [loadingKey, loadingBase] of this.loadingBase) {
      if (loadingBase === baseInstanceId) occupied.add(loadingKey);
    }
    if (!occupied.has(snapshotKey) && occupied.size >= 2) {
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

  private drop(snapshotKey: string) {
    const reservation = this.reservations.get(snapshotKey);
    if (!reservation) return;
    this.reservedBytes -= reservation.bytes;
    if (this.reservedBytes < 0) this.quarantine("Query snapshot charge became negative");
    this.reservations.delete(snapshotKey);
    if (this.activeByBase.get(reservation.baseInstanceId) === snapshotKey) {
      this.activeByBase.delete(reservation.baseInstanceId);
    }
    this.worker.notify({ type: "evict", snapshotKey });
  }

  private clearCache() {
    this.cacheEpoch += 1;
    this.reservations.clear();
    this.loading.clear();
    this.loadingBase.clear();
    this.activeByBase.clear();
    this.reservedBytes = 0;
  }

  private quarantine(message: string): never {
    const error = apiError(503, "query_executor_quarantined", message);
    this.worker.fail(error);
    throw error;
  }
}

function pin(reservation: Reservation) {
  reservation.inFlight += 1;
  reservation.touchedAt = Date.now();
  return reservation;
}

function identity(source: Pick<BaseGuiQuerySnapshotSource, "baseInstanceId" | "revision">) {
  return `${source.baseInstanceId}:${source.revision}`;
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
  /* 超出 700 KiB 的页是「这一页装不下」，不是「worker 坏了」：这是唯一一处
     由请求形状而非执行器故障决定的拒绝，必须用预算的名字说话。 */
  if (Buffer.byteLength(canonicalJson(parsed.data)) > RESPONSE_LIMIT) {
    throw apiError(413, "query_budget_exceeded", "Query page exceeds its 700 KiB response budget");
  }
  return parsed.data;
}
