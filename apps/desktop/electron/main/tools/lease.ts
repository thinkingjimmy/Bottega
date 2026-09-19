/**
 * [INPUT]: Depends on Node crypto, shared builtin-tool registry, per-turn server/socket path, and optional frozen Skills custody, and statusError from main/errors
 * [OUTPUT]: Provides incarnation-bound BuiltinMcpLease (per turn or per connection), launcher/budgets, ready/revoke signals, `(token, domainId)` rate control, per-turn rebind/unbind with invocation drain, and custody release after invocation drain
 * [POS]: Tool-platform authorization core; subprocesses hold only random tokens, while main holds the live lease and turn custody
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  BUILTIN_MCP_READY_TIMEOUT_MS,
  BUILTIN_WIRE_BYTE_LIMITS,
  BUILTIN_TOOL_DOMAINS,
  assertUnixSocketPath,
  builtinToolSpec,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { statusError } from "../errors";

export type BuiltinMcpServerSpec = {
  name: "ai-chat-tools";
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type BuiltinMcpLease = {
  leaseId: string;
  chatId: string;
  incarnationId: string;
  requestId: string;
  generation: number;
  allowedTools: BuiltinToolName[];
  initiatorBackend: AgentBackendId;
  /** References the resource-owning Skills turn custody; the lease owns no Skill bytes or Registry refs. */
  skillsCustodyId?: string;
  historyBinding?: import("../../../shared/chat-agent/history").HistoryBinding;
  /** 发起方 CLI 的 MCP client 对最终 CallToolResult 的可见上限。 */
  resultByteBudget: number;
  socketToken: string;
  signal: AbortSignal;
  state: "issued" | "ready" | "revoked";
  /**
   * 连接级 lease 在两轮之间置位：那时没有任何 turn 对工具调用负责，
   * authorize/consume 必须拒绝。缺席即"有 turn 在担责"——逐轮 lease 恒缺席。
   */
  unbound?: boolean;
};

/**
 * 连接级 lease 的所有者视图。
 *
 * 广告面（`allowedTools`、`resultByteBudget`、socket、token）在 spec env 里，
 * 子进程启动时就交给 CLI 了 —— 它们只能随连接走，逐轮改动必须换连接（连接键
 * 里带它们的摘要）。可执行面（requestId/generation/custody/history）不进 env，
 * 所以逐轮 rebind。
 */
export type ConnectionBuiltinMcp = IssuedBuiltinMcp & {
  rebind(turn: BuiltinMcpTurnBinding): void;
  unbind(): Promise<void>;
  /** 交给 turn 的那一面：它的 `revoke()` 只解绑本轮，不撤销连接的 lease。 */
  turnView(): IssuedBuiltinMcp;
};

export type BuiltinMcpTurnBinding = {
  requestId: string;
  generation: number;
  skillsCustodyId?: string;
  historyBinding?: import("../../../shared/chat-agent/history").HistoryBinding;
};

type Waiter = {
  resolve(): void;
  reject(cause: Error): void;
};

export type IssuedBuiltinMcp = {
  server: BuiltinMcpServerSpec;
  lease: BuiltinMcpLease;
  waitReady(signal: AbortSignal): Promise<void>;
  revoke(): void;
};

/** 解绑前等待上一轮在途调用排空的上限；超时即按失败收口，不让下一轮继承。 */
export const BUILTIN_MCP_DRAIN_TIMEOUT_MS = 10_000;

function abortError() {
  return new DOMException("内置 MCP 启动已取消", "AbortError");
}

/**
 * 按签发 lease 的后端推导 result 字节预算：kimi CLI 在 ~100KB 处截断 MCP
 * 工具结果（DEV/agents/docs/agent-cli-docs.md 真机实测），取 80KB 留余量；codex/claude
 * 无发起方上限，维持 domain 逻辑预算。
 */
export function initiatorResultByteBudget(
  backend: AgentBackendId
): number {
  return BUILTIN_WIRE_BYTE_LIMITS[backend];
}

export class BuiltinMcpLeaseStore {
  private readonly byToken = new Map<string, BuiltinMcpLease>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly calls = new Map<string, number[]>();
  /** 在途调用计数；解绑必须等它归零，否则上一轮的工具调用会落到下一轮账上。 */
  private readonly inFlight = new Map<string, number>();
  private readonly drains = new Map<string, Set<() => void>>();

