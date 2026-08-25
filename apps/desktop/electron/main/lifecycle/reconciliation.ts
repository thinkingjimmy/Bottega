/**
 * [INPUT]: Depends on intent-store pending listing with tombstone compression, admission-gate combination lock, kind of intent-types
 * [OUTPUT]: The first step is to create a new system that can be used to make the data
 * [POS]: The fourth section of the contract v3 starts with the accounting skeleton file Archive/Purge, running after recovery, before conversation admission opens; before recovery intent, then file back to the project across the library, and projection failure is not stopped
 */

import type { AdmissionGate, SagaResult } from "./admission-gate";
import {
  LifecycleJournalCorruptError,
  type LifecycleIntentStore,
} from "./intent-store";
import type { LifecycleIntent, LifecycleKind } from "./intent-types";

export type RecoveryHandler = (intent: LifecycleIntent) => Promise<SagaResult>;

export type RecoveryReport = {
  consumed: Array<{ intentId: string; kind: LifecycleKind }>;
  skipped: Array<{ intentId: string; kind: LifecycleKind; why: "stale-settled" | "superseded" }>;
  unhandled: Array<{ intentId: string; kind: LifecycleKind }>;
  failed: Array<{ intentId: string; kind: LifecycleKind; message: string }>;
  /** projection 是幂等回填，失败只上报不中止——下次启动或运行期原语自愈。 */
  projectionFailures: Array<{ name: string; message: string }>;
  compactedTerminals: number;
};

export class LifecycleReconciliation {
  private readonly handlers = new Map<LifecycleKind, RecoveryHandler>();
  private readonly projections = new Map<string, () => Promise<void>>();
  private running: Promise<RecoveryReport> | null = null;

  constructor(
    private readonly store: LifecycleIntentStore,
    private readonly gate: AdmissionGate
  ) {}

  registerRecovery(kind: LifecycleKind, handler: RecoveryHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`kind ${kind} 的恢复矩阵已注册,禁止覆盖`);
    }
    this.handlers.set(kind, handler);
  }

  registerProjection(name: string, reconcile: () => Promise<void>): void {
    if (this.projections.has(name)) {
      throw new Error(`projection ${name} 的对账器已注册,禁止覆盖`);
    }
    this.projections.set(name, reconcile);
  }

  /**
   * 幂等对账,进程内单飞(并发 run 合流到同一次执行——R7/P0-7 防重复派发):
   * 逐个消费 pending 顶层 intent,handler 在该 intent 的 claims 组合锁内执行
   * (与在线 admission 走同一互斥面);未注册 kind fail-loud 上报;普通异常
   * 记录不中断,LifecycleJournalCorruptError 立即中止整个 run 并重抛(fail-closed,
   * 绝不带着损坏疑点继续恢复或压缩)。
   */
  run(): Promise<RecoveryReport> {
    if (this.running) return this.running;
    const execution = this.runOnce().finally(() => {
      this.running = null;
    });
    this.running = execution;
    return execution;
  }

  private async runOnce(): Promise<RecoveryReport> {
    const blocked = this.store.isBlocked();
    if (blocked) throw blocked;
    const report: RecoveryReport = {
      consumed: [],
      skipped: [],
      unhandled: [],
      failed: [],
      projectionFailures: [],
      compactedTerminals: 0,
    };
    const pending = await this.store.listPending();
    for (const intent of pending) {
      if (intent.parentIntentId !== undefined) continue;
      const handler = this.handlers.get(intent.kind);
      if (!handler) {
        report.unhandled.push({ intentId: intent.intentId, kind: intent.kind });
        continue;
      }
      try {
        /* R8:恢复经 runRecovery——锁内重读(陈旧快照 skip)、proposed 残留
         * 走同一仲裁(败者 superseded),与在线 admission 完全同一互斥面。 */
        const outcome = await this.gate.runRecovery(intent.intentId, handler);
        if (outcome.state === "recovered") {
          report.consumed.push({ intentId: intent.intentId, kind: intent.kind });
        } else {
          report.skipped.push({
            intentId: intent.intentId,
            kind: intent.kind,
            why: outcome.state,
          });
        }
      } catch (cause) {
        if (cause instanceof LifecycleJournalCorruptError) throw cause;
        report.failed.push({
          intentId: intent.intentId,
          kind: intent.kind,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    for (const [name, reconcile] of this.projections) {
      try {
        await reconcile();
      } catch (cause) {
        report.projectionFailures.push({
          name,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    report.compactedTerminals = await this.store.compactTerminals();
    return report;
  }
}
