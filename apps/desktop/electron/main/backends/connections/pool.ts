/**
 * [INPUT]: Depends on the shared connection key derivation, the pool ports (enabled/open/ping) and AcpConnection liveness
 * [OUTPUT]: Provides AgentConnectionPool — warm/claim/release over warming→idle→busy→draining→closed, 5-minute idle expiry, 1-per-backend and 2-global LRU caps, backend invalidation, wake ping and two-phase shutdown
 * [POS]: The resident-connection lifecycle owner; it never spawns, never speaks ACP beyond a liveness ping, and never inspects a turn
 */

import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  agentConnectionKey,
  type AgentConnectionIdentity,
} from "../../agent/launch-plan";
import { asError } from "../../errors";
import type {
  AgentConnectionClaim,
  AgentConnectionOpener,
  AgentConnectionPoolPorts,
  AgentConnectionSnapshot,
  ClaimedAgentConnection,
  ResidentConnection,
} from "./types";

export const AGENT_CONNECTION_IDLE_MS = 5 * 60_000;
export const AGENT_CONNECTION_LIMITS = { perBackend: 1, global: 2 } as const;

type Phase = AgentConnectionSnapshot["phase"];

type Entry = {
  key: string;
  identity: AgentConnectionIdentity;
  phase: Phase;
  opening?: Promise<ResidentConnection>;
  resident?: ResidentConnection;
  idleSince: number;
  lastUsedAt: number;
  /** 收到关闭指令但 turn 在途：终态后按这个原因关。 */
  drainReason?: string;
};

const log = (backend: AgentBackendId, event: string) =>
  console.info(`[connections:${backend}] ${event}`);

