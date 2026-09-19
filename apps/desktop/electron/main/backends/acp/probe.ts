/**
 * [INPUT]: Depends on Node detached child_process/readline JSON-RPC framing, AcpProcessEvidence stderr tail, the agent process supervisor, and process-group cleanup
 * [OUTPUT]: Provides ACP session inspection bounded by a per-request budget plus a total spawn-anchored cap, exact adapter-wrapped session absence matching, and typed failures that survive redaction and cleanup.
 * [POS]: Core of ACP readiness probing — a short-lived handshake subprocess; registers/deregisters with the process supervisor before lease release and leaves failure classification to the backend descriptor
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  assertAgentProcessAdmission,
  registerAuxiliaryAgentProcess,
  reportAgentCleanupFailure,
} from "../../agent-process-supervisor";
import { asError } from "../../errors";
import { cleanProcessGroup } from "../../process-group";
import { AcpProcessEvidence } from "./startup/evidence";
import {
  buildAcpClientCapabilities,
  SESSION_CAPABILITY_POLICY,
} from "./session/client-capabilities";

export class AcpRequestError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(
    message: string,
    code: number | undefined,
    data: unknown
  ) {
    super(message);
    this.code = code;
    this.data = data;
    /* classifier 仍可读取 raw data；枚举/JSON/IPC 投影看不到凭据载荷。 */
    Object.defineProperty(this, "data", {
      value: data,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

/** Only failures witnessed at process creation, process exit or protocol validation carry this marker. */
export class AcpStartupError extends Error {
  readonly startupFailure = true;
}

export function assertAcpProtocolVersion(value: unknown) {
  const protocolVersion = (
    value as { protocolVersion?: unknown } | null
  )?.protocolVersion;
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new AcpStartupError(
      `ACP protocolVersion 不兼容：${String(protocolVersion)}`
    );
  }
}

export function assertAcpSessionId(
  value: unknown,
  validateSessionId: (id: string) => boolean
) {
  const sessionId = (value as { sessionId?: unknown } | null)?.sessionId;
  if (
    typeof sessionId !== "string" ||
    Buffer.byteLength(sessionId, "utf8") === 0 ||
    !validateSessionId(sessionId)
  ) {
    throw new AcpStartupError("ACP session/new returned an invalid sessionId");
  }
  return sessionId;
}

export type AcpProbeOptions = {
  backend: AgentBackendId;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  validateSessionId: (id: string) => boolean;
  /** Patience for a single JSON-RPC request, rearmed per request. */
  timeoutMs?: number;
  /** Hard cap for the whole probe, measured from spawn. */
  totalTimeoutMs?: number;
  signal?: AbortSignal;
};

export type AcpProbeDependencies = {
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio
  ) => ChildProcessWithoutNullStreams;
  cleanProcessGroup?: typeof cleanProcessGroup;
  assertAdmission?: typeof assertAgentProcessAdmission;
  registerProcess?: typeof registerAuxiliaryAgentProcess;
  reportCleanupFailure?: typeof reportAgentCleanupFailure;
};

export type AcpSessionInspection = {
  initialized: unknown;
  created: unknown;
  sessionId: string;
  request(method: string, params: unknown): Promise<unknown>;
};

function requestDetails(cause: Error) {
  if (!(cause instanceof AcpRequestError || cause instanceof RequestError) || cause.code !== -32_603) {
    return undefined;
  }
  const details = (cause.data as { details?: unknown } | null)?.details;
  return typeof details === "string" ? details : undefined;
}

export function isAcpSessionMissing(
  backend: AgentBackendId,
  sessionId: string,
  cause: unknown
) {
  const details = cause instanceof Error ? requestDetails(cause) : undefined;
  if (backend === "codex") {
    return details === `no rollout found for thread id ${sessionId}`;
  }
  if (backend === "claude") {
    return (
      details ===
      `Session ${sessionId} not found in any project directory`
    );
  }
  return false;
}

