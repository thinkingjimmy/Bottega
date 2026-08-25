/**
 * [INPUT]: Depends on agent-bridge freeze channels, backend runtime snapshot, only HeadlessExecutor with shared Agent/Chat budget contract
 * [OUTPUT]: Provides SubagentSpawnService; Complete child sorting, barrier sorting, explicit attempt restarting, preflight/admission type, process cabinet, total deadline, permission reduction, draft reservation, endpoint item, successfully executed outcome tombstone, and wire/LRU/durable results of explicitly cutting facts
 * [POS]: The single-use trans-backend assigned coder of the agent module; Do not penetrate TurnEntry, do not inject a headless child with built-in MCP
 */

import { createHash } from "node:crypto";
import {
  BUILTIN_TOOL_DOMAINS,
} from "../../../shared/builtin-tools";
import {
  MESSAGE_BYTE_LIMIT,
} from "../../../shared/chats-ipc";
import type {
  PersistedSubagent,
  PersistedSubagentStatus,
} from "../../../shared/chats-ipc";
import { truncateUtf8 } from "../../../shared/truncate-utf8";
import type {
  AgentBackendId,
  AgentSubagentMeta,
} from "../../../shared/agent-ipc";
import {
  backendById,
  backendRuntimeRegistry,
} from "../backends";
import {
  headlessExecutor,
  HeadlessPreflightAbortError,
  type HeadlessExecutor,
} from "../backends/headless-executor";
import type {
  BackendDescriptor,
  HeadlessJob,
} from "../backends/types";
import type { BackendRuntimeRegistry } from "../backends/runtime-registry";
import { asError } from "../errors";
import {
  isAgentProcessAdmissionError,
} from "../agent-process-supervisor";
import {
  openSubagentChannel,
  type SubagentChannel,
} from "../agent-bridge";
import type { BuiltinToolContext } from "../tools/registry";
import type { SubagentOutcomeStatus } from "../turn-registry";

export type SpawnSubagentInput = {
  agent: AgentBackendId;
  prompt: string;
  name?: string;
  timeout_seconds: number;
};

export type SpawnSubagentResult = {
  agent_thread_id: string;
  agent: AgentBackendId;
  status: SubagentOutcomeStatus;
} & ({ result: string } | { result_unavailable: true });

export type PromotableResult = {
  name: string;
  agent: AgentBackendId;
  status: PersistedSubagentStatus;
  text: string;
  resultBytes: number;
  truncated: boolean;
};

export type PromotableResultSource = {
  peekResult(
    agentThreadId: string,
    context: BuiltinToolContext
  ): PromotableResult | undefined;
};

type SpawnDependencies = {
  runtimeRegistry: Pick<BackendRuntimeRegistry, "resolveForSpawn">;
  executor: HeadlessExecutor;
  backendFor(id: AgentBackendId): BackendDescriptor;
  openChannel(context: BuiltinToolContext): SubagentChannel | undefined;
};

const EMPTY_RESULT = "(子任务无文本输出)";
const RESULT_SUFFIX = "…[已截断]";
const TOOL_RESULT_LIMIT =
  BUILTIN_TOOL_DOMAINS.subagents.logicalResultByteLimit - 4 * 1024;
const RESULT_CACHE_ENTRY_LIMIT = 16;
const RESULT_CACHE_BYTE_LIMIT = 1024 * 1024;

type BoundedResult = { text: string; truncated: boolean };
type CachedResult = BoundedResult & { bytes: number };

class TotalDeadline {
  readonly controller = new AbortController();
  readonly expiresAt: number;
  private expired = false;
  private readonly timer: NodeJS.Timeout;

  constructor(timeoutMs: number) {
    this.expiresAt = Date.now() + timeoutMs;
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort(new Error("Subagent 总 deadline 已耗尽"));
    }, timeoutMs);
  }

  get timedOut() {
    return this.expired;
  }

  remaining() {
    return Math.max(0, this.expiresAt - Date.now());
  }

  close() {
    clearTimeout(this.timer);
  }
}

