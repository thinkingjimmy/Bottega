/**
 * [INPUT]: Depends on Node detached spawn, Agent process supervisor, process-group cleanup and AbortSignal
 * [OUTPUT]: Provides run SupervisedCommand with signal-aware waitForSharedFlight: community collection, shared diagnostics of de-sensitivity, timeout/abort/EPIPE, register Failed clearance owner and settled barrier
 * [POS]: The short-commands backends the host of the probe; Non-ACP subprocesses such as Model Directories can no longer use the uncontrolled execFile
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import {
  assertAgentProcessAdmission,
  registerAuxiliaryAgentProcess,
  reportAgentCleanupFailure,
} from "../agent-process-supervisor";
import { asError } from "../errors";
import { cleanProcessGroup } from "../process-group";
import {
  acpDiagnosticRedactionOptions,
  redactAcpDiagnostic,
} from "./acp/trace";

const STDERR_TAIL_BYTES = 64 * 1024;

type Registration = ReturnType<typeof registerAuxiliaryAgentProcess>;

export type SupervisedCommandOptions = {
  backend: AgentBackendId;
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBuffer: number;
  label: string;
  signal?: AbortSignal;
};

export type SupervisedCommandDependencies = {
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

function appendTail(current: Buffer, chunk: Buffer, limit: number) {
  const joined = Buffer.concat([current, chunk]);
  return joined.byteLength <= limit
    ? joined
    : Buffer.from(joined.subarray(joined.byteLength - limit));
}

function abortCause(signal: AbortSignal) {
  return signal.reason ?? new DOMException("命令探针已取消", "AbortError");
}

/** 后加入者只取消自己的等待；共享 flight 仍由首 caller 的 signal 持有。 */
export function waitForSharedFlight<T>(
  promise: Promise<T>,
  signal?: AbortSignal
) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason ??
          new DOMException("模型目录等待已取消", "AbortError")
      );
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function diagnosticError(cause: unknown, env: NodeJS.ProcessEnv) {
  const source = asError(cause);
  const error = new Error(
    redactAcpDiagnostic(source.message, acpDiagnosticRedactionOptions(env))
  );
  error.name = source.name;
  return error;
}

async function cleanupRegistrationFailure(
  options: SupervisedCommandOptions,
  child: ChildProcessWithoutNullStreams,
  cause: unknown,
  dependencies: SupervisedCommandDependencies,
  settle: () => void
): Promise<never> {
  const cleanup = child.pid
    ? await (dependencies.cleanProcessGroup ?? cleanProcessGroup)(child.pid)
        .catch((cleanupCause) => ({
          ok: false as const,
          error: asError(cleanupCause),
        }))
    : ({ ok: true } as const);
  settle();
  if (!cleanup.ok) {
    const cleanupError = diagnosticError(cleanup.error, options.env);
    const registrationError = diagnosticError(cause, options.env);
    (dependencies.reportCleanupFailure ?? reportAgentCleanupFailure)(
      options.backend,
      cleanupError
    );
    throw new AggregateError(
      [registrationError, cleanupError],
      `${options.label} 登记失败且进程组清理失败`
    );
  }
  throw diagnosticError(cause, options.env);
}

export async function runSupervisedCommand(
  options: SupervisedCommandOptions,
  dependencies: SupervisedCommandDependencies = {}
) {
  options.signal?.throwIfAborted();
  (dependencies.assertAdmission ?? assertAgentProcessAdmission)(
    options.backend
  );
  const child = (dependencies.spawnProcess ?? spawn)(
    options.command,
    options.args,
    {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      detached: true,
      env: options.env,
    }
  );
  /* register 是 spawn 后的第二道 admission；若它拒绝，清理期间仍可能收到
     异步 spawn error，必须先有 listener 才能安全 await 进程组回收。 */
  child.once("error", () => undefined);
  let finishSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    finishSettled = resolve;
  });
  let unregister: Registration;
  try {
    unregister = (
      dependencies.registerProcess ?? registerAuxiliaryAgentProcess
    )(options.backend, child, settled);
  } catch (cause) {
    return cleanupRegistrationFailure(
      options,
      child,
      cause,
      dependencies,
      finishSettled
    );
  }

  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrTail = Buffer.alloc(0);
  let failOutput!: (cause: Error) => void;
  const outputFailure = new Promise<never>((_resolve, reject) => {
    failOutput = reject;
  });
  child.stdout.on("data", (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > options.maxBuffer) {
      failOutput(new Error(`${options.label} 输出超过大小上限`));
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on("data", (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    stderrTail = appendTail(stderrTail, chunk, STDERR_TAIL_BYTES);
  });
  /* 短命令可能在 stdin.end() 前已经退出；pipe 的 EPIPE 也是这次命令的
     终态原因，必须进入同一 race，绝不能落成 EventEmitter 未处理异常。 */
  child.stdin.once("error", (cause) => failOutput(asError(cause)));
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${options.label} 超时`)),
      options.timeoutMs
    );
    timeout.unref?.();
  });
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!options.signal) return;
    onAbort = () => reject(abortCause(options.signal!));
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    child.stdin.end();
  } catch (cause) {
    failOutput(asError(cause));
  }

  let outcome:
    | { ok: true; stdout: string }
    | { ok: false; cause: unknown };
  let cleanupError: Error | undefined;
  try {
    const exit = await Promise.race([
      closed,
      deadline,
      aborted,
      outputFailure,
    ]);
    if (exit.code !== 0) {
      const tail = stderrTail.toString("utf8").trim();
      throw new Error(
        `${options.label} 退出（code=${String(exit.code)}, signal=${String(
          exit.signal
        )}）${tail ? `：${tail}` : ""}`
      );
    }
    outcome = { ok: true, stdout: Buffer.concat(stdout).toString("utf8") };
  } catch (cause) {
    outcome = { ok: false, cause: diagnosticError(cause, options.env) };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort && options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
    try {
      const cleanup = child.pid
        ? await (dependencies.cleanProcessGroup ?? cleanProcessGroup)(child.pid)
        : ({ ok: true } as const);
      if (!cleanup.ok) {
        cleanupError = diagnosticError(cleanup.error, options.env);
      }
    } catch (cause) {
      cleanupError = diagnosticError(cause, options.env);
    }
    if (cleanupError) {
      (dependencies.reportCleanupFailure ?? reportAgentCleanupFailure)(
        options.backend,
        cleanupError,
        unregister.owner
      );
    } else {
      unregister();
    }
    finishSettled();
  }
  if (cleanupError) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.cause, cleanupError],
        `${options.label} 失败且进程组清理失败`
      );
    }
    throw cleanupError;
  }
  if (!outcome.ok) throw outcome.cause;
  return { stdout: outcome.stdout };
}
