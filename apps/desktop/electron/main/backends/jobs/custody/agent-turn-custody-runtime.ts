/**
 * [INPUT]: Depends on AgentTurnCustodyJournal and converge from the custody kernel
 * [OUTPUT]: Provides AgentTurnCustodyRuntime for a previous life's agent-turn journal: startup reconcile (an intent is aborted, anything owned converges to released or quarantined), heldBy for what a request still holds, single-call convergeTurn and listQuarantined; LaunchIdentity
 * [POS]: The one-time convergence kept for upgrades (TASK-11 flip): every turn now runs on its Provider's bridge with its process in host custody, so nothing begins an agent-turn entry any more; this only settles what an earlier build left
 */

import { converge, type CustodyRuntimeOptions } from "../../../custody/attachment";
import type { AgentTurnCustodyJournal } from "./agent-turn-custody-journal";

export type { CustodyRuntimeOptions };

/** A turn's process group as custody recorded it at launch: every signal to it is checked against this birth first. */
export type LaunchIdentity = { pid: number; birthIdentity: string };
const launchIdentityOf = (entry: { processIdentity?: { pid: number; birthIdentity: string } }): LaunchIdentity | null =>
  entry.processIdentity ? { pid: entry.processIdentity.pid, birthIdentity: entry.processIdentity.birthIdentity } : null;

export type CustodyReconcileReport = {
  /** 已证明进程组退出；dependency 可以安全释放 */
  released: CustodyIdentity[];
  /** pre-owned intent 的不可逆 tombstone；同样可释放 dependency */
  aborted: CustodyIdentity[];
  /** 身份不确定或杀不掉：不发信号、不释放，全部关联能力保持 fail closed */
  quarantined: CustodyIdentity[];
};

type CustodyIdentity = { custodyId: string; turnRequestId: string };

/** 单条 turn 的收口结论；`absent` 表示账本里本来就没有可恢复 entry。 */
export type CustodyTurnOutcome =
  | "absent"
  | "aborted"
  | "released"
  | "quarantined";

export class AgentTurnCustodyRuntime {
  constructor(
    private readonly journal: AgentTurnCustodyJournal,
    private readonly options: CustodyRuntimeOptions
  ) {}

  async initialize() {
    await this.journal.initialize();
  }

  /**
   * What custody still holds for one request: `null` when nothing recoverable remains (released, aborted, or never begun —
   * intent precedes any spawn, so no entry is proof of no process); otherwise its launch identity, or null identity when the
   * entry has none yet (an intent, whose guardian never received anything to run).
   */
  heldBy(turnRequestId: string): { identity: LaunchIdentity | null } | null {
    const entry = this.journal.listRecoverable().find((item) => item.turnRequestId === turnRequestId);
    return entry ? { identity: launchIdentityOf(entry) } : null;
  }

  /**
   * 启动时逐 phase 收敛。必须跑在 App/Extension lifecycle 与任何
   * GC/Cleanup **之前**：内存 registry 是空的，而空不构成 release 证据。
   */
  async reconcile(): Promise<CustodyReconcileReport> {
    const report: CustodyReconcileReport = {
      released: [],
      aborted: [],
      quarantined: [],
    };
    for (const entry of this.journal.listRecoverable()) {
      const identity = {
        custodyId: entry.custodyId,
        turnRequestId: entry.turnRequestId,
      };
      if (entry.phase === "intent") {
        /* intent guardian 没有任何 capability，owner 也不可能在重启后仍在跑。
           唯一诚实的收口是 durable abort——绝不为了「有个 PID 可杀」而编一个。 */
        await this.journal.abortBeforeOwned(
          entry.custodyId,
          entry.revision,
          "owner-no-longer-live"
        );
        report.aborted.push(identity);
        continue;
      }
      const settled = await converge(this.journal, this.options, entry);
      if (settled.phase === "released") report.released.push(identity);
      else report.quarantined.push(identity);
    }
    return report;
  }

  /**
   * 按 durable identity 收口**一条** turn 的 custody。它与 `reconcile` 共用同一
   * 条判据，区别只是范围：那里是「重启后的全部」，这里是「用户刚按下 Stop 的
   * 这一条」。intent 只能 abort（没有 PID 可杀，编一个就是伪造）；owned 之后
   * 一律走接管或 kill+wait，杀完还在就 quarantine，绝不谎报释放。
   */
  async convergeTurn(turnRequestId: string): Promise<CustodyTurnOutcome> {
    const entry = this.journal
      .listRecoverable()
      .find((item) => item.turnRequestId === turnRequestId);
    if (!entry) return "absent";
    try {
      if (entry.phase === "intent") {
        await this.journal.abortBeforeOwned(
          entry.custodyId,
          entry.revision,
          "cancelled-before-owned"
        );
        return "aborted";
      }
      const settled = await converge(this.journal, this.options, entry);
      return settled.phase === "released" ? "released" : "quarantined";
    } catch {
      /* 撞上并发推进（在飞 attachment 自己也在收口）：以账本为准再读一次。
         它已经不在可恢复集合里，就说明确实收敛了；否则只能说不清。 */
      return this.journal
        .listRecoverable()
        .some((item) => item.turnRequestId === turnRequestId)
        ? "quarantined"
        : "released";
    }
  }

  /** quarantine 里的 custody 仍持着能力上限；调用方据此拒绝 GC 与新签发。 */
  listQuarantined() {
    return this.journal.listQuarantined();
  }
}
