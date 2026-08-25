/**
 * [INPUT]: Depends on ACP short process detection, descriptor of the AcpLauncher, selectable single process environment/readable source only, production Seatbelt, background process lease and ACP failure
 * [OUTPUT]: Provides AcpReadinessSpec, prepare/run resource binary settlement and retain reason authentication projection create AcpReadinessCheck
 * [POS]: The core of the shared 4 end without prompt readiness; The start-up mode and the state root lifecycle have a single owner
 */

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
};

export type AcpReadinessReport =
  | { kind: "ready" }
  | { kind: "auth-required"; message: string }
  | { kind: "failed"; message: string };

export type AcpReadinessDependencies = {
  prepare(backend: AgentBackendId): Promise<string>;
  acquire(
    backend: AgentBackendId,
    signal: AbortSignal
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
  acquire: (backend, signal) =>
    acquireAgentProcessLease(backend, "background", signal),
  async probe(spec, runtime, cwd, signal) {
    const prepared = await prepareAcpReadinessLaunch(spec, runtime);
    await runPreparedAcpReadiness(spec.backend, async () => {
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
  dependencies: AcpReadinessDependencies = defaultReadinessDependencies
): Promise<AcpReadinessReport> {
  const controller = new AbortController();
  const effectiveSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const cwd = await dependencies.prepare(spec.backend);
  const lease = await dependencies.acquire(spec.backend, effectiveSignal);
  try {
    await dependencies.probe(spec, runtime, cwd, effectiveSignal);
    return { kind: "ready" };
  } catch (cause) {
    signal?.throwIfAborted();
    const failure = (spec.classifyFailure ?? classifyAcpFailure)(cause);
    return failure.kind === "auth-required"
      ? { kind: "auth-required", message: failure.message }
      : { kind: "failed", message: failure.message };
  } finally {
    controller.abort();
    lease.release();
  }
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
  return async (
    runtime: ResolvedRuntime,
    signal?: AbortSignal
  ): Promise<AuthCheckResult> => {
    const report = await runAcpReadiness(spec, runtime, signal, dependencies);
    return {
      status: PROJECTION[spec.proves][report.kind],
      ...(report.kind === "ready" ? {} : { reason: report.message }),
    };
  };
}
