/**
 * [INPUT]: Depends on node:child_process spawn, custody control-channel/protocol/identity-probe, and process-group cleanup, all keyed by shared ProcessIdentity
 * [OUTPUT]: Provides CustodyAttachment, the per-attempt guardian spawn/handshake/activation/release state machine, and converge, the sole release-outcome arbiter based on real process evidence TASK-35: the guardian's command is options.guardian() (the bundled Node); an unusable runtime fails the launch before any spawn, and the guardian env carries no run-as-Node variable. converge verifies the full recorded group even after guardian exit and never releases on an unverified birth read: it quarantines without signalling.
 * [POS]: Custody's journal-agnostic runtime leaf; Agent turn and the App server each keep their own ledger but share this single "when to deliver, when to release" state machine
 */

import { assertRecoveredAuthority } from "../persistence/recovery-policy";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import type { ProcessIdentity } from "../../../shared/apps/model/app-lifecycle";
import { asError } from "../ipc/errors";
import { cleanProcessGroup, cleanOwnedProcessGroup, groupExists, type CleanupResult } from "../agent/process/process-group";
import { GuardianControlChannel, type GuardianLink } from "./control-channel";
import { observeProcessBirth, observeProcessGroup, type BirthObservation, type ProcessBirth } from "./identity";
import { CUSTODY_ENV } from "./protocol";

/** 两本账共用的封闭相位集；`quarantined` 是未收敛而非终态。 */
type CustodyPhase =
  | "intent"
  | "aborted"
  | "owned"
  | "activation-authorized"
  | "activated"
  | "release-pending"
  | "released"
  | "quarantined";

/** 内核只认这几格；appId/turnRequestId 之类归各自账本，内核一律不看。 */
type CustodyRecord = Readonly<{
  custodyId: string;
  controlNonce: string;
  phase: CustodyPhase;
  revision: number;
  processIdentity?: ProcessIdentity;
  descendantIdentities?: Array<Pick<ProcessIdentity, "pid" | "processGroupId" | "birthIdentity">>;
}>;

type CustodyAbortReason =
  | "cancelled-before-owned"
  | "guardian-spawn-failed"
  | "owner-no-longer-live";

type CustodyQuarantineReason =
  | "process-identity-unconfirmed"
  | "process-survived-kill";

/**
 * 账本对内核暴露的最小写面。每个方法都带 expected revision——内核从不「读改写」，
 * 它只按自己手上那一版推进，撞上晚到命令时由账本抛错。
 */
