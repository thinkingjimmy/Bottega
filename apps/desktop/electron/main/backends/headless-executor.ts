/**
 * [INPUT]: Depends on BackendDescriptor headlessSpec, macOS seatbelt, Node detached spawn, process-group and per-backend process supervisor
 * [OUTPUT]: Provides unique HeadlessExecutor: pass through admission/identity review/re-analysis and sync spawn/register window deadline signal; typified preflight abort; runtime snapshot; executor/confirmed backend OS fences (with spec readOnlyRoots only); asynchronous spec; prepared with the correct release (preflight failed to be recycled and refused; finalize recycled after process group clearance); output budget; 64KiB stderr evidence loop; close-independent cleanup finalizer for register hook; doubleThe result of the cancellation and cleanup is that the hook is not re-routed
 * [POS]: The host of the non-interactive process backends; The default unified seatbelt, only the enforcement matrix has been confirmed that the back end can declare the native OS sandbox
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
  acquireAgentProcessLease,
  isAgentProcessAdmissionError,
  registerAuxiliaryAgentProcess,
  reportAgentCleanupFailure,
} from "../agent-process-supervisor";
import type {
  AgentProcessLease,
  AuxiliaryProcessRegistration,
} from "../agent-process-supervisor";
import { backendRuntimeRegistry } from "./index";
import { asError } from "../errors";
import { cleanProcessGroup } from "../process-group";
import { AcpByteTail } from "./acp/startup/evidence";
import {
  acpDiagnosticRedactionOptions,
  redactAcpDiagnostic,
} from "./acp/trace";
import {
  validateCredentialRoots,
  wrapWithSeatbelt,
  type SeatbeltOptions,
} from "./sandbox/seatbelt";
import type {
  BackendDescriptor,
  HeadlessExecutionSpec,
  HeadlessJob,
  HeadlessParserState,
  HeadlessRun,
  ResolvedRuntime,
} from "./types";
import type { BackendRuntimeSnapshot } from "./runtime-registry";

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
/** 终态错误里携带的 stderr 尾巴上限；完整环仍是 64KiB，报文只取末尾。 */
const STDERR_DIAGNOSTIC_LIMIT = 2_048;

export class HeadlessPreflightAbortError extends Error {
  readonly name = "HeadlessPreflightAbortError";

  constructor(readonly originalCause: unknown) {
    super(asError(originalCause).message);
  }
}

class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T) {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader) reader({ done: false, value });
    else this.values.push(value);
  }

  end() {
    this.ended = true;
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.ended) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => this.readers.push(resolve));
      },
    };
  }
}

export class HeadlessExecutor {
  constructor(
    private readonly dependencies: {
      spawnProcess?: (
        command: string,
        args: readonly string[],
        options: SpawnOptionsWithoutStdio
      ) => ChildProcessWithoutNullStreams;
      cleanProcessGroup?: typeof cleanProcessGroup;
      seatbelt?: SeatbeltOptions;
      acquireLease?: typeof acquireAgentProcessLease;
      registerAuxiliary?: typeof registerAuxiliaryAgentProcess;
      resolveRuntime?: (
        descriptor: BackendDescriptor,
        signal: AbortSignal
      ) => Promise<ResolvedRuntime>;
    } = {}
  ) {}

  run(
    descriptor: BackendDescriptor,
    job: HeadlessJob,
    options: {
      signal?: AbortSignal;
      snapshot?: BackendRuntimeSnapshot;
    } = {}
  ): HeadlessRun {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    let lease: AgentProcessLease | undefined;
    const ready = Promise.resolve()
      .then(async () => {
        lease = await (
          this.dependencies.acquireLease ?? acquireAgentProcessLease
        )(descriptor.id, "background", signal);
        signal.throwIfAborted();
        const runtime = await this.runtimeForRun(
          descriptor,
          options.snapshot,
          signal
        );
        signal.throwIfAborted();
        return this.runStarted(descriptor, job, runtime, signal);
      })
      .catch((cause) => {
        if (
          !signal.aborted ||
          isAgentProcessAdmissionError(cause) ||
          cause instanceof HeadlessPreflightAbortError
        ) {
          throw cause;
        }
        throw new HeadlessPreflightAbortError(cause);
      });
    const settled = ready
      .then((active) => active.settled)
      .finally(() => {
        lease?.release();
        lease = undefined;
      });
    const result = ready.then((active) => active.result);
    /* runStarted 可能在 caller 拿到句柄前因 admission/hook 主动结算；公开
       Promise 仍保持拒绝语义，但内部先挂 rejection observer，禁止冒泡成
       unhandledRejection。 */
    void settled.catch(() => undefined);
    void result.catch(() => undefined);
    const events: HeadlessRun["events"] = {
      async *[Symbol.asyncIterator]() {
        const active = await ready;
        yield* active.events;
      },
    };
    return {
      events,
      result,
      settled,
      cancel: async () => {
        controller.abort();
        const active = await ready.catch(() => undefined);
        if (active) await active.cancel();
        await settled.catch(() => undefined);
      },
    };
  }