export class SubagentSpawnService {
  private readonly pending = new Map<string, Promise<SpawnSubagentResult>>();
  private readonly results = new Map<string, CachedResult>();
  private resultCacheBytes = 0;

  constructor(
    private readonly dependencies: SpawnDependencies = {
      runtimeRegistry: backendRuntimeRegistry,
      executor: headlessExecutor,
      backendFor: backendById,
      openChannel: (context) => openSubagentChannel(context.lease),
    }
  ) {}

  spawn(input: SpawnSubagentInput, context: BuiltinToolContext) {
    const channel = this.dependencies.openChannel(context);
    if (!channel) throw statusError(409, "当前工具 lease 没有活跃父 turn");
    const id = subagentId(context.lease.leaseId, context.invocationId);
    const replay = this.replay(
      id,
      input.agent,
      channel,
      context.lease.resultByteBudget
    );
    if (replay) return Promise.resolve(replay);
    const current = this.pending.get(id);
    if (current) return current;
    const deadline = new TotalDeadline(input.timeout_seconds * 1_000);
    const task = this.execute(id, input, context, channel, deadline);
    this.pending.set(id, task);
    void task.finally(() => this.pending.delete(id)).catch(() => {});
    return task;
  }

  private async execute(
    id: string,
    input: SpawnSubagentInput,
    context: BuiltinToolContext,
    channel: SubagentChannel,
    deadline: TotalDeadline
  ) {
    const signal = AbortSignal.any([
      context.signal,
      channel.signal,
      deadline.controller.signal,
    ]);
    try {
      const snapshot = await abortable(
        this.dependencies.runtimeRegistry.resolveForSpawn(input.agent, signal),
        signal
      );
      assertReady(input.agent, snapshot);
      if (deadline.remaining() === 0) throw queueTimeout();
      if (!channel.reserveDraftSlot(id)) {
        throw statusError(429, "Subagent 实时详情容量已满，请稍后重试");
      }
      const meta = runningMeta(id, input);
      channel.beginAttempt(meta);
      return await this.run(
        id,
        input,
        channel,
        snapshot,
        signal,
        deadline,
        meta,
        context.lease.resultByteBudget
      );
    } catch (cause) {
      if (deadline.timedOut && !channel.getOutcome(id)) throw queueTimeout();
      throw cause;
    } finally {
      deadline.close();
    }
  }

  private run(
    id: string,
    input: SpawnSubagentInput,
    channel: SubagentChannel,
    snapshot: Awaited<ReturnType<BackendRuntimeRegistry["resolveForSpawn"]>>,
    signal: AbortSignal,
    deadline: TotalDeadline,
    meta: AgentSubagentMeta,
    resultByteBudget: number
  ) {
    const descriptor = this.dependencies.backendFor(input.agent);
    const run = this.dependencies.executor.run(
      descriptor,
      spawnJob(input.prompt, channel, deadline.remaining()),
      { signal, snapshot }
    );
    const orchestration = this.completeRun(
      id,
      input,
      channel,
      run,
      signal,
      deadline,
      meta,
      resultByteBudget
    );
    const settled = Promise.allSettled([
      run.settled,
      orchestration,
    ]).then(() => undefined);
    channel.register({ abort: () => run.cancel(), settled });
    return orchestration;
  }

  private async completeRun(
    id: string,
    input: SpawnSubagentInput,
    channel: SubagentChannel,
    run: ReturnType<HeadlessExecutor["run"]>,
    signal: AbortSignal,
    deadline: TotalDeadline,
    meta: AgentSubagentMeta,
    resultByteBudget: number
  ) {
    try {
      const result = await run.result;
      return this.finish(
        id,
        input.agent,
        "completed",
        result.text,
        meta,
        channel,
        resultByteBudget
      );
    } catch (cause) {
      const status = failureStatus(signal, deadline);
      const result = asError(cause).message || EMPTY_RESULT;
      if (isPreflightExhausted(cause, deadline)) {
        this.writeTerminal(
          id,
          status,
          result,
          meta,
          channel,
          resultByteBudget,
          input.agent
        );
        throw statusError(429, result);
      }
      return this.finish(
        id,
        input.agent,
        status,
        result,
        meta,
        channel,
        resultByteBudget
      );
    }
  }

