/**
 * [INPUT]: Depends on node: AsyncLocalStorage for async_hooks, intent-store for carriers such as hooks, intent-types for claims/hashes
 * [OUTPUT]: Provides AdmissionGate ((admitAndRun Single-Flight Input + runRecovery Restore Input + runExclusiveAll Combination Lock) ✓ SagaResult terminal protocol with AdmissionBusyError
 * [POS]: The only top-level entry to the lifecycle saga is the overlapping conflict of the different requestId constant 409 ((the arbitrator is settled, and the callback reads in the lock to the final mode); the handler concludes the differential result, and the Gate atom settle the settlement pact v3 + R8 revisions
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  IntentConflictError,
  LifecycleIntentStore,
  type IntentLookup,
} from "./intent-store";
import {
  INTENT_PHASES,
  PROPOSED_PHASE,
  stableInputHash,
  type LifecycleIntent,
  type LifecycleKind,
} from "./intent-types";

export class AdmissionBusyError extends Error {
  /** R8 仲裁语义：重叠窗口内恒 409——错误自述状态码，边界层不必逐处 instanceof。 */
  readonly status = 409;

  constructor(readonly claims: readonly string[], readonly busyKind: LifecycleKind) {
    super(
      `资源 ${claims.join("+")} 存在进行中的 ${busyKind} 操作,请等待其完成后重试`
    );
  }
}

export class GateReentryError extends Error {
  constructor(key: string) {
    super(
      `检测到嵌套获取新资源 ${key}——claim 闭包必须在创建时完整(子事务只能在父闭包内直调 store),嵌套扩锁已 fail-fast 拒绝`
    );
  }
}

/**
 * handler 终态协议(R8):saga 以判别结果收尾,Gate 原子 settle——
 * done → settle done;business-rejected → settle rolled-back(稳定 409 语义);
 * interrupted(或抛异常)→ 不 settle,pending 留给 Reconciliation 恢复。
 */
export type SagaResult<T = unknown> =
  | { status: "done"; receipt?: Record<string, unknown>; value?: T }
  | { status: "business-rejected"; error: { code: string; message: string } }
  | { status: "interrupted" };

export type SettledOutcome = {
  state: "settled";
  status: "done" | "rolled-back";
  receipt?: Record<string, unknown>;
  error?: { code: string; message: string };
  intentId: string;
};

export type AdmitAndRunOutcome<T> =
  | { state: "executed"; intent: LifecycleIntent; result: SagaResult<T> }
  | SettledOutcome;

export type RecoveryOutcome =
  | { state: "recovered"; result: SagaResult }
  | { state: "stale-settled" }
  | { state: "superseded" };

const held = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * R8 修订后的准入协议——语义定稿:**重叠窗口内(rival 尚 pending)恒 409;
 * rival 已终结后到达的请求按新请求处理(重复业务由 saga 校验层拒绝)**:
 * ① (kind, requestId) 原子定身份——intent 以 "proposed" 落盘,claims 闭包
 *    创建时冻结(含 saga 内将产生的全部维度,如 save 的 app/project);
 * ② sorted(claims) 组合锁内重读并仲裁:admitted rival(在途/中断的 saga)
 *    → 本方让位;proposed rivals 按 (createdAt, intentId) 确定性分胜负,
 *    败者由胜者就地 settle——在线败者的调用方在锁内重读拿到 rolled-back
 *    终态(409 的落地形态),残留败者不复活;不区分在线/残留,无 epoch
 *    无租约,一条规则(R8 评审给出的最简 v1 路线);
 * ③ handler 锁内单飞执行,以 SagaResult 收尾、Gate 原子 settle。
 */
