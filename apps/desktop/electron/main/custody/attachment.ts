/**
 * [INPUT]: Depends on node: child_process, custody Control pathway/protocol/identity probe, process-group Cleaning with shared ProcessIdentity
 * [OUTPUT]: Provides CustodyJournalPort, CustodyAttachment and converge a process hosted by a phase drive with the only crossover determinant
 * [POS]: The journal of custody is not related to the core; Agent turn and the App server write each account but share this "When to Deliver, When to Release"
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import type { ProcessIdentity } from "../../../shared/app-lifecycle";
import { asError } from "../errors";
import { cleanProcessGroup, type CleanupResult } from "../process-group";
import { GuardianControlChannel, type GuardianLink } from "./control-channel";
import { probeProcessBirth, type ProcessBirth } from "./identity";
import { CUSTODY_ENV } from "./protocol";

/** 两本账共用的封闭相位集；`quarantined` 是未收敛而非终态。 */
export type CustodyPhase =
  | "intent"
  | "aborted"
  | "owned"
  | "activation-authorized"
  | "activated"
  | "release-pending"
  | "released"
  | "quarantined";

/** 内核只认这几格；appId/turnRequestId 之类归各自账本，内核一律不看。 */
export type CustodyRecord = Readonly<{
  custodyId: string;
  controlNonce: string;
  phase: CustodyPhase;
  revision: number;
  processIdentity?: ProcessIdentity;
}>;

export type CustodyAbortReason =
  | "cancelled-before-owned"
  | "guardian-spawn-failed"
  | "owner-no-longer-live";

export type CustodyQuarantineReason =
  | "process-identity-unconfirmed"
  | "process-survived-kill";

/**
 * 账本对内核暴露的最小写面。每个方法都带 expected revision——内核从不「读改写」，
 * 它只按自己手上那一版推进，撞上晚到命令时由账本抛错。
 */
export type CustodyJournalPort<E extends CustodyRecord> = {
  markOwned(custodyId: string, revision: number, identity: ProcessIdentity): Promise<E>;
  authorizeActivation(custodyId: string, revision: number): Promise<E>;
  markActivated(custodyId: string, revision: number): Promise<E>;
  beginRelease(custodyId: string, revision: number): Promise<E>;
  release(custodyId: string, revision: number): Promise<E>;
  abortBeforeOwned(
    custodyId: string,
    revision: number,
    reason: CustodyAbortReason
  ): Promise<E>;
  quarantine(
    custodyId: string,
    revision: number,
    reason: CustodyQuarantineReason
  ): Promise<E>;
};

export type CustodyLaunchRequest = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type SpawnGuardian = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type CustodyRuntimeOptions = {
  /** socket 与 guardian cwd 的落点；本身不是任何 capability 根 */
  controlRoot: string;
  /** 产品是 `[out/main/custody-guardian-entry.js]`；测试可前置 loader 参数 */
  guardianArgs: readonly string[];
  executable?: string;
  spawnGuardian?: SpawnGuardian;
  probeBirth?: (pid: number) => ProcessBirth | null;
  stopGroup?: (pid: number) => Promise<CleanupResult>;
  /** guardian 从 spawn 到 activated ack 的总预算 */
  handshakeTimeoutMs?: number;
};

const HANDSHAKE_TIMEOUT_MS = 10_000;

/** 已有 process identity、尚未收口：这些相位才谈得上「打算释放」。 */
const RELEASABLE: readonly CustodyPhase[] = [
  "owned",
  "activation-authorized",
  "activated",
  "quarantined",
];

/**
 * 一条 attempt 的进程托管。它持有全部易变状态，于是每个方法都只回答一件事；
 * 各家 runtime 那边只剩「准入、造它、逐条 reconcile」。
 */
export class CustodyAttachment<E extends CustodyRecord> {
  /** 同步交出宿主进程；它的 0/1/2 就是真正 backend 的 0/1/2 */
  readonly delivered: Promise<void>;
  private readonly link: GuardianLink;
  private resolveDelivered!: () => void;
  private rejectDelivered!: (cause: Error) => void;
  private guardian?: ChildProcessWithoutNullStreams;
  private launchRequest?: CustodyLaunchRequest;
  private timer?: NodeJS.Timeout;
  private authorized = false;
  private failed = false;