type CustodyJournalPort<E extends CustodyRecord> = {
  diagnose?(custodyId: string, revision: number, fact: { code: string; stage: string; elapsedMs: number; probe: string }): Promise<E>;
  recordDescendants?(custodyId: string, revision: number, members: Array<Pick<ProcessIdentity, "pid" | "processGroupId" | "birthIdentity">>): Promise<E>;
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

type SpawnGuardian = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type CustodyRuntimeOptions = {
  /** socket 与 guardian cwd 的落点；本身不是任何 capability 根 */
  controlRoot: string;
  /** The guardian's command, resolved at each launch: the product's is the runtime port's bundledGuardian (TASK-35). */
  guardian: () => { command: string; args: readonly string[] };
  spawnGuardian?: SpawnGuardian;
  /** What one read proves about a PID: only `absent` counts as ended; `unverified` releases nothing and signals nothing. */
  observeBirth?: (pid: number) => BirthObservation;
  stopGroup?: (pid: number) => Promise<CleanupResult>;
  groupExists?: (pid: number) => boolean;
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
    assertRecoveredAuthority();
    if (this.guardian) throw new Error("同一 custody 不能启动两次 guardian");
    this.launchRequest = request;
    /* No usable runtime: the launch fails here, before any spawn, and the intent settles aborted; nothing falls back. */
    let guardian: { command: string; args: readonly string[] };
    try { guardian = this.options.guardian(); } catch (cause) { this.fail(asError(cause)); throw cause; }
    const spawnGuardian = this.options.spawnGuardian ?? spawn;
    const child = spawnGuardian(
      guardian.command,
      [...guardian.args],
      {
        /* The profile identity held recovery reads (startup/recovery/processes.ts): keep the control root as the guardian's cwd. */
        cwd: this.options.controlRoot,
        detached: true,
        env: {
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

  async recordDescendants() {
    const identity = this.current.processIdentity;
    if (!identity || !this.journal.recordDescendants) throw new Error("Custody descendant recording is unavailable");
    const before = observeProcessBirth(identity.pid), members = observeProcessGroup(identity.processGroupId), after = observeProcessBirth(identity.pid);
    if (before.state !== "present" || after.state !== "present" || !sameProcess(before, identity) || !sameProcess(after, identity) || !members || !members.some(row => row.pid === identity.pid && sameProcess(row, identity))) throw new Error("Custody descendant identity is unconfirmed");
    this.current = await this.journal.recordDescendants(this.current.custodyId, this.current.revision, members.filter(row => row.pid !== identity.pid));
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
 * Release requires a confirmed absent group or birth-verified continuous custody.
 * An absent guardian and a live numeric PGID alone cannot prove ownership across restarts.
 * A recorded live descendant must still match its birth and group before any leaderless cleanup.
 * Missing, stale or unverified witness facts quarantine the entry without signalling.
 */
export async function converge<E extends CustodyRecord>(
  journal: CustodyJournalPort<E>,
  options: CustodyRuntimeOptions,
  input: E
) {
  let entry = input;
  const started = Date.now(), deadline = started + 20_000;
  const quarantine = async (code: string, stage: string, probe: string, reason: CustodyQuarantineReason = "process-identity-unconfirmed") => {
    const fact = { code, stage, elapsedMs: Date.now() - started, probe };
    console.warn("[custody] verification incomplete", { custodyId: entry.custodyId, identity: entry.processIdentity && { pid: entry.processIdentity.pid, pgid: entry.processIdentity.processGroupId, birth: entry.processIdentity.birthIdentity }, ...fact });
    if (journal.diagnose) entry = await journal.diagnose(entry.custodyId, entry.revision, fact);
    return journal.quarantine(entry.custodyId, entry.revision, reason);
  };
  const identity = entry.processIdentity;
  if (!identity) throw new Error("owned 之后的 custody 必然有 process identity");
  if (entry.phase !== "release-pending") {
    entry = await journal.beginRelease(entry.custodyId, entry.revision);
  }
  const probe = options.observeBirth ?? ((pid: number) => observeProcessBirth(pid, undefined, deadline - Date.now()));
  const observe = (pid: number): BirthObservation => Date.now() >= deadline ? { state: "unverified" } : probe(pid);
  const before = observe(identity.pid);
  /* A read that proved nothing (ps failed or timed out) is not an exit: keep the entry, signal nothing, try again next start. */
  if (before.state === "unverified") {
    return quarantine("PROBE_BEFORE_UNKNOWN", "before", before.state);
  }
  const exists = (pid: number) => Date.now() >= deadline || (options.groupExists ?? ((group: number) => groupExists(group, deadline)))(pid);
  const witnessedMember = () => (entry.descendantIdentities ?? []).some(member => {
    const current = observe(member.pid);
    return member.pid !== identity.pid && member.processGroupId === identity.processGroupId && current.state === "present" && sameProcess(current, member);
  });
  const stop = options.stopGroup ?? ((pid: number) => cleanProcessGroup(pid, () => {
    const current = observe(identity.pid);
    return Date.now() < deadline && (current.state === "present" ? sameProcess(current, identity) : current.state === "absent" && witnessedMember());
  }, deadline));
  if (before.state === "absent") {
    if (!exists(identity.processGroupId)) return journal.release(entry.custodyId, entry.revision);
    const witnessed = () => (entry.descendantIdentities ?? []).some(member => {
      const current = observe(member.pid);
      return member.pid !== identity.pid && member.processGroupId === identity.processGroupId && current.state === "present" && sameProcess(current, member);
    });
    if (!witnessed()) return quarantine("DESCENDANT_WITNESS_MISSING", "witness", before.state);
    const guardedProbe = (pid: number): BirthObservation => {
      const current = observe(pid);
      return current.state === "absent" && !witnessed() ? { state: "unverified" } : current;
    };
    const result = await cleanOwnedProcessGroup({ pid: identity.processGroupId, birthIdentity: identity.birthIdentity }, guardedProbe, stop, exists);
    if (!exists(identity.processGroupId)) return journal.release(entry.custodyId, entry.revision);
    return quarantine(result.verdict === "unverified" ? "SIGNAL_IDENTITY_UNKNOWN" : "GROUP_STILL_PRESENT", "stop", result.verdict,
      result.verdict === "unverified" ? "process-identity-unconfirmed" : "process-survived-kill");
  }
  if (!sameProcess(before, identity)) {
    return quarantine("PROCESS_IDENTITY_MISMATCH", "identity", before.state);
  }
  const result = await stop(identity.processGroupId);
  const after = observe(identity.pid);
  /* A changed leader alone does not prove its original process group has ended. */
  if (after.state === "unverified") {
    return quarantine("PROBE_AFTER_UNKNOWN", "after", after.state);
  }
  if ((after.state === "present" && !sameProcess(after, identity) || after.state === "absent") && !exists(identity.processGroupId)) {
    return journal.release(entry.custodyId, entry.revision);
  }
  const unconfirmed = !result.ok && (result.error as NodeJS.ErrnoException).code === "PROCESS_IDENTITY_UNCONFIRMED";
  return quarantine(unconfirmed ? "SIGNAL_IDENTITY_UNKNOWN" : "GROUP_STILL_PRESENT", "stop", after.state,
    unconfirmed ? "process-identity-unconfirmed" : "process-survived-kill");
}

function sameProcess(birth: ProcessBirth, identity: Pick<ProcessIdentity, "processGroupId" | "birthIdentity">) {
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