  private finish(
    id: string,
    agent: AgentBackendId,
    status: SubagentOutcomeStatus,
    rawResult: string,
    meta: AgentSubagentMeta,
    channel: SubagentChannel,
    resultByteBudget: number
  ) {
    const result = this.writeTerminal(
      id,
      status,
      rawResult,
      meta,
      channel,
      resultByteBudget,
      agent
    );
    channel.setOutcome(id, status);
    this.remember(id, result);
    return this.output(id, agent, status, result.text);
  }

  private writeTerminal(
    id: string,
    status: SubagentOutcomeStatus,
    rawResult: string,
    meta: AgentSubagentMeta,
    channel: SubagentChannel,
    resultByteBudget: number,
    agent: AgentBackendId
  ) {
    const durable = boundedText(rawResult, MESSAGE_BYTE_LIMIT);
    const output = boundedOutputText(
      rawResult,
      id,
      agent,
      status,
      resultByteBudget
    );
    channel.applyItem(id, {
      itemId: `subagent-result:${id}`,
      kind: "agent-message",
      title: "Subagent result",
      text: durable.text,
      status: status === "completed" ? "completed" : "failed",
    });
    channel.upsert({
      ...meta,
      status: persistedStatus(status),
      lastActivityAt: Date.now(),
      resultBytes: Buffer.byteLength(rawResult, "utf8"),
      resultTruncated: durable.truncated,
    });
    return output;
  }

  private output(
    id: string,
    agent: AgentBackendId,
    status: SubagentOutcomeStatus,
    result: string
  ): SpawnSubagentResult {
    return { agent_thread_id: id, agent, status, result };
  }

  private replay(
    id: string,
    agent: AgentBackendId,
    channel: SubagentChannel,
    resultByteBudget: number
  ): SpawnSubagentResult | undefined {
    const status = channel.getOutcome(id);
    if (!status) return undefined;
    const cached = this.results.get(id);
    return cached === undefined
      ? { agent_thread_id: id, agent, status, result_unavailable: true }
      : this.output(
          id,
          agent,
          status,
          boundedOutputText(cached.text, id, agent, status, resultByteBudget).text
        );
  }

  private remember(id: string, result: BoundedResult) {
    const previous = this.results.get(id);
    if (previous) this.resultCacheBytes -= previous.bytes;
    this.results.delete(id);
    const text = result.text;
    const bytes = Buffer.byteLength(text, "utf8");
    this.results.set(id, { text, bytes, truncated: result.truncated });
    this.resultCacheBytes += bytes;
    while (
      this.results.size > RESULT_CACHE_ENTRY_LIMIT ||
      this.resultCacheBytes > RESULT_CACHE_BYTE_LIMIT
    ) {
      const oldest = this.results.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resultCacheBytes -= this.results.get(oldest)?.bytes ?? 0;
      this.results.delete(oldest);
    }
  }

  promotableResultSource(): PromotableResultSource {
    return {
      peekResult: (agentThreadId, context) => {
        const channel = this.dependencies.openChannel(context);
        const persisted = channel?.peekPersistedResult?.(agentThreadId);
        if (!persisted) return undefined;
        const cached = this.results.get(agentThreadId);
        const text = cached?.text ?? persistedResultText(persisted);
        if (!text) return undefined;
        /* 截断只认 producer 写下的事实：wire 副本自带，durable 档读 meta。
           两者皆缺只有一种来路——本能力上线前的旧档，而那时 durable 副本
           本就按 32KB 硬截，判 true 才是如实，判 false 是伪造阴性。 */
        const truncated =
          cached?.truncated ?? persisted.meta.resultTruncated ?? true;
        return {
          name: persisted.meta.name,
          agent: persisted.meta.agent ?? context.lease.initiatorBackend,
          status: persisted.meta.status,
          text,
          resultBytes:
            persisted.meta.resultBytes ?? Buffer.byteLength(text, "utf8"),
          truncated,
        };
      },
    };
  }
}

