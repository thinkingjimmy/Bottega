/**
 * [INPUT]: Depends on the AppProcessCustodyJournal, custody kernel, and shared AppProcessCustodyEntry
 * [OUTPUT]: Provides AppServerCustodyRuntime: intent fsync → capability-free guardian → owned → activation-authorized → Delivery sealed code/data epoch → activated, and precise exit closure and start phase reconcile
 * [POS]: The server side custody drive for apps/runtime (D29); The turn drives are not identical to the backends, and the two accounts each have their own owner semantics
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import type { AppProcessCustodyEntry } from "../../../../shared/app-lifecycle";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import { GuardianControlChannel } from "../../custody/control-channel";
import {
  CustodyAttachment,
  converge,
  type CustodyLaunchRequest,
  type CustodyRuntimeOptions,
} from "../../custody/attachment";
import type { AppProcessCustodyJournal } from "../server/process-custody-journal";

export type AppServerCustodyHandle = {
  readonly custodyId: string;
  readonly activationId: string;
  /**
   * 同步交出 capability-free guardian；它的 0/1/2 就是 App binary 的 0/1/2。
   * sealed code root / data epoch / env 由内核扣在 main 手里，直到 durable
   * `activation-authorized` 落账后才经 authenticated channel 出门。
   */
  launch(request: CustodyLaunchRequest): ChildProcessWithoutNullStreams;
  /** activated ack 落账后 resolve；在此之前一个字节的能力都没有交付成功 */
  readonly delivered: Promise<void>;
  beginRelease(): Promise<void>;
  settle(): Promise<AppProcessCustodyEntry>;
  abort(): Promise<void>;
  readonly entry: AppProcessCustodyEntry;
};

export type AppServerCustodyReconcileReport = {
  released: AppProcessCustodyEntry[];
  aborted: AppProcessCustodyEntry[];
  /** 身份说不清或杀不掉：不发信号、不释放，该 App 保持 quarantine 并 fail closed */
  quarantined: AppProcessCustodyEntry[];
};

export type AppServerCustodyOptions = Omit<
  CustodyRuntimeOptions,
  "controlRoot" | "guardianArgs"
> & {
  controlRoot: string;
  guardianArgs: readonly string[];
};

export class AppServerCustodyRuntime {
  private readonly channel: GuardianControlChannel;
  private accepting = false;

  constructor(
    private readonly journal: AppProcessCustodyJournal,
    private readonly options: AppServerCustodyOptions
  ) {
    this.channel = new GuardianControlChannel(
      join(options.controlRoot, "guardian.sock")
    );
  }

  async initialize() {
    await this.journal.initialize();
    await this.channel.listen();
  }

  /** reconcile 完成前不开放：新代 binary 不能和未收敛的旧进程共写同一份数据。 */
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
   * intent 先落盘，然后才有资格 spawn。绑的是这一代的 contentDigest 与当前
   * dataEpochId：重启后光凭这条记录就能说清「那个进程当年被授权读写的是谁」。
   */
  async begin(input: {
    appId: string;
    generationId: string;
    contentDigest: Sha256Digest;
    lifecycleRevision: number;
    dataEpochId: string;
  }): Promise<AppServerCustodyHandle> {
    if (!this.accepting) throw new Error("App server custody 尚未开放准入");
    /* guardian entry 缺席时宁可当场失败：空 args 会让 spawn 出一个什么都不做
       的解释器，症状表现成「启动卡到预算耗尽」，与真正的握手失败无从区分。 */
    if (!this.options.guardianArgs.length) {
      throw new Error("App server guardian entry 未装配，拒绝 spawn");
    }
    const unsettled = this.journal.listUnsettled(input.appId);
    if (unsettled.length) {
      /* 旧 custody 未收敛就再 spawn 一条，等于让两个进程共写同一个 data epoch。
         这条拒绝正是「server 旧 custody 未退出时新代 binary spawn=0」。 */
      throw Object.assign(
        new Error(
          `APP_SERVER_CUSTODY_UNSETTLED: ${input.appId} 仍有 ${unsettled.length} 条未收敛的进程托管`
        ),
        { status: 409 }
      );
    }
    const attachment = new CustodyAttachment(
      this.journal,
      this.channel,
      this.options,
      await this.journal.createIntent(input)
    );
    return {
      custodyId: attachment.custodyId,
      activationId: attachment.entry.activationId,
      launch: (request) => attachment.launch(request),
      delivered: attachment.delivered,
      beginRelease: () => attachment.beginRelease(),
      settle: () => attachment.settle(),
      abort: () => attachment.abort("cancelled-before-owned"),
      get entry() {
        return attachment.entry;
      },
    };
  }

  /**
   * 启动逐 phase 收敛，必须跑在开放 App runtime/Gateway admission **之前**。
   *
   * 本产品重启后没有可靠接管路径：guardian 的控制通道随 main 一起消失，且它
   * 不重连——所以 `activation-authorized` 起一律按 may-have-capability 撤销
   * activation 并 kill+wait，identity 说不清就 quarantine 且**不发信号**。
   */
  async reconcile(): Promise<AppServerCustodyReconcileReport> {
    const report: AppServerCustodyReconcileReport = {
      released: [],
      aborted: [],
      quarantined: [],
    };
    for (const entry of this.journal.listRecoverable()) {
      if (entry.phase === "intent") {
        /* intent guardian 既无 code root 也无 data epoch，owner 也不可能还在跑：
           唯一诚实的收口是 durable abort，绝不为了「有个 PID 可杀」而编一个。 */
        report.aborted.push(
          await this.journal.abortBeforeOwned(
            entry.custodyId,
            entry.revision,
            "owner-no-longer-live"
          )
        );
        continue;
      }
      const settled = await converge(this.journal, this.options, entry);
      if (settled.phase === "released") report.released.push(settled);
      else report.quarantined.push(settled);
    }
    return report;
  }

  /** quarantine 的 App 必须保持 fail closed：不发 origin、不发 route、不起新代。 */
  quarantinedAppIds() {
    return new Set(this.journal.listQuarantined().map((entry) => entry.appId));
  }
}
