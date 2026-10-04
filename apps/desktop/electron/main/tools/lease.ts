/**
 * [INPUT]: Depends on Node crypto, shared builtin-tool registry, the provider host traits (result byte budget), per-turn server/socket path, and optional frozen Skills custody, and statusError from main/errors
 * [OUTPUT]: Provides incarnation-bound per-turn BuiltinMcpLease, launcher/budgets, a single-use claim that binds the lease to the one bridge connection that presented it first (so a copy of the token read from the environment or `ps` cannot be replayed), ready/revoke signals, bounded same-identity-different-content refusal, `(token, domainId)` rate control, and custody release. The server command is resolved per lease (bundledToolsServer by default, TASK-35 C4).
 * [POS]: Tool-platform authorization core; subprocesses hold only random tokens, while main holds the live lease and turn custody
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  BUILTIN_MCP_READY_TIMEOUT_MS,
  BUILTIN_TOOL_DOMAINS,
  assertUnixSocketPath,
  builtinToolSpec,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { providerTraits } from "../../../shared/providers/traits";
import { statusError } from "../ipc/errors";
import { bundledToolsServer } from "../runtime";

const INVOCATION_GUARD_LIMIT = 4096;

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
  previewFence?: import("../preview/process/fence").FrozenPreviewFence;
  /** 发起方 CLI 的 MCP client 对最终 CallToolResult 的可见上限。 */
  resultByteBudget: number;
  socketToken: string;
  signal: AbortSignal;
  state: "issued" | "ready" | "revoked";
  /**
   * The bridge connection that claimed this lease. The token travels through the CLI's MCP config (an
   * environment variable or argv the Agent's shell can read), so it is only a claim: after the MCP server
   * presents it once, every call must arrive on that same connection and the token alone authorizes nothing.
   */
  claimedBy?: symbol;
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
 * The result byte budget of the backend the lease was issued to: its host trait (Kimi truncates MCP tool results near 100 KB,
 * measured in DEV/agents/docs/agent-cli-docs.md, so it keeps 80 KB; the others keep the domain's logical budget).
 */
export function initiatorResultByteBudget(
  backend: AgentBackendId
): number {
  return providerTraits(backend).builtinWireByteLimit;
}

export class BuiltinMcpLeaseStore {
  private readonly byToken = new Map<string, BuiltinMcpLease>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly calls = new Map<string, number[]>();
  /** Per-lease invocation id → content digest; only to refuse a reused identity carrying different content. */
  private readonly invocations = new Map<string, Map<string, string>>();

  constructor(
    private readonly socketPath: string,
    /* The server a CLI is told to start, resolved per lease: the product's is the bundled Node on the digest-checked entry (TASK-35 C4).
       `env` is only for a launcher that is not a plain Node; the tools contract below is always the rest of it. */
    private readonly server: () => { command: string; args: readonly string[]; env?: Record<string, string> } = bundledToolsServer,
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
    previewFence?: import("../preview/process/fence").FrozenPreviewFence;
  }): IssuedBuiltinMcp {
    /* Resolved before anything is registered: no usable runtime, no lease and nothing written into an MCP config. */
    const program = this.server();
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
        command: program.command,
        args: [...program.args],
        env: {
          ...program.env,
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
   * The identity names the intent; the digest only guards it. A repeat with the same digest is a retransmission
   * the owning ledger replays; the same identity with other content is refused rather than answered with the
   * first call's receipt. Bounded per lease: evicting the oldest entry only loses this guard, never a receipt.
   */
  claimInvocation(lease: BuiltinMcpLease, invocationId: string, requestDigest: string) {
    let seen = this.invocations.get(lease.leaseId);
    if (!seen) this.invocations.set(lease.leaseId, (seen = new Map()));
    const prior = seen.get(invocationId);
    if (prior !== undefined && prior !== requestDigest) {
      throw statusError(409, "TOOL_INVOCATION_CONFLICT: invocation id reused with different content");
    }
    if (prior === undefined) {
      if (seen.size >= INVOCATION_GUARD_LIMIT) seen.delete(seen.keys().next().value!);
      seen.set(invocationId, requestDigest);
    }
  }

  authorize(token: string, tool: BuiltinToolName, connection: symbol) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked" || lease.claimedBy !== connection) {
      throw statusError(401, "内置 MCP lease 无效或已撤销");
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

  /** Single use: the first connection to present the token owns the lease; any other presentation is refused. */
  claim(token: string, connection: symbol) {
    const lease = this.byToken.get(token);
    if (!lease || lease.state === "revoked") return false;
    if (lease.claimedBy) return lease.claimedBy === connection;
    lease.claimedBy = connection;
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
    this.invocations.delete(current.leaseId);
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