  private async runStarted(
    descriptor: BackendDescriptor,
    job: HeadlessJob,
    runtime: ResolvedRuntime,
    signal: AbortSignal
  ): Promise<HeadlessRun> {
    signal.throwIfAborted();
    if (!descriptor.headless?.purposes.includes(job.purpose)) {
      throw new Error(`${descriptor.displayName} 不支持 ${job.purpose} headless job`);
    }
    const backendSpec = await descriptor.headless.spec(job, runtime);
    if (!backendSpec) throw new Error(`${descriptor.displayName} 未提供 headless spec`);
    /* spec 交出的那一刻起，它预备的一次性产物归 executor 所有。memoized
       promise 保证 preflight 失败与 finalize 两条路径恰好回收一次；回收
       自身的失败不吞掉，以返回值交给调用侧归因。 */
    let releaseOnce: Promise<Error | undefined> | undefined;
    const releaseSpec = () =>
      (releaseOnce ??= Promise.resolve()
        .then(() => backendSpec.release?.())
        .then(
          () => undefined,
          (cause) => asError(cause)
        ));
    try {
      signal.throwIfAborted();
      return await this.spawnRun(descriptor, job, backendSpec, releaseSpec, signal);
    } catch (cause) {
      const releaseError = await releaseSpec();
      if (releaseError) {
        throw new AggregateError(
          [asError(cause), releaseError],
          `${descriptor.displayName} headless preflight 失败且一次性状态根回收失败`
        );
      }
      throw cause;
    }
  }

