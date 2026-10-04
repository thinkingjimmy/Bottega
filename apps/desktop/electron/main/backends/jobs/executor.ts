/**
 * [INPUT]: Depends on BackendDescriptor headlessSpec, the platform capability matrix, macOS seatbelt, the per-backend process supervisor (credential reservation, background lease) and the Provider bridge's runBridgedHeadless
 * [OUTPUT]: Reserves native credential use across quota cleanup, then freezes main-owned purpose eligibility before lease admission, then rechecks execution identity and permissions at spawn; expiry affects only new operations. It fences the spec (the shared seatbelt, or a backend's own OS sandbox once the platform matrix confirms it) and hands the sealed launch to the Provider's bridge, which host custody launches and settles; a failed hook, settle or release is the job's own error.
 * [POS]: Host for backends' non-interactive jobs; every job runs on its Provider's bridge (TASK-11 flip) — admission, lease, spec, fence and release stay here, the process belongs to host custody
 */

import {
  acquireAgentProcessLease,
  reserveAgentCredentialUse,
  isAgentProcessAdmissionError,
  } from "../../agent-process-supervisor";
import type {
  AgentProcessLease,
  } from "../../agent-process-supervisor";
import { backendRuntimeRegistry } from "../index";
import { asError } from "../../ipc/errors";
import { runBridgedHeadless } from "../../providers/host/turns/bridged-headless";
import {
  acpDiagnosticRedactionOptions,
  redactAcpDiagnostic,
} from "../acp/trace";
import {
  validateCredentialRoots,
  wrapWithSeatbelt,
  type SeatbeltOptions,
} from "../sandbox/seatbelt";
import type {
  BackendDescriptor,
  HeadlessExecutionSpec,
  HeadlessJob,
  HeadlessRun,
  ResolvedRuntime,
} from "../types";
import { matchesTarget } from "../../../../shared/agent-availability/projection";
import type { BackendRuntimeRegistry, BackendRuntimeSnapshot } from "../runtime/runtime-registry";
import {
  assertPlatformCapability,
  resolvePlatformCapabilities,
  type PlatformCapabilities,
} from "../../../../shared/platform/platform-capabilities";

/** 终态错误里携带的 stderr 尾巴上限；完整环仍是 64KiB，报文只取末尾。 */
const STDERR_DIAGNOSTIC_LIMIT = 2_048;

export class HeadlessPreflightAbortError extends Error {
  readonly name = "HeadlessPreflightAbortError";

  constructor(readonly originalCause: unknown) {
    super(asError(originalCause).message);
  }
}

export class HeadlessExecutor {
  constructor(
    private readonly dependencies: {
      runtimeRegistry?: BackendRuntimeRegistry;
      seatbelt?: SeatbeltOptions;
      acquireLease?: typeof acquireAgentProcessLease;
      resolveRuntime?: (
        descriptor: BackendDescriptor,
        signal: AbortSignal
      ) => Promise<ResolvedRuntime>;
      platformSupport?: PlatformCapabilities;
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
    if (this.dependencies.platformSupport) {
      assertPlatformCapability(
        this.dependencies.platformSupport,
        "headlessSandbox"
      );
    }
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    let lease: AgentProcessLease | undefined;
    const credentialUse = reserveAgentCredentialUse(descriptor.id);
    const ready = Promise.resolve()
      .then(async () => {
        await credentialUse.ready;
        const receipt = await this.runtimeForRun(descriptor, options.snapshot, signal, job);
        lease = await (
          this.dependencies.acquireLease ?? acquireAgentProcessLease
        )(descriptor.id, "background", signal);
        signal.throwIfAborted();
        const runtime = receipt.runtime;
        if (receipt.snapshot && receipt.target) {
          const registry = this.dependencies.runtimeRegistry ?? backendRuntimeRegistry;
          if (!await registry.confirmForSpawn(descriptor.id, receipt.snapshot, signal) ||
            !matchesTarget(receipt.target, await registry.executionTarget(descriptor.id, receipt.snapshot, job))) {
            throw new Error("Headless execution identity changed");
          }
        }
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
        credentialUse.release();
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
      return await this.spawnRun(descriptor, job, backendSpec, releaseSpec, signal, runtime);
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
    signal: AbortSignal,
    runtime: ResolvedRuntime
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
    /* Every headless job runs on its Provider's bridge (TASK-11 D8, flip): the fenced launch is sealed for host custody and the bridge
       reads the output with the shared reader; admission, lease, spec and release stay here. */
    return runBridgedHeadless({ descriptor, job, runtime, launch: { command: spec.command, args: spec.args, env: spec.env },
      stdin: spec.stdin ?? [job.prompt, job.untrustedContent ? `\n<untrusted>\n${job.untrustedContent}\n</untrusted>` : ""].join(""),
      signal, releaseSpec, stderrEvidence: (tail) => tail ? redactAcpDiagnostic(tail, acpDiagnosticRedactionOptions(spec.env)).slice(-STDERR_DIAGNOSTIC_LIMIT) : "" });
  }

  private async runtimeForRun(
    descriptor: BackendDescriptor,
    provided: BackendRuntimeSnapshot | undefined,
    signal: AbortSignal,
    job: HeadlessJob
  ) {
    const registry = this.dependencies.runtimeRegistry ?? backendRuntimeRegistry;
    if (!this.dependencies.runtimeRegistry && this.dependencies.resolveRuntime) {
      return { runtime: await this.dependencies.resolveRuntime(descriptor, signal), snapshot: undefined, target: undefined };
    }
    const snapshot = provided?.runtimeStatus === "installed" &&
      await registry.confirmForSpawn(descriptor.id, provided, signal)
      ? provided : await registry.resolveForSpawn(descriptor.id, signal);
    if (snapshot.runtimeStatus !== "installed" ||
      (await registry.operationEligibility(descriptor.id, job.purpose, job, snapshot)).decision !== "allow") {
      throw new Error(`${descriptor.displayName}: background operation authentication is not confirmed`);
    }
    // Main owns this admission receipt. Time expiry affects the next operation only.
    return Object.freeze({ runtime: snapshot.runtime, snapshot,
      target: Object.freeze(await registry.executionTarget(descriptor.id, snapshot, job)) });
  }

}

export const headlessExecutor = new HeadlessExecutor({
  platformSupport: resolvePlatformCapabilities(process.platform),
});