  constructor(
    private readonly journal: CustodyJournalPort<E>,
    channel: GuardianControlChannel,
    private readonly options: CustodyRuntimeOptions,
    private current: E
  ) {
    this.delivered = new Promise<void>((resolve, reject) => {
      this.resolveDelivered = resolve;
      this.rejectDelivered = reject;
    });
    /* 交付链自己就是一条结算路径；start() 侧的分步预算只看得见 guardian 退出，
       说不出「握手压根没来」这件事。没人 await 时也不能变成 unhandledRejection。 */
    this.delivered.catch(() => undefined);
    this.link = channel.register(current.controlNonce, {
      onHello: (identity) =>
        void this.handshake(identity).catch((cause) => this.fail(asError(cause))),
      onActivated: () => void this.confirmActivated(),
      onFailed: (reason) => this.fail(new Error(`guardian 交付失败：${reason}`)),
      onDisconnected: () => {
        /* 控制面失联不是死亡证据：guardian 还在，backend 可能正持着能力。
           交付前失联才是确定的失败。 */
        if (!this.authorized) this.fail(new Error("guardian 在交付前失联"));
      },
    });
  }

  get entry() {
    return this.current;
  }

  get custodyId() {
    return this.current.custodyId;
  }

  /**
   * capability-free spawn：env 只有控制通道三件套 + 一条最小 PATH（身份探针要
   * 调 `ps`）。workspace cwd、读写根、data epoch、backend env 与围栏都不在这里，
   * 它们要等 durable `activation-authorized` 之后才经控制通道出门。
   */
  launch(request: CustodyLaunchRequest) {
    if (this.guardian) throw new Error("同一 custody 不能启动两次 guardian");
    this.launchRequest = request;
    const spawnGuardian = this.options.spawnGuardian ?? spawn;
    const child = spawnGuardian(
      this.options.executable ?? process.execPath,
      [...this.options.guardianArgs],
      {
        cwd: this.options.controlRoot,
        detached: true,
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          PATH: "/usr/bin:/bin",
          [CUSTODY_ENV.socket]: this.link.socketPath,
          [CUSTODY_ENV.token]: this.link.token,
          [CUSTODY_ENV.nonce]: this.current.controlNonce,
        },
      }
    );
    this.guardian = child;
    child.once("error", (cause) => this.fail(asError(cause)));
    child.once("exit", (code, signal) => {
      if (this.authorized) return;
      this.fail(
        new Error(
          `guardian 未完成交付即退出（code ${code ?? "?"} signal ${signal ?? "?"}）`
        )
      );
    });
    const budget = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.timer = setTimeout(
      () =>
        this.fail(
          new Error(
            `guardian 未在 ${Math.round(budget / 1000)}s 内完成身份回报与交付确认`
          )
        ),
      budget
    );
    this.timer.unref?.();
    return child;
  }

  /** durable「打算释放」；必须先于任何信号。 */
  async beginRelease() {
    clearTimeout(this.timer);
    if (!RELEASABLE.includes(this.current.phase)) return;
    this.current = await this.journal.beginRelease(
      this.current.custodyId,
      this.current.revision
    );
  }

  /** 用真实 process 证据收口：已退出 → released，说不清 → quarantined。 */
  async settle() {
    clearTimeout(this.timer);
    this.link.dispose();
    if (this.current.phase === "intent") {
      this.current = await this.journal.abortBeforeOwned(
        this.current.custodyId,
        this.current.revision,
        "cancelled-before-owned"
      );
    } else if (
      this.current.phase !== "aborted" &&
      this.current.phase !== "released"
    ) {
      this.current = await converge(this.journal, this.options, this.current);
    }
    return this.current;
  }

  /** 只对尚未 spawn 的 intent 有效；不伪造 PID。 */
  async abort(reason: CustodyAbortReason) {
    clearTimeout(this.timer);
    this.link.dispose();
    if (this.current.phase !== "intent") return;
    this.current = await this.journal.abortBeforeOwned(
      this.current.custodyId,
      this.current.revision,
      reason
    );
  }

  private async handshake(identity: ProcessIdentity) {
    this.current = await this.journal.markOwned(
      this.current.custodyId,
      this.current.revision,
      identity
    );
    /* durable「已授权交付」必须先于 capability 真的出门。少了这一笔，
       owned→activated 之间崩溃就分不清 child 到底有没有拿到写权。 */
    this.current = await this.journal.authorizeActivation(
      this.current.custodyId,
      this.current.revision
    );
    this.authorized = true;
    const request = this.launchRequest!;
    this.link.activate({
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      env: definedEnv(request.env),
    });
  }

  private async confirmActivated() {
    try {
      this.current = await this.journal.markActivated(
        this.current.custodyId,
        this.current.revision
      );
      clearTimeout(this.timer);
      this.resolveDelivered();
    } catch (cause) {
      this.fail(asError(cause));
    }
  }

  /* 先 durable 收口，再对上游报失败：反过来的话，start() 已经在走失败路径，
     而账本可能还停在 intent——那正是「崩溃窗口」被人为制造出来的样子。 */
  private fail(cause: Error) {
    if (this.failed) return;
    this.failed = true;
    clearTimeout(this.timer);
    void this.closeOut()
      .catch((nested) =>
        console.warn("[custody] 失败收口异常", asError(nested).message)
      )
      .finally(() => this.rejectDelivered(cause));
  }

  private async closeOut() {
    if (this.current.phase === "intent") {
      this.current = await this.journal.abortBeforeOwned(
        this.current.custodyId,
        this.current.revision,
        "guardian-spawn-failed"
      );
      /* guardian 是我们的直接子进程，pid 是 spawn 的返回值而不是账本里编出来
         的身份——按它收尸不违反「不伪造 PID」。 */
      this.guardian?.kill("SIGKILL");
      this.link.dispose();
    } else if (!this.authorized) {
      // owned 已落账但 capability 尚未出门：让 guardian 自己下线是安全的。
      this.link.standDown();
    }
    /* authorized 之后什么都不做：backend 可能已持能力，唯一合法的收口是
       finalizer 用精确进程组退出证据走 settle()。 */
  }
}