  private async spawnRun(
    descriptor: BackendDescriptor,
    job: HeadlessJob,
    backendSpec: HeadlessExecutionSpec,
    releaseSpec: () => Promise<Error | undefined>,
    signal: AbortSignal
  ): Promise<HeadlessRun> {
    validateCredentialRoots(
      descriptor.id,
      job,
      backendSpec,
      this.dependencies.seatbelt
    );
    const spec =
      backendSpec.osSandbox === "backend"
        ? backendSpec
        : wrapWithSeatbelt(job, backendSpec, {
            ...this.dependencies.seatbelt,
            backend: descriptor.id,
            protectedReadOnlyRoots: [
              ...(this.dependencies.seatbelt?.protectedReadOnlyRoots ?? []),
              ...(backendSpec.readOnlyRoots ?? []),
            ],
          });
    const child = (this.dependencies.spawnProcess ?? spawn)(
      spec.command,
      spec.args,
      {
        cwd: job.cwd,
        detached: true,
        env: spec.env,
      }
    );
    const queue = new EventQueue<HeadlessParserState["events"][number]>();
    const state: HeadlessParserState = { text: "", events: [] };
    let outputBytes = 0;
    /* stderr 是死因证据：与 ACP 同一条 64KiB 字节环纪律，空 stdout 退出时
       终态错误不至于两手空空。 */
    const stderrTail = new AcpByteTail(MAX_STDERR_BYTES);
    const stderrEvidence = () => {
      const tail = stderrTail.text().trim();
      if (!tail) return "";
      return redactAcpDiagnostic(
        tail,
        acpDiagnosticRedactionOptions(spec.env)
      ).slice(-STDERR_DIAGNOSTIC_LIMIT);
    };
    let buffer = "";
    let terminalError: Error | undefined;
    let lifecycleError: Error | undefined;
    let closed = false;
    let stopping = false;
    let childFailedBeforeFinalizer = false;
    const cleanupRequest: {
      run?: () => Promise<Awaited<ReturnType<typeof cleanProcessGroup>>>;
    } = {};
    let cleanupPromise: Promise<Awaited<ReturnType<typeof cleanProcessGroup>>> | undefined;
    let settle!: () => void;
    const processSettled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    /* spawn 已发生后，supervisor register 仍可能因 shutdown/safety-lock
       失败。先接住异步 spawn error，再清理整个 detached 进程组；run() 外层
       的 lease 只会在本 async 函数拒绝后释放，不留下无 owner 的孤儿。 */
    child.once("error", (cause) => {
      terminalError ??= cause;
      childFailedBeforeFinalizer = true;
      void cleanupRequest.run?.();
    });
    let unregister: AuxiliaryProcessRegistration;
    try {
      unregister = (
        this.dependencies.registerAuxiliary ?? registerAuxiliaryAgentProcess
      )(descriptor.id, child, processSettled);
    } catch (cause) {
      const cleanup = child.pid
        ? await (this.dependencies.cleanProcessGroup ?? cleanProcessGroup)(
            child.pid
          ).catch((cleanupCause) => ({
            ok: false as const,
            error: asError(cleanupCause),
          }))
        : ({ ok: true } as const);
      settle();
      if (!cleanup.ok) {
        reportAgentCleanupFailure(descriptor.id, cleanup.error);
        throw new AggregateError(
          [cause, cleanup.error],
          `${descriptor.displayName} headless 登记失败且进程组清理失败`
        );
      }
      throw cause;
    }

    const cleanup = async () => {
      cleanupPromise ??= Promise.resolve()
        .then(() =>
          child.pid
            ? (this.dependencies.cleanProcessGroup ?? cleanProcessGroup)(
                child.pid
              )
            : ({ ok: true } as const)
        )
        .catch((cause) => ({ ok: false as const, error: asError(cause) }));
      const result = await cleanupPromise;
      if (!result.ok) {
        reportAgentCleanupFailure(
          descriptor.id,
          result.error,
          unregister.owner
        );
      }
      return result;
    };
    let finishSettled!: (
      result:
        | { ok: true; value: Awaited<ReturnType<typeof cleanProcessGroup>> }
        | { ok: false; error: Error }
    ) => void;
    const completion = new Promise<
      | { ok: true; value: Awaited<ReturnType<typeof cleanProcessGroup>> }
      | { ok: false; error: Error }
    >((resolve) => {
      finishSettled = resolve;
    });
    let completionFinished = false;
    const resolveCompletion = (
      result:
        | { ok: true; value: Awaited<ReturnType<typeof cleanProcessGroup>> }
        | { ok: false; error: Error }
    ) => {
      if (completionFinished) return;
      completionFinished = true;
      finishSettled(result);
    };
    const recordLifecycleError = (hook: string, cause: unknown) => {
      const error = new Error(
        `${job.purpose} ${hook} hook 失败：${asError(cause).message}`
      );
      lifecycleError ??= error;
      terminalError ??= error;
      return error;
    };
    const processGroupReady =
      child.pid && job.onProcessGroup
        ? Promise.resolve()
            .then(() => job.onProcessGroup!(child.pid!))
            .then(
              () => ({ ok: true as const }),
              (cause) => ({
                ok: false as const,
                error: recordLifecycleError("onProcessGroup", cause),
              })
            )
        : Promise.resolve({ ok: true as const });
    let abortObserved = false;
    const onAbort = () => {
      if (abortObserved) return;
      abortObserved = true;
      terminalError ??= asError(
        signal.reason ?? new DOMException("headless 已取消", "AbortError")
      );
      void cleanupRequest.run?.();
    };
    let finalization:
      | Promise<Awaited<ReturnType<typeof cleanProcessGroup>>>
      | undefined;
    const finalize = () => {
      stopping = true;
      finalization ??= (async () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        /* 清理立即开始以阻断进程继续运行，但 supervisor 事务必须等登记
           hook 落定；否则 close/abort/timeout 会在 pending hook 前偷跑注销。 */
        const [cleanupResult, groupReady] = await Promise.all([
          cleanup(),
          processGroupReady,
        ]);
        if (
          cleanupResult.ok &&
          groupReady.ok &&
          child.pid &&
          job.onProcessExit
        ) {
          try {
            await job.onProcessExit(child.pid);
          } catch (cause) {
            recordLifecycleError("onProcessExit", cause);
          }
        }
        /* 一次性状态根在进程组清理落定后回收；残根不是安全事故但必须如实
           上抛，与 cleanup 失败走同一条 completion 归因路径。 */
        const releaseError = await releaseSpec();
        if (releaseError) recordLifecycleError("release", releaseError);
        if (cleanupResult.ok) unregister();
        settle();
        queue.end();
        if (lifecycleError) {
          reportAgentCleanupFailure(descriptor.id, lifecycleError);
        }
        const completionErrors = [
          ...(lifecycleError ? [lifecycleError] : []),
          ...(!cleanupResult.ok ? [cleanupResult.error] : []),
        ];
        if (completionErrors.length > 1) {
          resolveCompletion({
            ok: false,
            error: new AggregateError(
              completionErrors,
              `${descriptor.displayName} headless 生命周期与清理失败`
            ),
          });
        } else if (completionErrors[0]) {
          resolveCompletion({ ok: false, error: completionErrors[0] });
        } else {
          resolveCompletion({ ok: true, value: cleanupResult });
        }
        return cleanupResult;
      })();
      return finalization;
    };
    const recordStdinError = (cause: unknown) => {
      terminalError ??= asError(cause);
      void finalize();
    };
    child.stdin.once("error", recordStdinError);
    void processGroupReady.then((outcome) => {
      if (!outcome.ok) void finalize();
    });
    const timeout = setTimeout(() => {
      terminalError ??= new Error(`${job.purpose} 超过 ${job.timeoutMs}ms`);
      void finalize();
    }, job.timeoutMs);
    cleanupRequest.run = finalize;
    if (childFailedBeforeFinalizer) void finalize();
    signal.addEventListener("abort", onAbort, { once: true });
    /* AbortSignal 不重放事件；spawn/register 注入点可能已同步 abort。listener
       安装后的状态复核把这个窗口并回同一个 cleanup finalizer。 */
    if (signal.aborted) onAbort();