export async function inspectAcpSession<T>(
  options: AcpProbeOptions,
  inspect: (session: AcpSessionInspection) => Promise<T>,
  dependencies: AcpProbeDependencies = {}
): Promise<T> {
  const assertAdmission =
    dependencies.assertAdmission ?? assertAgentProcessAdmission;
  const clean = dependencies.cleanProcessGroup ?? cleanProcessGroup;
  const reportFailure =
    dependencies.reportCleanupFailure ?? reportAgentCleanupFailure;
  options.signal?.throwIfAborted();
  assertAdmission(options.backend);
  const evidence = new AcpProcessEvidence(options.env);
  let sessionId: string | undefined;
  const redactDiagnostic = (value: string) => {
    const redacted = evidence.redact(value);
    return sessionId
      ? redacted.split(sessionId).join("[session-id]")
      : redacted;
  };
  /* 同一原因必须映射到同一 Error 对象：超时/进程死亡这类哨兵拒绝会经
     不同路径（主流程与 cleanup）到达汇总点，若每次包一个新对象，末尾的
     identity 去重就会把「一个死因」误报成「probe 与 cleanup 双重失败」，
     结构化死因（exit code + stderr 尾巴）被埋进一句无信息的 AggregateError。 */
  const diagnosticCache = new WeakMap<object, Error>();
  const diagnosticError = (cause: unknown) => {
    if (cause instanceof AcpRequestError) return cause;
    if (typeof cause === "object" && cause !== null) {
      const cached = diagnosticCache.get(cause);
      if (cached) return cached;
    }
    const source = asError(cause);
    const error = (cause as { startupFailure?: boolean } | null)?.startupFailure
      ? new AcpStartupError(redactDiagnostic(source.message)) : new Error(redactDiagnostic(source.message));
    error.name = source.name;
    const meta = cause as { code?: unknown; data?: unknown } | null;
    if (typeof meta?.code === "number" || typeof meta?.code === "string") {
      Object.defineProperty(error, "code", {
        value: meta.code,
        enumerable: true,
      });
    }
    if (meta?.data !== undefined) {
      Object.defineProperty(error, "data", {
        value: meta.data,
        enumerable: false,
      });
    }
    if (typeof cause === "object" && cause !== null) {
      diagnosticCache.set(cause, error);
    }
    return error;
  };
  let child: ChildProcessWithoutNullStreams;
  try { child = (dependencies.spawnProcess ?? spawn)(
    options.command,
    options.args,
    {
      cwd: options.cwd,
      detached: true,
      env: options.env,
    }
  ); } catch (cause) { throw new AcpStartupError(redactDiagnostic(asError(cause).message)); }
  child.once("error", () => undefined);
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let unregister: (() => void) | undefined;
  try {
    unregister = (
      dependencies.registerProcess ?? registerAuxiliaryAgentProcess
    )(options.backend, child, settled);
  } catch (cause) {
    const cleanup = child.pid
      ? await clean(child.pid).catch((cleanupCause) => ({
          ok: false as const,
          error: diagnosticError(cleanupCause),
        }))
      : { ok: true as const };
    settle();
    const registrationError = diagnosticError(cause);
    if (!cleanup.ok) {
      const cleanupError = diagnosticError(cleanup.error);
      reportFailure(options.backend, cleanupError);
      throw new AggregateError(
        [registrationError, cleanupError],
        "ACP probe 登记失败且进程组清理失败"
      );
    }
    throw registrationError;
  }
  child.stderr.on("data", (chunk) => {
    evidence.writeStderr(chunk);
  });
  child.stderr.once("end", () => evidence.endStderr());
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (cause: Error) => void }
  >();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message: {
      id?: unknown;
      method?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown; data?: unknown };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    /* ACP 双向 JSON-RPC 的 id 空间独立：带 method 的是 agent→client 请求，
       它的 id 撞上未决 client 请求 id 时，按 id 匹配会把请求误吞成响应
       （DEV/platform/mcp/timeout-harness 2026-07-29 真机踩坑）。 */
    if (message.method !== undefined) return;
    if (typeof message.id !== "number") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      request.reject(
        new AcpRequestError(
          redactDiagnostic([
            typeof message.error.message === "string"
              ? message.error.message
              : "ACP request failed",
            message.error.data === undefined
              ? ""
              : JSON.stringify(message.error.data),
          ].filter(Boolean).join(": ")),
          typeof message.error.code === "number"
            ? message.error.code
            : undefined,
          message.error.data
        )
      );
    } else {
      request.resolve(message.result);
    }
  });
  let stdinError: Error | undefined;
  /* transport 一旦死亡（进程退出/stdin 断裂），后续任何 session 清理请求
     都不可能成功；这个标志让 teardown 得以诚实跳过而不是拿同一个死因
     再失败一次。 */
  let transportDown = false;
  const closed = new Promise<never>((_resolve, reject) => {
    child.once("error", (cause) => reject(new AcpStartupError(redactDiagnostic(cause.message))));
    child.stdin.once("error", (cause) => {
      stdinError ??= new AcpStartupError(redactDiagnostic(cause.message));
      reject(stdinError);
    });
    child.once("close", (code) => {
      reject(
        new AcpStartupError(
          redactDiagnostic(
            `ACP probe 进程提前退出 code=${String(code)} ${evidence.rawTail()}`
          )
        )
      );
    });
  });
  closed.catch(() => {
    transportDown = true;
  });
  let requestId = 0;
  /* Two budgets, because one spawn-anchored deadline cannot tell a slow agent
     from a wedged one: at launch every step legitimately costs seconds (codex
     refetches its remote model cache on each session/new), yet a dead
     transport must still be cut loose. Each request gets its own patience;
     the total cap bounds the probe as a whole. */
  const timeoutMs = options.timeoutMs ?? 12_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
  let deadlineFired = false;
  let timeoutCause: DOMException | undefined;
  /* One object for both budgets: the diagnostic cache keys on cause identity,
     so a single timeout must not surface as two distinct deaths. */
  const timedOut = () => {
    deadlineFired = true;
    timeoutCause ??= new DOMException("Agent check timed out", "TimeoutError");
    return timeoutCause;
  };
  let totalTimeout: NodeJS.Timeout | undefined;
  const totalDeadline = new Promise<never>((_resolve, reject) => {
    totalTimeout = setTimeout(() => reject(timedOut()), totalTimeoutMs);
    totalTimeout.unref?.();
  });
  /* inspect() may work between requests, so nothing races the cap just then. */
  totalDeadline.catch(() => undefined);
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const signal = options.signal;
    if (!signal) return;
    const abort = () =>
      reject(
        signal.reason ?? new DOMException("ACP readiness probe 已取消", "AbortError")
      );
    if (signal.aborted) abort();
    else {
      abortListener = abort;
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  const request = (method: string, params: unknown) => {
    const id = ++requestId;
    let timeout: NodeJS.Timeout | undefined;
    const response = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      timeout = setTimeout(() => {
        pending.delete(id);
        reject(timedOut());
      }, timeoutMs);
      timeout.unref?.();
      try {
        child.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        })}\n`);
      } catch (cause) {
        stdinError ??= diagnosticError(cause);
        pending.delete(id);
        reject(stdinError);
      }
    });
    return Promise.race([response, closed, totalDeadline, aborted]).finally(
      () => {
        if (timeout) clearTimeout(timeout);
      }
    );
  };
  let initialized: unknown;
  let outcome:
    | { ok: true; value: T }
    | { ok: false; cause: Error };
  let sessionCleanupError: Error | undefined;
  let cleanupError: Error | undefined;
  try {
    initialized = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: buildAcpClientCapabilities(
        SESSION_CAPABILITY_POLICY[options.backend]
      ),
      clientInfo: {
        name: "ai-chat-readiness-probe",
        title: "Bottega Readiness Probe",
        version: "0.1.0",
      },
    });
    assertAcpProtocolVersion(initialized);
    const created = await request("session/new", {
      cwd: options.cwd,
      mcpServers: [],
    });
    sessionId = assertAcpSessionId(
      created,
      options.validateSessionId
    );
    outcome = {
      ok: true,
      value: await inspect({ initialized, created, sessionId, request }),
    };
  } catch (cause) {
    outcome = { ok: false, cause: diagnosticError(cause) };
  } finally {
    const sessionCapabilities = (
      initialized as {
        agentCapabilities?: { sessionCapabilities?: Record<string, unknown> };
      } | undefined
    )?.agentCapabilities?.sessionCapabilities;
    /* transport 已死 / deadline 已过 / caller 已取消时不再发 session 清理：
       此时 request 会瞬间拿到同一个哨兵拒绝，把一个死因报成两个；真正的
       收口交给下面的进程组清理。 */
    const sessionCleanupViable =
      !transportDown && !deadlineFired && !options.signal?.aborted;
    try {
      if (sessionId && sessionCleanupViable && sessionCapabilities?.delete) {
        await request("session/delete", { sessionId });
      } else if (
        sessionId &&
        sessionCleanupViable &&
        sessionCapabilities?.close
      ) {
        await request("session/close", { sessionId });
      }
    } catch (cause) {
      const cleanupCause = diagnosticError(cause);
      if (
        !sessionId ||
        !isAcpSessionMissing(
          options.backend,
          sessionId,
          cleanupCause
        )
      ) {
        sessionCleanupError = cleanupCause;
      }
    }
    if (totalTimeout) clearTimeout(totalTimeout);
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
    try {
      lines.close();
    } catch (cause) {
      sessionCleanupError ??= diagnosticError(cause);
    }
    try {
      child.stdin.end();
    } catch (cause) {
      stdinError ??= diagnosticError(cause);
    }
    try {
      const cleanup = child.pid
        ? await clean(child.pid)
        : { ok: true as const };
      if (!cleanup.ok) {
        cleanupError = diagnosticError(cleanup.error);
        reportFailure(
          options.backend,
          cleanupError,
          (unregister as { owner?: symbol } | undefined)?.owner
        );
      } else {
        unregister();
      }
    } catch (cause) {
      cleanupError = diagnosticError(cause);
      reportFailure(
        options.backend,
        cleanupError,
        (unregister as { owner?: symbol } | undefined)?.owner
      );
    } finally {
      settle();
    }
  }
  const failures = [
    ...(!outcome.ok ? [outcome.cause] : []),
    sessionCleanupError,
    stdinError,
    cleanupError,
  ].filter((failure): failure is Error => Boolean(failure));
  const unique = [...new Set(failures)];
  if (unique.length === 1) throw unique[0];
  if (unique.length > 1) {
    throw new AggregateError(unique, "ACP probe 与 cleanup 均未完整结算");
  }
  if (!outcome.ok) throw outcome.cause;
  return outcome.value;
}
