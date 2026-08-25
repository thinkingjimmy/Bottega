/**
 * [INPUT]: Depends on the backend, maintenance of the session/headless executor, apps/support assistant, repair prompt/finalize, RepairContext and log/static output capabilities injected
 * [OUTPUT]: Provides RepairAdapter, clone packaging, session repair on the back end of the disc and uncertified certainty lock
 * [POS]: install/repair product adaptation layer, so that AppInstaller does not know the specific Agent runtime
 */

import type { AppInstallEvent, AppManifest } from "../../../../../shared/apps-ipc";
import {
  backendById,
  backendRuntimeRegistry,
} from "../../../backends";
import { headlessExecutor } from "../../../backends/headless-executor";
import { sanitizedProcessEnvironment } from "../../../codex-runtime";
import { strippedShell } from "../../support";
import { finalizeInstall } from "../finalize";
import { createRepairPrompt } from "./prompt";
import type { RepairContext } from "./runner";

type RepairAdapterOptions = {
  userData: string;
  schemaPath: string;
  emit: (event: AppInstallEvent) => void;
  appendLog: (appId: string, line: string) => Promise<void>;
  readLogTail: (appId: string) => Promise<string>;
  validateStatic: (appDir: string, manifest: AppManifest) => Promise<void>;
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
    if (context.record.maintenanceAgent === "auto") {
      throw new Error("App 尚未钉住维护 Agent");
    }
    const descriptor = backendById(context.record.maintenanceAgent);
    if (!descriptor.maintenance || !descriptor.headless) {
      throw new Error(`${descriptor.displayName} 不支持 App 修复`);
    }
    const snapshot = await backendRuntimeRegistry.resolveForSpawn(
      descriptor.id
    );
    if (
      snapshot.runtimeStatus !== "installed" ||
      snapshot.authStatus !== "authenticated" ||
      !snapshot.capabilities.maintenance
    ) {
      throw new Error(`${descriptor.displayName} 当前不可用于 App 修复`);
    }
    const session = await descriptor.maintenance.open({
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
    const run = async (command: string, intent: string) => {
      this.options.emit({
        appId: context.record.id,
        type: "progress",
        step: `正在验证修复：${command.slice(0, 80)}`,
        operation: "repair",
      });
      const result = await context.execute({
        intent,
        ...strippedShell(command),
        cwd: context.journal.workspace,
        env: sanitizedProcessEnvironment(),
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