export class AgentConnectionPool {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ports: AgentConnectionPoolPorts) {}

  private now() {
    return this.ports.now?.() ?? Date.now();
  }

  /**
   * 预热：只到 `initialize`。`session/load` 留给第一轮——为一条从未发送的
   * 草稿替换 CLI 侧的会话状态，代价由用户承担而收益是零（PRD §4.3）。
   */
  warm(identity: AgentConnectionIdentity, open: AgentConnectionOpener) {
    if (!this.ports.enabled()) return;
    const key = agentConnectionKey(identity);
    if (this.entries.has(key)) return;
    void this.open(key, identity, open).catch(() => undefined);
    log(identity.backend, "warm");
  }

  /**
   * 认领。命中即复用；未命中就地新建，让下一轮命中——两条路的墙钟代价与
   * 今天相同，差别只在这个进程会不会活过本轮。
   *
   * 任何失败都返回 undefined：调用方回到冷路径，用户至多感到一次冷启动。
   */
  async claim(
    input: AgentConnectionClaim
  ): Promise<ClaimedAgentConnection | undefined> {
    if (!this.ports.enabled()) {
      await this.closeIdle("disabled");
      return undefined;
    }
    const key = agentConnectionKey(input.identity);
    const existing = this.entries.get(key);
    if (existing && (existing.phase === "busy" || existing.phase === "draining")) {
      /* 一条连接同一时刻只承载一个 session/prompt（Kimi 对并发第二条直接
         回 -32600）；第二个认领者走冷路径，排队仍归 07-29 的机制。 */
      return undefined;
    }
    /* warming 期到来的 turn 等那一次握手，绝不抢先 open（PRD §4.2）：open 的
       第一步是 evictFor，它会把自己本该认领的那条当 LRU 关掉，然后再起第二
       个进程。 */
    const pending = existing?.resident ?? existing?.opening;
    let resident: ResidentConnection;
    try {
      resident = await (pending ?? this.open(key, input.identity, input.open));
    } catch {
      return undefined;
    }
    const entry = this.entries.get(key);
    if (!entry || entry.resident !== resident) return undefined;
    /* 等 warming 的不止一个：先到的那个已经把它变成 busy 了，后到的必须回冷
       路径，否则两轮会共用同一条 session/prompt。 */
    if (entry.phase === "busy" || entry.phase === "draining") return undefined;
    if (resident.connection.dead) {
      await this.close(entry, "dead");
      return undefined;
    }
    try {
      resident.builtinMcp?.rebind(input.turn);
    } catch (cause) {
      log(input.identity.backend, `claim-rejected(${asError(cause).message})`);
      await this.close(entry, "lease-rebind-failed");
      return undefined;
    }
    entry.phase = "busy";
    entry.lastUsedAt = this.now();
    /* 槽位让位而不是叠加：turn 自己的 interactive lease 顶上，总数恒为一。 */
    resident.resident.suspend();
    log(input.identity.backend, "claim");
    let released = false;
    return {
      connection: resident.connection,
      ...(resident.builtinMcp ? { builtinMcp: resident.builtinMcp } : {}),
      release: async (outcome = "reusable") => {
        if (released) return;
        released = true;
        await this.release(entry, outcome);
      },
    };
  }

  async invalidate(backend: AgentBackendId, reason = "invalidated") {
    for (const entry of [...this.entries.values()]) {
      if (entry.identity.backend === backend) await this.close(entry, reason);
    }
  }

  /** 休眠唤醒：只 ping 空闲连接；busy 的由 turn 自己的健康观察负责。 */
  async resume() {
    const ping = this.ports.ping;
    if (!ping) return;
    for (const entry of [...this.entries.values()]) {
      if (entry.phase !== "idle" || !entry.resident) continue;
      try {
        await ping(entry.resident.connection);
      } catch {
        await this.close(entry, "wake-ping-failed");
      }
    }
  }

  /** 闲置淘汰；开关关掉时同一趟把空闲连接收干净。 */
  async sweep() {
    if (!this.ports.enabled()) return this.closeIdle("disabled");
    const now = this.now();
    for (const entry of [...this.entries.values()]) {
      if (entry.phase !== "idle") continue;
      if (now - entry.idleSince >= AGENT_CONNECTION_IDLE_MS) {
        await this.close(entry, "idle-timeout");
      }
    }
  }

  /** 两阶段退出的第二阶段：turn 已停，剩下的连接一律收口。 */
  async shutdown() {
    for (const entry of [...this.entries.values()]) {
      await this.close(entry, "shutdown");
    }
  }

  snapshot(): AgentConnectionSnapshot[] {
    return [...this.entries.values()].map((entry) => ({
      backend: entry.identity.backend,
      phase: entry.phase,
      pid: entry.resident?.connection.pid,
      idleSince: entry.idleSince,
    }));
  }

  private async open(
    key: string,
    identity: AgentConnectionIdentity,
    opener: AgentConnectionOpener
  ) {
    await this.evictFor(identity.backend);
    const now = this.now();
    const entry: Entry = {
      key,
      identity,
      phase: "warming",
      idleSince: now,
      lastUsedAt: now,
    };
    this.entries.set(key, entry);
    /* warming 期到来的 turn 等它，而不是另起一个进程（PRD §4.2）。 */
    const opening = opener();
    entry.opening = opening;
    try {
      const resident = await opening;
      if (this.entries.get(key) !== entry) {
        await resident.close("superseded");
        throw new Error("连接在握手期间已被取代");
      }
      entry.resident = resident;
      entry.opening = undefined;
      entry.phase = "idle";
      entry.idleSince = this.now();
      return resident;
    } catch (cause) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      /* 失败必须留痕：预热与认领都吞掉这个异常，没有这一行就只剩"warm 了
         但没进程"的谜面。 */
      log(identity.backend, `open-failed(${asError(cause).message})`);
      throw cause;
    }
  }

  private async release(entry: Entry, outcome: "reusable" | "dead") {
    const resident = entry.resident;
    if (!resident) return;
    /* 解绑先于一切：它要等上一轮的工具调用排空，排不空就撤 lease。 */
    await resident.builtinMcp?.unbind();
    /* 本轮已结算，`busy` 到此为止——留着它会让随后的关闭退化成再一次
       draining，于是"判死的连接"反而留在池里等一个永不到来的终态。 */
    if (entry.phase === "busy") entry.phase = "idle";
    const dead = outcome === "dead" || resident.connection.dead;
    if (dead || entry.drainReason || !this.ports.enabled()) {
      await this.close(entry, entry.drainReason ?? (dead ? "dead" : "disabled"));
      return;
    }
    if (!(await resident.resident.resume())) {
      /* 槽位要不回来就不留进程：无账可查的常驻进程比冷启动更贵。 */
      await this.close(entry, "no-slot");
      return;
    }
    entry.phase = "idle";
    entry.idleSince = this.now();
    entry.lastUsedAt = entry.idleSince;
    log(entry.identity.backend, "release");
  }

  private async close(entry: Entry, reason: string) {
    if (entry.phase === "busy") {
      /* 用户 Stop 只取消 turn，不关连接；这里关的是"turn 结束后就走"。 */
      entry.phase = "draining";
      entry.drainReason = reason;
      return;
    }
    if (entry.phase === "closed") return;
    entry.phase = "closed";
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    const resident = entry.resident ?? (await entry.opening?.catch(() => undefined));
    await resident?.close(reason);
    log(entry.identity.backend, `close(${reason})`);
  }

  private async closeIdle(reason: string) {
    for (const entry of [...this.entries.values()]) {
      if (entry.phase === "idle" || entry.phase === "warming") {
        await this.close(entry, reason);
      }
    }
  }

  /** 每后端 1 条、全局 2 条；超出即淘汰最久未用的空闲连接。 */
  private async evictFor(backend: AgentBackendId) {
    const byBackend = [...this.entries.values()].filter(
      (entry) => entry.identity.backend === backend
    );
    for (const entry of oldestFirst(byBackend).slice(
      0,
      Math.max(0, byBackend.length - AGENT_CONNECTION_LIMITS.perBackend + 1)
    )) {
      await this.close(entry, "lru");
    }
    const all = [...this.entries.values()];
    for (const entry of oldestFirst(all).slice(
      0,
      Math.max(0, all.length - AGENT_CONNECTION_LIMITS.global + 1)
    )) {
      await this.close(entry, "lru");
    }
  }
}

/** busy/draining 永不被淘汰：它们身上挂着一个还没结算的 turn。 */
function oldestFirst(entries: Entry[]) {
  return entries
    .filter((entry) => entry.phase === "idle" || entry.phase === "warming")
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
}
