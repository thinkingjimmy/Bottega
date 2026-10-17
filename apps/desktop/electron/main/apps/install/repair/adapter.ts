/**
 * [INPUT]: Reads saved App configuration through the command resolver; depends on automatic task-scoped maintenance selection, Headless execution and repair journal context.
 * [OUTPUT]: Builds qualified repair jobs with a frozen automatically selected Agent, bound to the repair workspace, cancellation and existing lease.
 * [POS]: install/repair product adaptation layer, so that AppInstaller does not know the specific Agent runtime
 */

import type { AppInstallEvent, AppManifest } from "../../../../../shared/ipc/apps/apps-ipc";
import { backendRuntimeRegistry } from "../../../backends";
import { headlessExecutor } from "../../../backends/jobs/executor";
import { sanitizedProcessEnvironment } from "../../../backends/runtime/runtime-probe";
import { resolveConfiguredAppCommand, appCommandLabel } from "../../execution/command";
import type { AppCommand } from "../../../../../shared/apps/model/apps-execution";
import { finalizeInstall } from "../finalize";
import { createRepairPrompt } from "./prompt";
import type { RepairContext } from "./runner";
import { maintenanceAgentForTask } from "../../runtime/maintenance-agent";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";

type RepairAdapterOptions = {
  userData: string;
  schemaPath: string;
  emit: (event: AppInstallEvent) => void;
  appendLog: (appId: string, line: string) => Promise<void>;
  readLogTail: (appId: string) => Promise<string>;
  validateStatic: (appDir: string, manifest: AppManifest) => Promise<void>;
  recordAgent?: (appId: string, backend: AgentBackendId) => Promise<void>;
};

export class RepairAdapter {
  constructor(private readonly options: RepairAdapterOptions) {}

  async clone(context: RepairContext) {
    this.options.emit({
      appId: context.record.id,
      type: "progress",
      step: "正在重建修复现场",
      operation: "repair",
    });
    const result = await context.execute({
      intent: "clone",
      executable: "git",
      args: [
        "clone",
        requireSourceRepoUrl(context.record),
        ".",
        "--depth",
        "1",
      ],
      cwd: context.journal.workspace,
      env: sanitizedProcessEnvironment(),
      signal: context.task.controller.signal,
    });
    await this.appendOutput(context.record.id, "repair:clone", result);
  }

  async runSession(context: RepairContext) {
    const appId = context.record.id;
    const { descriptor, maintenance } = await maintenanceAgentForTask(context.task, "repair", {
      cwd: context.journal.workspace,
      onSelected: async selected => this.options.recordAgent?.(appId, selected.descriptor.id),
    });
    const snapshot = await backendRuntimeRegistry.resolveForSpawn(
      descriptor.id
    );
    if (
      snapshot.runtimeStatus !== "installed" ||
      (await backendRuntimeRegistry.operationEligibility(descriptor.id, "repair", { cwd: context.journal.workspace, ignoreUserConfig: true }, snapshot)).decision !== "allow" ||
      !snapshot.capabilities.maintenance
    ) {
      throw new Error(`${descriptor.displayName} 当前不可用于 App 修复`);
    }
    const session = await maintenance.open({
      backend: descriptor.id,
      userData: this.options.userData,
      appId,
      workspace: context.journal.workspace,
      runtime: snapshot.runtime,
    });
    const prompt = createRepairPrompt({
      repoUrl: requireSourceRepoUrl(context.record),
      failurePhase: context.record.lastError?.phase ?? "update",
      logTail: await this.options.readLogTail(appId),
      manifest: context.journal.site === "copy" ? context.record.manifest : null,
    });
    await this.options.appendLog(appId, `\n===== 修复 ${new Date().toISOString()} =====`);
    this.options.emit({
      appId,
      type: "progress",
      step: `${descriptor.displayName} 正在诊断修复`,
      operation: "repair",
    });
    const run = headlessExecutor.run(descriptor, session.createJob({
      purpose: "repair",
      cwd: context.journal.workspace,
      prompt,
      outputSchema: this.options.schemaPath,
      sandbox: "workspace-write",
      network: true,
      timeoutMs: 30 * 60_000,
      onProcessGroup: (pid) => {
        context.task.pids.add(pid);
      },
      onProcessExit: (pid) => {
        context.task.pids.delete(pid);
      },
    }));
    const cancel = () => void run.cancel().catch(() => undefined);
    context.task.controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await run.result;
      await this.appendOutput(appId, "repair", {
        stdout: result.text,
        stderr: "",
      });
      return result.json ?? JSON.parse(result.text);
    } finally {
      context.task.controller.signal.removeEventListener("abort", cancel);
    }
  }

  finalize(context: RepairContext, candidate: unknown) {
    const run = async (command: AppCommand, intent: string) => {
      this.options.emit({
        appId: context.record.id,
        type: "progress",
        step: `正在验证修复：${appCommandLabel(command)}`,
        operation: "repair",
      });
      const result = await context.execute({
        intent,
        ...await resolveConfiguredAppCommand(command, {
          root: context.journal.workspace, userData: this.options.userData,
          appId: context.record.id, signal: context.task.controller.signal,
        }),
        signal: context.task.controller.signal,
      });
      await this.appendOutput(context.record.id, `repair:${intent}`, result);
    };
    return finalizeInstall(context.journal.workspace, candidate, {
      runInstall: (command) => run(command, "install"),
      runBuild: (command) => run(command, "build"),
      validateStatic: (manifest) =>
        this.options.validateStatic(context.journal.workspace, manifest),
    });
  }

  private async appendOutput(
    appId: string,
    prefix: string,
    result: { stdout: string; stderr: string }
  ) {
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      await this.options.appendLog(appId, `[${prefix}] ${line}`);
    }
    for (const line of result.stderr.split("\n").filter(Boolean)) {
      await this.options.appendLog(appId, `[${prefix}:stderr] ${line}`);
    }
  }
}

function requireSourceRepoUrl(record: RepairContext["record"]) {
  if (!record.sourceRepoUrl) throw new Error("Web App 缺少 GitHub 导入来源");
  return record.sourceRepoUrl;
}
