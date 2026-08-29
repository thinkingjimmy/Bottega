/**
 * [INPUT]: Depends only on injected admission/window-settlement/quiesce/close/recover/report ports; it never imports Electron
 * [OUTPUT]: Provides SafeQuitReason and SafeQuitCoordinator: a single-entry two-phase quit state machine that reclaims all renderer surfaces before owners close
 * [POS]: The startup quit-lane state machine; the composition root still owns which owners exist and in what order they close
 */

export type SafeQuitReason = "quit" | "update";

export type SafeQuitPorts = {
  /** 关准入：退出链里绝不能再产生新的 dispatch。可逆阶段与恢复失败各调一次。 */
  stopAdmission(): void;
  /** 可逆阶段：等待活动迁移并把 App 窗口的 surface/capsule 收回主窗。 */
  settleWindows(): Promise<void>;
  /** 可逆阶段：结算所有 Agent。失败后应用仍可以还给用户。 */
  quiesceAgents(): Promise<void>;
  /** 不可逆阶段：终态 owner 逐个关闭并落盘。开始之后没有回头路。 */
  closeOwners(): Promise<void>;
  /** 可逆阶段失败后的补偿；true 表示应用已回到可用状态。 */
  recover(reason: SafeQuitReason): Promise<boolean>;
  report(reason: SafeQuitReason, phase: "reversible" | "terminal", cause: unknown): void;
  notify(recovered: boolean): void;
  quit(): void;
};

/**
 * 退出与「下载完成后交接安装」走的是同一段收敛，差别只在结局：前者退出，
 * 后者把进程交给安装器。把它写成两条链必然漂移，而漂移的那一份会在崩溃
 * 之后才被发现——那时已经没有证据能说清 owner 到底关没关。
 *
 * 两阶段的分界是本类唯一要守住的事实：`quiesceAgents` 之前一切可逆，
 * `closeOwners` 一旦开始，恢复只会造出半开的 owner，因此那之后只允许
 * 退出、且绝不安装——下一次启动会重新跑所有 durable recovery。
 */
export class SafeQuitCoordinator {
  private requested = false;
  private settled = false;

  constructor(private readonly ports: SafeQuitPorts) {}

  /** true 表示 owner 已全部关闭落盘，调用方可以真正退出或交接安装。 */
  get finished() {
    return this.settled;
  }

  async prepare(reason: SafeQuitReason): Promise<boolean> {
    if (this.settled) return true;
    if (this.requested) return false;
    this.requested = true;
    this.ports.stopAdmission();
    try {
      await this.ports.settleWindows();
      await this.ports.quiesceAgents();
    } catch (cause) {
      this.requested = false;
      this.ports.report(reason, "reversible", cause);
      const recovered = await this.ports.recover(reason);
      if (!recovered) this.ports.stopAdmission();
      this.ports.notify(recovered);
      return false;
    }
    try {
      await this.ports.closeOwners();
      this.settled = true;
      return true;
    } catch (cause) {
      this.ports.report(reason, "terminal", cause);
      this.settled = true;
      this.ports.quit();
      return false;
    }
  }
}
