/**
 * [INPUT]: Depends on the ACP session probe, AcpLauncher descriptors, an optional prepared process environment with read-only roots, the seatbelt sandbox wrapper, the agent process lease, and ACP failure classification
 * [OUTPUT]: Separates handshake startup proof from authentication conclusions, reports typed inconclusive check causes, and carries a credential-safe claim refused unless the probe really runs in a prepared disposable environment behind a network-less seatbelt.
 * [POS]: Core of the no-prompt readiness check shared by all four backends; owns both the handshake launch and the state-root lifecycle as a single unit
 */

import { CHECK_QUEUE_MS } from "../../availability/budgets";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { acquireAgentProcessLease } from "../../../agent-process-supervisor";
import { classifyAcpFailure } from "../failure";
import { inspectAcpSession } from "../probe";
import { wrapInteractiveWithSeatbelt } from "../../sandbox/seatbelt";
import type {
  AcpLaunch,
  AcpLauncher,
  AuthCheckResult,
  AuthCheckStatus,
  BackendFailure,
  ResolvedRuntime,
} from "../../types";

/* ============================================================
 * 握手成功到底证明了什么——每后端一格数据。
 *
 *   "auth"      : session/new 成功即已登录（Kimi 实测判据）
 *   "handshake" : 只证明进程与协议健康，登录态**无结论**。
 *
 * OpenCode 属于后者：它自己的 classifyFailure 注释就写死了诚实边界——
 * ProviderAuthError 只在 prompt 终态路径出现，未登录的实例照样能把
 * session/new 走完。把它折成 authenticated 就是伪造登录态。
 * ============================================================ */
export type AcpReadinessProof = "auth" | "handshake";

export type AcpReadinessSpec = {
  backend: AgentBackendId;
  launch: AcpLauncher;
  validateSessionId(id: string): boolean;
  proves: AcpReadinessProof;
  timeoutMs?: number;
  classifyFailure?(cause: unknown): BackendFailure;
  prepareProcessEnvironment?(): Promise<{
    processEnv: NodeJS.ProcessEnv;
    /** 临时根中的 symlink 指向这些真实状态根；只允许读，严禁回写。 */
    readOnlyRoots?: string[];
    release(): Promise<void>;
  }>;
  /** 只有带 prepareProcessEnvironment 的探针可声明：它跑在一次性 state 根 + 无网络
      Seatbelt 里，碰不到也改不了凭据，因此可以与额度读取同时在位。 */
  credentialSafe?: boolean;
};

export type AcpReadinessReport =
  | { kind: "ready" }
  | { kind: "auth-required"; message: string }
  | { kind: "failed"; message: string; cannotStart: boolean; checkIssue: import("../../../../../shared/agent-availability/types").CheckIssue };

export type AcpReadinessDependencies = {
  prepare(backend: AgentBackendId): Promise<string>;
  acquire(
    backend: AgentBackendId,
    signal: AbortSignal,
    options?: { credentialSafe?: boolean }
  ): Promise<{ release(): void }>;
  probe(spec: AcpReadinessSpec, runtime: ResolvedRuntime, cwd: string, signal: AbortSignal): Promise<void>;
};

export type PreparedAcpReadinessLaunch = {
  launch: AcpLaunch;
  readOnlyRoots: string[];
  release(): Promise<void>;
};

export async function prepareAcpReadinessLaunch(
  spec: Pick<
    AcpReadinessSpec,
    "backend" | "launch" | "prepareProcessEnvironment"
  >,
  runtime: ResolvedRuntime
): Promise<PreparedAcpReadinessLaunch> {
  const prepared = await spec.prepareProcessEnvironment?.();
  try {
    return {
      launch: spec.launch(
        runtime,
        prepared ? { processEnv: prepared.processEnv } : undefined
      ),
      readOnlyRoots: prepared?.readOnlyRoots ?? [],
      release: prepared?.release ?? (async () => undefined),
    };
  } catch (cause) {
    try {
      await prepared?.release();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        `${spec.backend} readiness launcher 构造失败且临时环境清理失败`
      );
    }
    throw cause;
  }
}

/** 探针与 disposable state 各自都可能失败；谁后发生都不能覆盖另一因。 */
export async function runPreparedAcpReadiness<T>(
  backend: AgentBackendId,
  action: () => Promise<T>,
  release: () => Promise<void>
) {
  let outcome:
    | { ok: true; value: T }
    | { ok: false; cause: unknown };
  try {
    outcome = { ok: true, value: await action() };
  } catch (cause) {
    outcome = { ok: false, cause };
  }
  let cleanupCause: unknown;
  try {
    await release();
  } catch (cause) {
    cleanupCause = cause;
  }
  if (!outcome.ok && cleanupCause !== undefined) {
    throw new AggregateError(
      [outcome.cause, cleanupCause],
      `${backend} readiness 探测失败且临时环境清理失败`
    );
  }
  if (cleanupCause !== undefined) throw cleanupCause;
  if (!outcome.ok) throw outcome.cause;
  return outcome.value;
}

