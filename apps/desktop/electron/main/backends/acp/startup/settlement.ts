/**
 * [INPUT]: Depends on AgentTurn StartOutcome and Promise settlement synonyms
 * [OUTPUT]: Provides AcpTurnSettlement, exclusive start/transport deferred with active→requested→terminal|Stop status migration
 * [POS]: The ACP startup is the sole end-user; AcpTurn is responsible for protocol actions and no longer accompanies the maintenance of the stopped/terminal/startRequested Bul group
 */

import type { StartOutcome } from "../../types";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type SettlementPhase =
  | "active"
  | "terminal-requested"
  | "terminal"
  | "stopped";

export class AcpTurnSettlement {
  private readonly started = deferred<StartOutcome>();
  private readonly transport = deferred<void>();
  private phase: SettlementPhase = "active";
  private startRequested = false;

  constructor() {
    /* child 可在 start() 前失败；安全观察者只阻止 unhandled，绝不改变
       原 promise 的 rejected 状态，之后的 start() 仍拿到同一原因。 */
    void this.started.promise.catch(() => undefined);
  }

  get active() {
    return this.phase === "active";
  }

  get stopped() {
    return this.phase === "stopped";
  }

  beginStart() {
    if (this.stopped) throw new Error("ACP turn 已停止");
    if (this.startRequested) throw new Error("ACP turn 已启动");
    this.startRequested = true;
    /* constructor 期间 child 已失败时，终态管线正在/已经拒绝 started。
       调用方只需等待那份原 promise，绝不能重搭第二条 ACP transport。 */
    return this.active;
  }

  waitForStart() {
    return this.started.promise;
  }

  resolveStart(outcome: StartOutcome) {
    this.started.resolve(outcome);
  }

  rejectStart(cause: unknown) {
    this.started.reject(cause);
  }

  waitForTransport() {
    return this.transport.promise;
  }

  completeTransport() {
    this.transport.resolve();
  }

  requestTerminal() {
    if (!this.active) return false;
    this.phase = "terminal-requested";
    return true;
  }

  claimTerminal() {
    if (this.phase !== "terminal-requested") return false;
    this.phase = "terminal";
    return true;
  }

  stop() {
    if (this.stopped) return false;
    this.phase = "stopped";
    if (this.startRequested) {
      this.started.reject(new Error("ACP turn 已停止"));
    }
    return true;
  }
}