export class AdmissionGate {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: LifecycleIntentStore) {}

  async admitAndRun<T>(
    request: {
      kind: LifecycleKind;
      requestId: string;
      input: Record<string, unknown>;
      allocate?: () => Record<string, unknown>;
    },
    handler: (intent: LifecycleIntent) => Promise<SagaResult<T>>
  ): Promise<AdmitAndRunOutcome<T>> {
    this.assertNotBlocked();
    const hash = stableInputHash(request.input);

    const looked = await this.store.findByRequest(
      request.kind,
      request.requestId,
      hash
    );
    let intent: LifecycleIntent;
    if (looked.state === "settled") return looked;
    if (looked.state === "pending") {
      intent = looked.intent;
    } else {
      const result = await this.store.create({
        kind: request.kind,
        requestId: request.requestId,
        input: request.input,
        allocate: request.allocate,
      });
      intent = result.intent;
    }

    return this.runExclusiveAll(intent.claims, async () => {
      /* 锁内重读:等待期间世界可能已变(settle/被仲裁),陈旧快照作废。 */
      const fresh = await this.store.findByRequest(
        request.kind,
        request.requestId,
        hash
      );
      if (fresh.state === "settled") return fresh;
      if (fresh.state === "absent") {
        throw new IntentConflictError(
          `(${request.kind}, ${request.requestId}) 在等待准入期间消失`
        );
      }
      const admitted = await this.arbitrateLocked(fresh.intent);
      return this.executeLocked(admitted, handler);
    });
  }

  /**
   * Reconciliation 的恢复入口(R8):同一把 claims 锁、同一套仲裁——
   * 锁内重读(陈旧快照 → stale-settled),proposed 残留照常仲裁
   * (败者 → superseded),胜者/已准入者执行 handler 并按协议 settle。
   */
  async runRecovery(
    intentId: string,
    handler: (intent: LifecycleIntent) => Promise<SagaResult>
  ): Promise<RecoveryOutcome> {
    this.assertNotBlocked();
    const snapshot = await this.store.getById(intentId);
    if (!snapshot || snapshot.terminal) return { state: "stale-settled" };
    return this.runExclusiveAll(snapshot.claims, async () => {
      const fresh = await this.store.getById(intentId);
      if (!fresh || fresh.terminal) return { state: "stale-settled" } as const;
      let admitted: LifecycleIntent;
      try {
        admitted = await this.arbitrateLocked(fresh);
      } catch (cause) {
        if (cause instanceof AdmissionBusyError) {
          return { state: "superseded" } as const;
        }
        throw cause;
      }
      const outcome = await this.executeLocked(admitted, handler);
      return { state: "recovered", result: outcome.result } as const;
    });
  }

  /**
   * 组合锁:claims 去重排序后按全序逐个嵌套获取(总序消死锁)。
   * 已持锁上下文内:keys ⊆ held 直接执行(纯复用);出现任何新增 key
   * 一律 fail-fast(R8:调用序不同的部分重叠嵌套仍可 AB/BA 死锁,
   * 干脆禁止嵌套扩锁——claim 闭包完整性由创建时保证)。
   * 取得全部锁后二次检查阻断态(R8:排队期间 journal 可能已损坏)。
   */
  async runExclusiveAll<T>(
    claims: readonly string[],
    job: () => Promise<T>
  ): Promise<T> {
    this.assertNotBlocked();
    const keys = [...new Set(claims)].sort();
    const already = held.getStore();
    if (already && already.size > 0) {
      const fresh = keys.filter((key) => !already.has(key));
      if (fresh.length > 0) throw new GateReentryError(fresh[0]!);
      this.assertNotBlocked();
      return job();
    }
    const acquire = (index: number): Promise<T> => {
      if (index >= keys.length) {
        this.assertNotBlocked();
        return held.run(new Set(keys), job);
      }
      return this.withLock(keys[index]!, () => acquire(index + 1));
    };
    return acquire(0);
  }

  /* ── 内部 ── */

  /** 锁内仲裁:返回已准入的 intent;败北时回滚自身并抛 Busy(稳定 409)。 */
  private async arbitrateLocked(
    current: LifecycleIntent
  ): Promise<LifecycleIntent> {
    if (current.phase !== PROPOSED_PHASE) return current;
    const rivals = (await this.store.pendingByClaims(current.claims)).filter(
      (p) => p.intentId !== current.intentId
    );
    const admittedRival = rivals.find((p) => p.phase !== PROPOSED_PHASE);
    const senior = rivals.find(
      (p) =>
        p.createdAt < current.createdAt ||
        (p.createdAt === current.createdAt && p.intentId < current.intentId)
    );
    const loss = admittedRival ?? senior;
    if (loss) {
      await this.store.settle(current.intentId, {
        status: "rolled-back",
        error: {
          code: "ADMISSION_BUSY",
          message: `被进行中的 ${loss.kind}(${loss.intentId})互斥`,
        },
      });
      throw new AdmissionBusyError(current.claims, loss.kind);
    }
    /* 本方为最年长 proposed:清场全部败者——其在线调用方将在锁内重读到
     * 该终态并如实返回(409 落地);残留败者不经 Reconciliation 复活。 */
    for (const rival of rivals) {
      await this.store.settle(rival.intentId, {
        status: "rolled-back",
        error: {
          code: "ADMISSION_BUSY",
          message: `同资源仲裁败于 ${current.kind}(${current.intentId})`,
        },
      });
    }
    return this.store.advance(
      current.intentId,
      INTENT_PHASES[current.kind][1]
    );
  }

  /** 锁内执行 + 按 SagaResult 原子 settle(R8 终态协议;异常不 settle 留恢复)。 */
  private async executeLocked<T>(
    intent: LifecycleIntent,
    handler: (intent: LifecycleIntent) => Promise<SagaResult<T>>
  ): Promise<{ state: "executed"; intent: LifecycleIntent; result: SagaResult<T> }> {
    const result = await handler(intent);
    if (result.status === "done") {
      await this.store.settle(intent.intentId, {
        status: "done",
        receipt: result.receipt,
      });
    } else if (result.status === "business-rejected") {
      await this.store.settle(intent.intentId, {
        status: "rolled-back",
        error: result.error,
      });
    }
    return { state: "executed", intent, result };
  }

  private withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
    const tail = this.locks.get(key) ?? Promise.resolve();
    const run = tail.then(job);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }

  private assertNotBlocked(): void {
    const blocked = this.store.isBlocked();
    if (blocked) throw blocked;
  }
}

export { IntentConflictError, type IntentLookup };