const defaultReadinessDependencies: AcpReadinessDependencies = {
  async prepare(backend) {
    /* 固定 cwd：探测不该继承任意工作目录，也不该每次换地方——
       换地方等于让被探测的 CLI 每次都重建一遍它的缓存。 */
    const cwd = join(tmpdir(), `bottega-${backend}-readiness`);
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    return cwd;
  },
  /* "wait" only for a credential-safe probe, where it is already implied: such a lease never
     cancels a quota read. Asking the other three to wait would put a 10-second queue budget
     behind a read capped at 30 seconds, turning a user's recheck into a failed check. */
  acquire: (backend, signal, options) =>
    acquireAgentProcessLease(backend, "background", signal,
      options?.credentialSafe === true ? { credentialSafe: true, quota: "wait" } : {}),
  async probe(spec, runtime, cwd, signal) {
    const prepared = await prepareAcpReadinessLaunch(spec, runtime);
    await runPreparedAcpReadiness(spec.backend, async () => {
      /* The claim is only true under the wrapper below, and the wrapper only exists when the
         prepared environment brought read-only roots. No roots means no seatbelt and a live
         network, so refuse before spawning rather than run unsandboxed beside a quota read. */
      if (spec.credentialSafe && prepared.readOnlyRoots.length === 0) {
        throw new Error(`${spec.backend} readiness 声明了 credentialSafe，但准备的环境没有只读根，无法进入无网络 seatbelt`);
      }
      const launch = prepared.readOnlyRoots.length
        ? wrapInteractiveWithSeatbelt({
            command: prepared.launch.command,
            args: prepared.launch.args,
            env: prepared.launch.env,
            backend: spec.backend,
            permissionMode: "ask-for-approval",
            workspace: cwd,
            readOnlyRoots: prepared.readOnlyRoots,
            controlRoot: join(cwd, ".ai-chat-readiness-control"),
            agentRuntime: runtime.executable,
            network: false,
          })
        : prepared.launch;
      await inspectAcpSession(
        {
          backend: spec.backend,
          command: launch.command,
          args: launch.args,
          env: prepared.launch.env,
          cwd,
          signal,
          timeoutMs: spec.timeoutMs ?? 12_000,
          validateSessionId: spec.validateSessionId,
        },
        async () => true
      );
    }, prepared.release);
  },
};

/**
 * 诊断入口：返回结构化结论而不是布尔；认证投影是它的唯一薄壳。
 * （联通性 worker 只消费 prepareAcpReadinessLaunch 复用启动形态，不走本入口。）
 */
async function runAcpReadiness(
  spec: AcpReadinessSpec,
  runtime: ResolvedRuntime,
  signal?: AbortSignal,
  dependencies: AcpReadinessDependencies = defaultReadinessDependencies,
  onAuthenticationStarted?: () => void
): Promise<AcpReadinessReport> {
  const controller = new AbortController();
  const effectiveSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const cwd = await dependencies.prepare(spec.backend);
  const lease = await dependencies.acquire(spec.backend, AbortSignal.any([effectiveSignal, AbortSignal.timeout(CHECK_QUEUE_MS)]),
    { credentialSafe: spec.credentialSafe === true });
  try {
    onAuthenticationStarted?.();
    await dependencies.probe(spec, runtime, cwd, effectiveSignal);
    return { kind: "ready" };
  } catch (cause) {
    signal?.throwIfAborted();
    const failure = (spec.classifyFailure ?? classifyAcpFailure)(cause);
    return failure.kind === "auth-required"
      ? { kind: "auth-required", message: failure.message }
      : { kind: "failed", message: failure.message, checkIssue: (cause as Error)?.name === "TimeoutError" ? "timeout"
        : failure.failure?.code === "connection-lost" || failure.failure?.code === "service-unavailable" ? "connection" : "failed", cannotStart: confirmedStartupFailure(cause) ||
          (failure.failure?.domain === "agent-runtime" && failure.failure.code === "runtime-unavailable") };
  } finally {
    controller.abort();
    lease.release();
  }
}

function confirmedStartupFailure(cause: unknown): boolean {
  if (cause instanceof AggregateError) return cause.errors.some(confirmedStartupFailure);
  return (cause as { startupFailure?: unknown } | null)?.startupFailure === true;
}

/* 投影表：只有 proves=auth 的探针才有资格把 auth-required 提升成全局
   unauthenticated。handshake 的错误可能只属于某个 provider，保持 unknown
   并带 reason；超时/协议/cleanup 仍一律 error。 */
const PROJECTION: Record<
  AcpReadinessProof,
  Record<AcpReadinessReport["kind"], AuthCheckStatus>
> = {
  auth: {
    ready: "authenticated",
    "auth-required": "unauthenticated",
    failed: "error",
  },
  handshake: {
    ready: "unknown",
    "auth-required": "unknown",
    failed: "error",
  },
};

export function createAcpReadinessCheck(
  spec: AcpReadinessSpec,
  dependencies: AcpReadinessDependencies = defaultReadinessDependencies
) {
  /* The flag is a claim about where the probe runs, so it is refused at construction time
     rather than trusted at runtime: without a prepared environment the probe would use the
     user's real state root, where it could refresh or rewrite the very credentials a
     concurrent quota read is reading. The probe refuses the other half of the claim -- an
     environment that brings no read-only roots, and so no seatbelt -- when it prepares one. */
  if (spec.credentialSafe && !spec.prepareProcessEnvironment) {
    throw new Error(`${spec.backend} readiness 不能在没有一次性环境的情况下声明 credentialSafe`);
  }
  return async (
    runtime: ResolvedRuntime,
    signal?: AbortSignal,
    onAuthenticationStarted?: () => void
  ): Promise<AuthCheckResult> => {
    const report = await runAcpReadiness(spec, runtime, signal, dependencies, onAuthenticationStarted);
    return {
      status: PROJECTION[spec.proves][report.kind],
      ...(report.kind === "failed" ? { checkIssue: report.checkIssue } : {}),
      ...(report.kind === "failed" ? report.cannotStart ? { startup: "cannot-start" as const } : {}
        : { startup: "ready" as const }),
      ...(spec.proves === "handshake" ? { unknownReason: "provider-scoped" as const } : {}),
      ...(report.kind === "ready" ? {} : { reason: report.message }),
    };
  };
}
