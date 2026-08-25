/**
 * [INPUT]: Depends on Node detached child_process, ACP JSONL, startup fixed byte tail loop, backend supervisor and process-group settled
 * [OUTPUT]: Provides ACP response to claims, raw code/data errors, Codex/Claude zero prompt unlocked matcher, and canceled monitored session inspector for external de-sensitivity late to stderr/sessionId
 * [POS]: Short process detection of the core of the ACP model directory; Subprocess registration/clearing before lease release, failure classification left to the descriptor
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  assertAgentProcessAdmission,
  registerAuxiliaryAgentProcess,
  reportAgentCleanupFailure,
} from "../../agent-process-supervisor";
import { asError } from "../../errors";
import { cleanProcessGroup } from "../../process-group";
import { AcpProcessEvidence } from "./startup/evidence";

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

export function assertAcpProtocolVersion(value: unknown) {
  const protocolVersion = (
    value as { protocolVersion?: unknown } | null
  )?.protocolVersion;
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
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
    throw new Error("ACP session/new 返回了无效 sessionId");
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
  timeoutMs?: number;
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
  if (!(cause instanceof AcpRequestError) || cause.code !== -32_603) {
    return undefined;
  }
  const details = (cause.data as { details?: unknown } | null)?.details;
  return typeof details === "string" ? details : undefined;
}

export function isAcpUnpersistedSessionCleanup(
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
    const error = new Error(redactDiagnostic(source.message));
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
  const child = (dependencies.spawnProcess ?? spawn)(
    options.command,
    options.args,
    {
      cwd: options.cwd,
      detached: true,
      env: options.env,
    }
  );
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
       （dev/mcp-timeout-harness 2026-07-29 真机踩坑）。 */
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
    child.once("error", (cause) => reject(diagnosticError(cause)));
    child.stdin.once("error", (cause) => {
      stdinError ??= diagnosticError(cause);
      reject(stdinError);
    });
    child.once("close", (code) => {
      reject(
        new Error(
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
  const timeoutMs = options.timeoutMs ?? 12_000;
  let timeout: NodeJS.Timeout | undefined;
  let deadlineFired = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      deadlineFired = true;
      reject(new Error("ACP readiness probe 超时"));
    }, timeoutMs);
    timeout.unref?.();
  });
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
    const response = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
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
    return Promise.race([response, closed, deadline, aborted]);
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
      clientCapabilities: {
        session: { configOptions: {} },
      },
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
        !isAcpUnpersistedSessionCleanup(
          options.backend,
          sessionId,
          cleanupCause
        )
      ) {
        sessionCleanupError = cleanupCause;
      }
    }
    if (timeout) clearTimeout(timeout);
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
