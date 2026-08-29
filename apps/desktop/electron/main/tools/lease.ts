/**
 * [INPUT]: Depends on Node crypto, shared builtin-tool registry, per-turn server/socket path, and optional frozen Skills custody
 * [OUTPUT]: Provides incarnation-bound BuiltinMcpLease, launcher/budgets, ready/revoke signals, `(token, domainId)` rate control, and custody release after invocation drain
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
  /** 发起方 CLI 的 MCP client 对最终 CallToolResult 的可见上限。 */
  resultByteBudget: number;
  socketToken: string;
  signal: AbortSignal;
  state: "issued" | "ready" | "revoked";
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

  get(token: string) {
    return this.byToken.get(token);
  }

  authorize(token: string, tool: BuiltinToolName) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked") {
      throw Object.assign(new Error("内置 MCP lease 无效或已撤销"), {
        status: 401,
      });
    }
    if (!lease.allowedTools.includes(tool)) {
      throw Object.assign(
        new Error(`当前 turn 无权调用 ${tool}；Plan/read 访问不允许 mutation`),
        { status: 403 }
      );
    }
    return lease;
  }

  consume(token: string, tool: BuiltinToolName, now = Date.now()) {
    const spec = builtinToolSpec(tool);
    if (!spec) throw Object.assign(new Error("未知内置工具"), { status: 400 });
    const domain = BUILTIN_TOOL_DOMAINS[spec.domainId];
    const key = `${token}\0${domain.id}`;
    const calls = (this.calls.get(key) ?? []).filter(
      (timestamp) => now - timestamp < domain.rateWindowMs
    );
    if (calls.length >= domain.rateLimit) {
      throw Object.assign(
        new Error(`${domain.id} 工具调用过于频繁，请稍后再试`),
        { status: 429 }
      );
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