    const parseLine = (line: string) => {
      if (!line.trim()) return;
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        terminalError ??= new Error("headless 单行输出超过 1MB");
        void finalize();
        return;
      }
      const before = state.events.length;
      spec.parseLine(line, state);
      for (const event of state.events.slice(before)) queue.push(event);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (stopping) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminalError ??= new Error("headless 输出超过 32MB");
        void finalize();
        return;
      }
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) parseLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail.write(chunk);
    });

    child.once("close", (code, exitSignal) => {
      const alreadyStopping = stopping;
      closed = true;
      if (!alreadyStopping && buffer) parseLine(buffer);
      if (!alreadyStopping && code !== 0 && !terminalError) {
        const evidence = stderrEvidence();
        terminalError = new Error(
          `${descriptor.displayName} headless 退出（code=${String(code)}, signal=${
            exitSignal ?? "null"
          }）${evidence ? `：${evidence}` : ""}`
        );
      }
      void finalize();
    });
    const settled = completion.then((outcome) => {
      if (!outcome.ok) {
        queue.end();
        throw outcome.error;
      }
      return outcome.value;
    });

    const result = settled.then(() => {
      if (terminalError) throw terminalError;
      if (state.error) throw new Error(state.error);
      return {
        text: state.text,
        ...(state.json === undefined ? {} : { json: state.json }),
      };
    });
    const run: HeadlessRun = {
      events: queue,
      result,
      cancel: async () => {
        terminalError ??= new Error(`${job.purpose} 已取消`);
        await finalize();
        /* cancel 只承诺「停下并等清理收敛」；清理/生命周期错误统一经
           settled/result 上抛。让 cancel 重抛会使 shutdown 侧的
           Promise.all 在首个失败处弃管其余兄弟 run。 */
        await settled.catch(() => undefined);
      },
      settled,
    };
    void processGroupReady.then(
      (outcome) => {
        if (!outcome.ok) return;
        if (closed || stopping) return;
        try {
          child.stdin.end(
            spec.stdin ??
              [
                job.prompt,
                job.untrustedContent
                  ? `\n<untrusted>\n${job.untrustedContent}\n</untrusted>`
                  : "",
              ].join("")
          );
        } catch (cause) {
          recordStdinError(cause);
        }
      }
    );
    return run;
  }

  private async resolveRuntime(
    descriptor: BackendDescriptor,
    signal: AbortSignal
  ) {
    const snapshot = await backendRuntimeRegistry.resolveForSpawn(
      descriptor.id,
      signal
    );
    if (
      snapshot.runtimeStatus !== "installed" ||
      snapshot.authStatus !== "authenticated"
    ) {
      throw new Error(
        `${descriptor.displayName} 后台任务需要已安装且已认证的 CLI`
      );
    }
    if (!snapshot.capabilities.headless.length) {
      throw new Error(`${descriptor.displayName} 后台能力未开放`);
    }
    return snapshot.runtime;
  }

  private async runtimeForRun(
    descriptor: BackendDescriptor,
    snapshot: BackendRuntimeSnapshot | undefined,
    signal: AbortSignal
  ) {
    if (snapshot?.runtimeStatus === "installed") {
      if (
        this.dependencies.spawnProcess ||
        await backendRuntimeRegistry.confirmForSpawn(
          descriptor.id,
          snapshot,
          signal
        )
      ) {
        return snapshot.runtime;
      }
    }
    if (this.dependencies.resolveRuntime) {
      return this.dependencies.resolveRuntime(descriptor, signal);
    }
    if (this.dependencies.spawnProcess) {
      return {
        executable: `/test/${descriptor.id}`,
        path: "/test",
        version: "999.999.999",
      };
    }
    return this.resolveRuntime(descriptor, signal);
  }

}

export const headlessExecutor = new HeadlessExecutor();