  constructor(
    private readonly socketPath: string,
    private readonly serverEntry: string,
    private readonly executable = process.execPath,
    private readonly readyTimeoutMs = BUILTIN_MCP_READY_TIMEOUT_MS
  ) {
    /* 超长路径的 listen() 报的是 EINVAL 之类跟「太长」毫无字面关系的错，
       而这条链上的表征是「turn 卡在 builtin-mcp 直到超时」。在建任何
       socket 之前就点破，别让它以启动超时的形态出现在用户面前。 */
    assertUnixSocketPath(socketPath);
  }

  issue(input: {
    chatId: string;
    incarnationId: string;
    requestId: string;
    generation: number;
    allowedTools: BuiltinToolName[];
    initiatorBackend: AgentBackendId;
    resultByteBudget?: number;
    skillsCustodyId?: string;
  historyBinding?: import("../../../shared/chat-agent/history").HistoryBinding;
  }): IssuedBuiltinMcp {
    const socketToken = randomBytes(32).toString("hex");
    const allowedTools = [...new Set(input.allowedTools)].filter((name) =>
      Boolean(builtinToolSpec(name))
    );
    const revokeController = new AbortController();
    const lease: BuiltinMcpLease = {
      leaseId: randomUUID(),
      ...input,
      resultByteBudget:
        input.resultByteBudget ??
        initiatorResultByteBudget(input.initiatorBackend),
      allowedTools,
      socketToken,
      signal: revokeController.signal,
      state: "issued",
    };
    this.byToken.set(socketToken, lease);
    this.controllers.set(lease.leaseId, revokeController);
    return {
      lease,
      server: {
        name: "ai-chat-tools",
        command: this.executable,
        args: [this.serverEntry],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          AI_CHAT_TOOLS_SOCKET: this.socketPath,
          AI_CHAT_TOOLS_TOKEN: socketToken,
          AI_CHAT_TOOLS_ALLOWED: allowedTools.join(","),
          AI_CHAT_TOOLS_WIRE_CAP: String(lease.resultByteBudget),
        },
      },
      waitReady: (signal) => this.waitReady(lease, signal),
      revoke: () => this.revoke(lease),
    };
  }

  /**
   * 连接级签发：token 与广告面随连接一生不变，逐轮只 rebind 可执行面。
   *
   * 这里没有 requestId/generation —— 连接刚建立时还没有任何 turn，谎报一个
   * 就会让 subagent 通道把工具调用记到不存在的那一轮上。
   */
  issueForConnection(input: {
    chatId: string;
    incarnationId: string;
    allowedTools: BuiltinToolName[];
    initiatorBackend: AgentBackendId;
    resultByteBudget?: number;
  }): ConnectionBuiltinMcp {
    const issued = this.issue({
      ...input,
      requestId: "",
      generation: -1,
    });
    issued.lease.unbound = true;
    const rebind = (turn: BuiltinMcpTurnBinding) => {
      const lease = issued.lease;
      if (lease.state === "revoked") {
        throw statusError(410, "内置 MCP lease 已撤销");
      }
      if (!lease.unbound) throw statusError(409, "内置 MCP lease 仍绑定着上一轮");
      lease.requestId = turn.requestId;
      lease.generation = turn.generation;
      lease.skillsCustodyId = turn.skillsCustodyId;
      lease.historyBinding = turn.historyBinding;
      lease.unbound = false;
    };
    const unbind = async () => {
      const lease = issued.lease;
      if (lease.unbound) return;
      /* 先关门再排空：新的调用当场拿 409，在途的那些还能自然结束。 */
      lease.unbound = true;
      const drained = await this.drain(lease);
      lease.requestId = "";
      lease.generation = -1;
      lease.skillsCustodyId = undefined;
      lease.historyBinding = undefined;
      /* 排不空只有一种诚实收口：撤销整条 lease，让连接被判死，
         而不是把一个还在跑的调用留给下一轮。 */
      if (!drained) this.revoke(lease);
    };
    return {
      ...issued,
      rebind,
      unbind,
      turnView: () => ({
        server: issued.server,
        lease: issued.lease,
        waitReady: issued.waitReady,
        /* turn 侧的"撤销"只意味着本轮结束：连接的 lease 归连接。 */
        revoke: () => void unbind(),
      }),
    };
  }

  /** bridge 在每次工具调用前后各调一次；解绑据此判断排空。 */
  beginInvocation(lease: BuiltinMcpLease) {
    this.inFlight.set(lease.leaseId, (this.inFlight.get(lease.leaseId) ?? 0) + 1);
  }

  endInvocation(lease: BuiltinMcpLease) {
    const next = (this.inFlight.get(lease.leaseId) ?? 1) - 1;
    if (next > 0) {
      this.inFlight.set(lease.leaseId, next);
      return;
    }
    this.inFlight.delete(lease.leaseId);
    for (const resolve of this.drains.get(lease.leaseId) ?? []) resolve();
    this.drains.delete(lease.leaseId);
  }

  authorize(token: string, tool: BuiltinToolName) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked") {
      throw statusError(401, "内置 MCP lease 无效或已撤销");
    }
    if (lease.unbound) {
      throw statusError(409, "内置 MCP lease 当前没有进行中的 turn");
    }
    if (!lease.allowedTools.includes(tool)) {
      throw statusError(403, `当前 turn 无权调用 ${tool}；Plan/read 访问不允许 mutation`);
    }
    return lease;
  }

  consume(token: string, tool: BuiltinToolName, now = Date.now()) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked") {
      throw statusError(401, "内置 MCP lease 无效或已撤销");
    }
    if (lease.unbound) {
      throw statusError(409, "内置 MCP lease 当前没有进行中的 turn");
    }
    const spec = builtinToolSpec(tool);
    if (!spec) throw statusError(400, "未知内置工具");
    const domain = BUILTIN_TOOL_DOMAINS[spec.domainId];
    const key = `${token}\0${domain.id}`;
    const calls = (this.calls.get(key) ?? []).filter(
      (timestamp) => now - timestamp < domain.rateWindowMs
    );
    if (calls.length >= domain.rateLimit) {
      throw statusError(429, `${domain.id} 工具调用过于频繁，请稍后再试`);
    }
    calls.push(now);
    this.calls.set(key, calls);
  }

  markReady(token: string) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked") return false;
    lease.state = "ready";
    for (const waiter of this.waiters.get(lease.leaseId) ?? []) waiter.resolve();
    this.waiters.delete(lease.leaseId);
    return true;
  }

  revoke(lease: BuiltinMcpLease) {
    const current = this.byToken.get(lease.socketToken);
    if (!current || current.leaseId !== lease.leaseId) return;
    current.state = "revoked";
    this.controllers.get(current.leaseId)?.abort(
      new Error("内置 MCP lease 已撤销")
    );
    this.controllers.delete(current.leaseId);
    this.byToken.delete(lease.socketToken);
    current.unbound = true;
    this.inFlight.delete(current.leaseId);
    for (const resolve of this.drains.get(current.leaseId) ?? []) resolve();
    this.drains.delete(current.leaseId);
    for (const key of this.calls.keys()) {
      if (key.startsWith(`${lease.socketToken}\0`)) this.calls.delete(key);
    }
    for (const waiter of this.waiters.get(lease.leaseId) ?? []) {
      waiter.reject(new Error("内置 MCP lease 已撤销"));
    }
    this.waiters.delete(lease.leaseId);
  }

  revokeAll() {
    for (const lease of [...this.byToken.values()]) this.revoke(lease);
  }

  /** 返回 true 表示已排空；false 表示撞上死线（调用方据此撤销）。 */
  private drain(lease: BuiltinMcpLease, timeoutMs = BUILTIN_MCP_DRAIN_TIMEOUT_MS) {
    if (!this.inFlight.get(lease.leaseId)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const waiters = this.drains.get(lease.leaseId) ?? new Set<() => void>();
      const settle = (drained: boolean) => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(drained);
      };
      const done = () => settle(true);
      const timer = setTimeout(() => settle(false), timeoutMs);
      timer.unref?.();
      waiters.add(done);
      this.drains.set(lease.leaseId, waiters);
    });
  }

  private waitReady(lease: BuiltinMcpLease, signal: AbortSignal) {
    if (lease.state === "ready") return Promise.resolve();
    if (lease.state === "revoked") {
      return Promise.reject(new Error("内置 MCP lease 已撤销"));
    }
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      /* 自带期限。少了它，「子进程起了但从不连回来」就会一路吃满整条
         启动预算，把一个确指的 socket 故障退化成一句泛泛的启动超时。 */
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        this.waiters.get(lease.leaseId)?.delete(waiter);
        finish();
      };
      const waiter: Waiter = {
        resolve: () => settle(resolve),
        reject: (cause) => settle(() => reject(cause)),
      };
      const onAbort = () => settle(() => reject(abortError()));
      const timer = setTimeout(
        () =>
          settle(() =>
            reject(
              new Error(
                `内置 MCP 子进程未在 ${Math.round(
                  this.readyTimeoutMs / 1000
                )}s 内连回 ${this.socketPath}`
              )
            )
          ),
        this.readyTimeoutMs
      );
      timer.unref?.();
      signal.addEventListener("abort", onAbort, { once: true });
      const pending = this.waiters.get(lease.leaseId) ?? new Set<Waiter>();
      pending.add(waiter);
      this.waiters.set(lease.leaseId, pending);
    });
  }
}
