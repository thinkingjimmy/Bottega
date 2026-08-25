/**
 * [INPUT]: Depends on AgentTurnCustodyJournal, custody kernel, control channel / CustodyAttachment / converge) and backends / types of AgentProcessHost
 * [OUTPUT]: Provides AgentTurnCustodyRuntime: dependency Repeat → intent fsync → capability-free guardian → owned → activation-authorized → delivery → activated, and precise exit closure, restart phase reconcile with single-line turn `convergeTurn`
 * [POS]: The backends are the turn-side custody drive; The process mechanism is complete with the.../custody, and the document is only responsible for "access and restore the meaning of this book"
 */

import { join } from "node:path";
import type {
  AgentTurnCustodyDependency,
  AgentTurnCustodyEntry,
  AgentTurnCustodyOwner,
  ProcessCustodyAbortReason,
} from "../../../shared/app-lifecycle";
import { GuardianControlChannel } from "../custody/control-channel";
import {
  CustodyAttachment,
  converge,
  type CustodyRuntimeOptions,
} from "../custody/attachment";
import type { AgentTurnCustodyJournal } from "./agent-turn-custody-journal";
import type { AgentProcessHost } from "./types";

export type { CustodyRuntimeOptions };

/** 各产品域自己回答「这条 logical lease 现在还活着吗」；未注册的 kind 一律 fail closed。 */
export type CustodyDependencyProbe = (
  dependency: AgentTurnCustodyDependency
) => boolean | Promise<boolean>;

export type CustodyOwnerProbe = (
  owner: AgentTurnCustodyOwner
) => boolean | Promise<boolean>;

export type AgentTurnCustodyHandle = {
  readonly custodyId: string;
  readonly host: AgentProcessHost;
  /** durable「打算释放」；必须先于任何信号 */
  beginRelease(): Promise<void>;
  /** 用真实 process 证据收口：已退出 → released，说不清 → quarantined */
  settle(): Promise<AgentTurnCustodyEntry>;
  /** 只对尚未 spawn 的 intent 有效；不伪造 PID */
  abort(reason: ProcessCustodyAbortReason): Promise<void>;
};

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
  private readonly channel: GuardianControlChannel;
  private readonly probes = new Map<
    AgentTurnCustodyDependency["kind"],
    CustodyDependencyProbe
  >();
  private ownerProbe: CustodyOwnerProbe = () => true;
  private accepting = false;

  constructor(
    private readonly journal: AgentTurnCustodyJournal,
    private readonly options: CustodyRuntimeOptions
  ) {
    this.channel = new GuardianControlChannel(
      join(options.controlRoot, "guardian.sock")
    );
  }

  /**
   * 领域侧在组合根注册自己的 logical lease 探针。runtime 只认 kind，不认识
   * App/Extension 的任何账本类型——这是领域 runtime 不被 import 的前提下复用
   * 同一条 custody 的原因。
   */
  registerDependencyProbe(
    kind: AgentTurnCustodyDependency["kind"],
    probe: CustodyDependencyProbe
  ) {
    this.probes.set(kind, probe);
  }

  setOwnerProbe(probe: CustodyOwnerProbe) {
    this.ownerProbe = probe;
  }

  async initialize() {
    await this.journal.initialize();
    await this.channel.listen();
  }

  /** reconcile 完成前不开放；否则新 turn 会和未收敛的旧进程抢同一批能力。 */
  openAdmission() {
    this.accepting = true;
  }

  closeAdmission() {
    this.accepting = false;
  }

  async close() {
    this.closeAdmission();
    await this.channel.close();
  }

  /**
   * intent commit：原子重验 owner 未终结、每条 logical dependency 仍 active，
   * 然后才 fsync。这条检查就是「已 released 的 dependency，其晚到的 intent
   * 一律拒绝」——晚到者在这里被拒，而不是在交付能力之后才发现。
   */
  async begin(input: {
    turnRequestId: string;
    owner: AgentTurnCustodyOwner;
    backendRuntimeIdentity: string;
    dependencies: readonly AgentTurnCustodyDependency[];
  }): Promise<AgentTurnCustodyHandle> {
    if (!this.accepting) throw new Error("turn custody 尚未开放准入");
    await this.assertAdmissible(input.owner, input.dependencies);
    const attachment = new CustodyAttachment(
      this.journal,
      this.channel,
      this.options,
      await this.journal.createIntent(input)
    );
    return {
      custodyId: attachment.custodyId,
      host: {
        delivered: attachment.delivered,
        launch: (request) => attachment.launch(request),
      },
      beginRelease: () => attachment.beginRelease(),
      settle: () => attachment.settle(),
      abort: (reason) => attachment.abort(reason),
    };
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

  private async assertAdmissible(
    owner: AgentTurnCustodyOwner,
    dependencies: readonly AgentTurnCustodyDependency[]
  ) {
    if (!(await this.ownerProbe(owner))) {
      throw new Error("CUSTODY_OWNER_NOT_LIVE: turn owner 已终结");
    }
    for (const dependency of dependencies) {
      const probe = this.probes.get(dependency.kind);
      if (!probe) {
        throw new Error(
          `CUSTODY_DEPENDENCY_UNREGISTERED: ${dependency.kind} 无 probe，拒绝交付能力`
        );
      }
      if (!(await probe(dependency))) {
        throw new Error(
          `CUSTODY_DEPENDENCY_INACTIVE: ${dependency.kind} 已释放或失效`
        );
      }
    }
  }
}
