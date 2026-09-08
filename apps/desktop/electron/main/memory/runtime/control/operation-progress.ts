/**
 * [INPUT]: Depends on node:crypto randomUUID, shared MemoryRuntimeOperation/Step/Snapshot, the RUNTIME_OPERATION_STEPS table, the managed RunCommand port, and launchd diagnostic tail reads
 * [OUTPUT]: Provides RuntimeOperationProgress: one operation framed at a time, step sequencing verified against the step table, a bounded log ring with throttled publishing, redacted failure recording with service-log tails, and the progress facts projected into snapshots
 * [POS]: The coordinator's progress ledger; it owns every operation/step/log/error fact of the runtime snapshot so the coordinator only orchestrates
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  MemoryRuntimeOperation,
  MemoryRuntimeSnapshot,
  MemoryRuntimeStep,
} from "../../../../../shared/memory-ipc";
import type { RunCommand } from "../managed/install-steps";
import { RUNTIME_OPERATION_STEPS } from "../progress";
import type { MemoryRuntimeSnapshotPublisher } from "../snapshot-publisher";
import { readDiagnosticTail } from "./launchd-identity";

const LOG_LIMIT = 200;
/** uv 一行一帧会把 publish 打成噪声；日志立即追加，帧按此间隔节流。 */
const LOG_PUBLISH_INTERVAL_MS = 300;
const DIAGNOSTIC_TAIL_BYTES = 16 * 1024;
const DIAGNOSTIC_LINE_LIMIT = 60;

export type OperationProgressFacts = Pick<
  MemoryRuntimeSnapshot,
  | "operation"
  | "operationId"
  | "step"
  | "stepIndex"
  | "stepTotal"
  | "operationStartedAt"
  | "log"
  | "error"
>;

export class RuntimeOperationProgress {
  private operation: MemoryRuntimeOperation | null = null;
  private operationId: string | null = null;
  /* 一个字段，不是两个：从前 step（人话）与 stepKind（身份）并存，
     人话那份一路烤进快照直送界面，把中文钉死在了主进程里。 */
  private step: MemoryRuntimeStep | null = null;
  private stepIndex = 0;
  private stepTotal = 0;
  private operationStartedAt: number | null = null;
  private log: string[] = [];
  private error: string | null = null;

  constructor(
    private readonly ports: {
      runCommand: RunCommand;
      publish: MemoryRuntimeSnapshotPublisher["publish"];
      redactDiagnostic(detail: string): Promise<string>;
      /** Directory holding server.log / server.err.log for failure tails. */
      logRoot: string;
    }
  ) {}

  get active() {
    return this.operation;
  }

  facts(): OperationProgressFacts {
    return {
      operation: this.operation,
      operationId: this.operationId,
      step: this.step,
      stepIndex: this.stepIndex,
      stepTotal: this.stepTotal,
      operationStartedAt: this.operationStartedAt,
      log: [...this.log],
      error: this.error,
    };
  }

  /** Frames one operation: fresh ledger, full step-table consumption, redacted failure, reset. */
  async run<T>(operation: MemoryRuntimeOperation, action: () => Promise<T>) {
    this.operation = operation;
    this.operationId = `op_${randomUUID().replaceAll("-", "")}`;
    this.error = null;
    this.log = [];
    this.step = null;
    this.stepIndex = 0;
    this.stepTotal = RUNTIME_OPERATION_STEPS[operation].length;
    this.operationStartedAt = Date.now();
    await this.ports.publish({ transfer: null });
    try {
      const result = await action();
      if (this.stepIndex !== this.stepTotal) {
        throw new Error(
          `运行时步骤未收敛：${this.stepIndex}/${this.stepTotal}`
        );
      }
      return result;
    } catch (cause) {
      await this.recordFailure(cause);
      throw new Error(this.error ?? "运行时操作失败", {
        cause: cause instanceof Error ? cause : undefined,
      });
    } finally {
      this.operation = null;
      this.step = null;
      this.stepIndex = 0;
      this.stepTotal = 0;
      this.operationStartedAt = null;
      await this.ports.publish({ transfer: null });
    }
  }

  async beginStep<T>(step: MemoryRuntimeStep, action: () => Promise<T>) {
    if (!this.operation) throw new Error("运行时步骤缺少活动操作");
    const expected = RUNTIME_OPERATION_STEPS[this.operation][this.stepIndex];
    if (expected !== step.kind) {
      throw new Error(
        `运行时步骤顺序错误：期望 ${expected ?? "结束"}，实得 ${step.kind}`
      );
    }
    this.step = step;
    this.stepIndex += 1;
    /* 日志是技术流水，记身份而非译文：它要能被 grep、能跨语言比对，
       与界面上那句读给人听的话本就不是同一种东西。 */
    this.appendLog(`— ${step.kind}`);
    await this.ports.publish();
    return action();
  }

  async exec(
    command: string,
    args: string[],
    options: { timeoutMs: number; env?: Record<string, string> }
  ) {
    let lastPublishedAt = 0;
    try {
      await this.ports.runCommand(command, args, {
        timeoutMs: options.timeoutMs,
        ...(options.env ? { env: options.env } : {}),
        onLine: (line) => {
          this.appendLog(line);
          const now = Date.now();
          if (now - lastPublishedAt < LOG_PUBLISH_INTERVAL_MS) return;
          lastPublishedAt = now;
          void this.ports.publish().catch(() =>
            console.warn("[memory] runtime progress publish failed")
          );
        },
      });
    } finally {
      /* 尾帧必发：被节流吞掉的最后几行常常正是失败原因。 */
      await this.ports.publish().catch(() =>
        console.warn("[memory] runtime progress publish failed")
      );
    }
  }

  appendLog(line: string) {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
  }

  private async recordFailure(cause: unknown) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    const message = await this.ports
      .redactDiagnostic(rawMessage)
      .catch(() => "运行时操作失败");
    /* 只留原因，不拼「某步失败：」——那句前缀 renderer 已按 step 身份
       翻译着加了一遍（memory.runtime.stepFailed），两处各加一次，界面上
       读到的是「X failed: X失败：真正的原因」。 */
    this.error = message;
    this.appendLog(`× ${this.step?.kind ?? "operation"}: ${message}`);

    if (this.step?.kind !== "bootstrap" && this.step?.kind !== "await-ready") return;
    for (const file of ["server.err.log", "server.log"]) {
      const tail = await readDiagnosticTail(
        join(this.ports.logRoot, file),
        DIAGNOSTIC_TAIL_BYTES
      );
      if (!tail.trim()) continue;
      const safe = await this.ports.redactDiagnostic(tail).catch(() => "");
      const lines = safe
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(-DIAGNOSTIC_LINE_LIMIT);
      if (!lines.length) continue;
      this.appendLog(`— 本地服务日志 ${file}`);
      for (const line of lines) this.appendLog(line);
    }
  }
}
