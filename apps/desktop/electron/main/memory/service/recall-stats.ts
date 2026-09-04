/**
 * [INPUT]: Depends on shared observation scope/turn receipt, DurableJson and the corrupted language isolation
 * [OUTPUT]: PrOvides RecallStatsStore, recallBucketKey: Lasting cumulative recall results according to providerDataInstanceId/mode/generation, with 256 rolling requestId tabs, such as:
 * [POS]: The user can also access the user's main/memory/serviceIndependent initialization/notice/flush, any failure should not contaminate the Policy/Delivery or Chat main chain
 */

import { z } from "zod";
import type {
  MemoryObservationScope,
  MemoryRecallSnapshot,
  TurnContextReceipt,
} from "../../../../shared/memory-ipc";
import {
  DurableJson,
} from "../../persistence/durable-json";

/* ============================================================
 * 账本封顶：观测数据不配拥有无界文件。窗口只需覆盖同一 scope 的近期重放，
 * 桶只需覆盖当前实例的几次范围变更；两个上限必须与 zod 护栏同步收紧。
 * 收紧是断代——存量超窗账本 parse 失败后走隔离重建，计数不值得迁移代码。
 * ============================================================ */
const REQUEST_ID_WINDOW = 256;
const MAX_BUCKETS = 8;

const outcomeSchema = z.enum(["used", "none", "unavailable"]);
const bucketSchema = z.object({
  usedTurns: z.number().int().nonnegative(),
  zeroTurns: z.number().int().nonnegative(),
  failedTurns: z.number().int().nonnegative(),
  lastAt: z.number().int().nonnegative().nullable(),
  lastOutcome: outcomeSchema.nullable(),
  lastCount: z.number().int().nonnegative().nullable(),
  requestIds: z.array(z.string().min(1).max(256)).max(REQUEST_ID_WINDOW),
}).strict();

const schema = z.object({
  version: z.literal(1),
  buckets: z.record(z.string().min(1).max(1024), bucketSchema),
}).strict();

type RecallLedger = z.infer<typeof schema>;

const emptyLedger = (): RecallLedger => ({ version: 1, buckets: {} });
const emptySnapshot = (): MemoryRecallSnapshot => ({
  usedTurns: 0,
  zeroTurns: 0,
  failedTurns: 0,
  lastAt: null,
  lastOutcome: null,
  lastCount: null,
});

export function recallBucketKey(scope: MemoryObservationScope) {
  return `${scope.providerDataInstanceId}\0${scope.sharingMode}\0${scope.sharingGeneration}`;
}

export class RecallStatsStore {
  private ledger: DurableJson<RecallLedger>;
  private readonly projections = new Map<string, MemoryRecallSnapshot>();
  private initialized = false;
  lastError: string | null = null;

  constructor(readonly filePath: string) {
    this.ledger = this.createLedger();
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.ledger.initialize(upgradeLedger);
      this.rebuildProjections();
      this.initialized = true;
      this.lastError = null;
    } catch (cause) {
      this.lastError = `初始化失败：${errorDetail(cause)}`;
      throw cause;
    }
  }

  async recordSettledReceipt(
    bucketKey: string,
    receipt: TurnContextReceipt,
    requestId: string,
    at = Date.now()
  ) {
    try {
      if (!this.initialized || receipt.requestId !== requestId) return;
      const outcome = receipt.memory;
      if (outcome.kind === "skipped") return;
      /* mutate 无论返回什么都会落盘，去重必须拦在进入之前：否则同一 turn 的每次
         重放都换来一次 fsync。mutate 内的判定仍是权威，扛并发同 requestId。 */
      if (this.seen(bucketKey, requestId)) return;
      const written = await this.ledger.mutate((state) => {
        const bucket = state.buckets[bucketKey] ?? {
          ...emptySnapshot(),
          requestIds: [],
        };
        if (bucket.requestIds.includes(requestId)) return null;
        bucket.requestIds.push(requestId);
        bucket.requestIds.splice(
          0,
          Math.max(0, bucket.requestIds.length - REQUEST_ID_WINDOW)
        );
        if (outcome.kind === "used") bucket.usedTurns += 1;
        if (outcome.kind === "none") bucket.zeroTurns += 1;
        if (outcome.kind === "unavailable") bucket.failedTurns += 1;
        bucket.lastAt = at;
        bucket.lastOutcome = outcome.kind;
        bucket.lastCount = outcome.kind === "used" ? outcome.count : null;
        state.buckets[bucketKey] = bucket;
        return {
          projection: snapshotOf(bucket),
          evicted: compactBuckets(state, bucketKey),
        };
      });
      if (written) {
        for (const key of written.evicted) this.projections.delete(key);
        this.projections.set(bucketKey, written.projection);
      }
      this.lastError = null;
    } catch (cause) {
      this.lastError = cause instanceof Error
        ? cause.message.slice(0, 500)
        : "召回观测写入失败";
    }
  }

  projectRecall(bucketKey: string | null): MemoryRecallSnapshot {
    if (!bucketKey || !this.initialized) return emptySnapshot();
    return { ...(this.projections.get(bucketKey) ?? emptySnapshot()) };
  }

  async closeAndFlush() {
    if (!this.initialized) return;
    await this.ledger.closeAndFlush();
  }

  private createLedger() {
    return new DurableJson(this.filePath, schema, emptyLedger);
  }

  /** 只在写入路径调用：账本被 256×8 封顶后，这次深拷贝才是有界的。 */
  private seen(bucketKey: string, requestId: string) {
    return Boolean(
      this.ledger.snapshot().buckets[bucketKey]?.requestIds.includes(requestId)
    );
  }

  private rebuildProjections() {
    this.projections.clear();
    for (const [key, bucket] of Object.entries(this.ledger.snapshot().buckets)) {
      this.projections.set(key, snapshotOf(bucket));
    }
  }
}

/* 桶键含 generation，共享范围每变更一次就新增一个且永不回收。淘汰按 lastAt
   升序，当前写入的桶必须留下——否则刚记的这一笔会被自己的压缩抹掉。 */
function compactBuckets(state: RecallLedger, active: string) {
  const overflow = Object.keys(state.buckets).length - MAX_BUCKETS;
  if (overflow <= 0) return [];
  const evicted = Object.entries(state.buckets)
    .filter(([key]) => key !== active)
    .sort(([, left], [, right]) => (left.lastAt ?? 0) - (right.lastAt ?? 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of evicted) delete state.buckets[key];
  return evicted;
}

const snapshotOf = (bucket: RecallLedger["buckets"][string]) => {
  const { requestIds: _requestIds, ...snapshot } = bucket;
  return snapshot;
};

const errorDetail = (cause: unknown) =>
  cause instanceof Error ? cause.message.slice(0, 500) : "召回观测不可用";

function upgradeLedger(raw: unknown): RecallLedger | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== undefined || !record.buckets) return undefined;
  const candidate = schema.safeParse({ version: 1, buckets: record.buckets });
  return candidate.success ? candidate.data : undefined;
}