function subagentId(leaseId: string, invocationId: string) {
  return `subagent_${createHash("sha256")
    .update(`subagent\0${leaseId}:${invocationId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function runningMeta(id: string, input: SpawnSubagentInput): AgentSubagentMeta {
  const now = Date.now();
  const name = input.name ?? input.prompt.split(/\r?\n/, 1)[0]!.trim().slice(0, 100);
  return {
    agentThreadId: id,
    name: name || `Agent ${id.slice(-8)}`,
    origin: "spawn",
    agent: input.agent,
    status: "running",
    spawnedAt: now,
    lastActivityAt: now,
  };
}

function spawnJob(
  prompt: string,
  channel: SubagentChannel,
  timeoutMs: number
): HeadlessJob {
  const writable = channel.snapshot.permissionMode !== "ask-for-approval";
  return {
    purpose: "subagent",
    cwd: channel.snapshot.workspace,
    sandboxRoot: channel.snapshot.workspace,
    readRoots: [channel.snapshot.workspace],
    toolPolicy: "workspace",
    ephemeral: true,
    prompt,
    sandbox: writable ? "workspace-write" : "read-only",
    network: writable,
    approvalPolicy: "never",
    env: "user-default",
    ignoreUserConfig: false,
    timeoutMs: Math.max(1, timeoutMs),
  };
}

function persistedStatus(status: SubagentOutcomeStatus) {
  if (status === "timeout") return "interrupted" as const;
  return status;
}

function failureStatus(signal: AbortSignal, deadline: TotalDeadline) {
  if (deadline.timedOut) return "timeout" as const;
  return signal.aborted ? "interrupted" as const : "errored" as const;
}

function boundedOutputText(
  value: string,
  id: string,
  agent: AgentBackendId,
  status: SubagentOutcomeStatus,
  resultByteBudget: number
) : BoundedResult {
  const logical = boundedText(value, TOOL_RESULT_LIMIT);
  const text = logical.text;
  const bytes = Buffer.from(text, "utf8");
  const fits = (result: string) =>
    Buffer.byteLength(
      JSON.stringify({ agent_thread_id: id, agent, status, result }),
      "utf8"
    ) <= resultByteBudget;
  if (fits(text)) return logical;
  let low = 0;
  let high = bytes.byteLength;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    let end = middle;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    const candidate = `${bytes.subarray(0, end).toString("utf8")}${RESULT_SUFFIX}`;
    if (fits(candidate)) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { text: best || EMPTY_RESULT, truncated: true };
}

function boundedText(value: string, limit: number): BoundedResult {
  const text = value.trim() || EMPTY_RESULT;
  const result = truncateUtf8(text, limit, RESULT_SUFFIX);
  return { text: result.value, truncated: result.truncated };
}

function persistedResultText(result: PersistedSubagent) {
  const text = result.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return text || undefined;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}

function assertReady(
  agent: AgentBackendId,
  snapshot: Awaited<ReturnType<BackendRuntimeRegistry["resolveForSpawn"]>>
) {
  if (
    snapshot.runtimeStatus !== "installed" ||
    snapshot.authStatus !== "authenticated" ||
    !snapshot.capabilities.headless.includes("subagent")
  ) {
    throw statusError(424, `${agent} CLI 未安装、未登录或不支持 Subagent`);
  }
}

function isPreflightExhausted(
  cause: unknown,
  deadline: TotalDeadline
) {
  if (cause instanceof HeadlessPreflightAbortError) {
    return deadline.timedOut;
  }
  if (!isAgentProcessAdmissionError(cause)) return false;
  return (
    cause.reason === "queue-full" ||
    cause.reason === "queue-timeout" ||
    (cause.reason === "cancelled" && deadline.timedOut)
  );
}

function queueTimeout() {
  return statusError(429, "Subagent 进程排队或运行时解析耗尽 deadline，请稍后重试");
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