/**
 * 唯一的收口判据，settle 与 reconcile 共用。三种结论互斥且都基于真实证据：
 * - 探不到该 PID → 进程确已消失 → released
 * - 探到但 birth/pgid 与账本不符 → PID 被复用 → **绝不发信号** → quarantine
 * - 探到且相符 → 还活着 → kill 进程组 → 再探；仍在 → quarantine
 */
export async function converge<E extends CustodyRecord>(
  journal: CustodyJournalPort<E>,
  options: CustodyRuntimeOptions,
  input: E
) {
  let entry = input;
  const identity = entry.processIdentity;
  if (!identity) throw new Error("owned 之后的 custody 必然有 process identity");
  if (entry.phase !== "release-pending") {
    entry = await journal.beginRelease(entry.custodyId, entry.revision);
  }
  const probe = options.probeBirth ?? probeProcessBirth;
  const before = probe(identity.pid);
  if (!before) return journal.release(entry.custodyId, entry.revision);
  if (!sameProcess(before, identity)) {
    return journal.quarantine(
      entry.custodyId,
      entry.revision,
      "process-identity-unconfirmed"
    );
  }
  const stop = options.stopGroup ?? cleanProcessGroup;
  const result = await stop(identity.processGroupId);
  const after = probe(identity.pid);
  /* 身份变了也算释放：那个 PID 已经不是我们的进程了，与彻底消失等价。 */
  if (!after || !sameProcess(after, identity)) {
    return journal.release(entry.custodyId, entry.revision);
  }
  if (!result.ok) console.warn("[custody] 进程组清理失败", result.error.message);
  return journal.quarantine(
    entry.custodyId,
    entry.revision,
    "process-survived-kill"
  );
}

function sameProcess(birth: ProcessBirth, identity: ProcessIdentity) {
  return (
    birth.processGroupId === identity.processGroupId &&
    birth.birthIdentity === identity.birthIdentity
  );
}

function definedEnv(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as const] : []
    )
  );
}
