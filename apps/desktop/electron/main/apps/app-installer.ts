/**
 * [INPUT]: Depends on Node process/fs/path, backend execution, install/repair kernels, AppSourceMonitor, the shared AppMutationCoordinator, packet contract fingerprint, MaintenanceGate, AppStore, AppRuntime, and support assistant
 * [OUTPUT]: Provides serialized per-App install/repair/edit rebuilds, held-lane source reconciliation, stale-receipt rejection, cancellation, extension confirmation, legacy runtime delivery, and compiled Base staging without stop-before-build
 * [POS]: Apps supply-chain coordinator; it turns mutable source trees into validated runtime generations while AppSourceMonitor owns observation inside the same mutation lane
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  appSourceStateOf,
  repairSite,
  servesWebRuntime,
  type AppFailurePhase,
  type AppInstallEvent,
  type AppManifest,
  type AppRecord,
} from "../../../shared/apps-ipc";
import {
  sanitizedProcessEnvironment,
} from "../codex-runtime";
import { backendById, backendRuntimeRegistry } from "../backends";
import { headlessExecutor } from "../backends/headless-executor";
import { acquireAgentProcessLease } from "../agent-process-supervisor";
import { stopProcessGroup } from "../process-group";
import { AppRuntime } from "./app-runtime";
import { AppStore } from "./app-store";
import { createInstallAnalysisPrompt } from "./install/install-prompt";
import {
  APP_MANIFEST_JSON_SCHEMA,
  appManifestSchema,
} from "./install/manifest-schema";
import { finalizeInstall } from "./install/finalize";
import {
  declineExtension,
  inspectExtension,
  type ExtensionDecision,
  type ExtensionPlan,
} from "./install/extension";
import {
  abortTaskBeforeCommit,
  drainSerialTasks,
  type InstallTask,
  type QueuedWork,
  SerialTaskQueue,
} from "./install/task-queue";
import { RepairAdapter } from "./install/repair/adapter";
import { type RepairContext, RepairRunner } from "./install/repair/runner";
import { MaintenanceGate } from "./maintenance-gate";
import { asError } from "../errors";
import { isContained, strippedShell } from "./support";
import {
  AppMutationCoordinator,
  assertAppSourceReceipt,
} from "./app-source-coordinator";
import { AppSourceMonitor } from "./app-source-monitor";

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const NAMING_STUDIO_URL =
  "https://github.com/thinkingjimmy/codex-naming-studio";

type ExecuteOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  task: InstallTask;
  stdin?: string;
  allowFailure?: boolean;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
};

type ExecuteResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class AppInstaller {
  private readonly tasks = new SerialTaskQueue();
  private readonly sourceMonitor: AppSourceMonitor;
  private readonly repairs: RepairRunner;
  private worker: Promise<void> | null = null;
  private readonly schemaPath: string;

  constructor(
    private readonly userData: string,
    private readonly store: AppStore,
    private readonly runtime: AppRuntime,
    private readonly emit: (event: AppInstallEvent) => void,
    private readonly appendLog: (appId: string, line: string) => Promise<void>,
    private readonly confirmExtensions: (
      record: AppRecord,
      details: string[]
    ) => Promise<boolean>,
    private readonly maintenanceGate: MaintenanceGate,
    readLogTail: (appId: string) => Promise<string>,
    private readonly mutations = new AppMutationCoordinator(),
    sourceMonitorIntervalMs = 30_000
  ) {
    this.schemaPath = join(userData, "manifest-schema.json");
    this.sourceMonitor = new AppSourceMonitor(
      userData,
      store,
      mutations,
      (record, task) =>
        this.execute(
          "git",
          ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          { cwd: record.dir, env: sanitizedProcessEnvironment(), task }
        ).then((result) => result.stdout),
      () => this.localTask(),
      sourceMonitorIntervalMs
    );
    const repairAdapter = new RepairAdapter({
      userData,
      schemaPath: this.schemaPath,
      emit,
      appendLog,
      readLogTail,
      validateStatic: (appDir, manifest) =>
        this.validateStaticArtifact(appDir, manifest),
    });
    this.repairs = new RepairRunner({
      userData,
      store,
      runtime,
      gate: maintenanceGate,
      emit,
      appendLog,
      clone: (context) => repairAdapter.clone(context),
      repairSession: (context) => repairAdapter.runSession(context),
      finalize: (context, candidate) => repairAdapter.finalize(context, candidate),
      allocatePort: () => this.runtime.allocateRepairPort(),
      auditBinding: (port, processGroup) =>
        this.runtime.auditRepairBinding(port, processGroup),
      inspectExtension,
      confirmExtension: (record, plan) => this.confirmExtension(record, plan),
      applyExtension: (context, plan) =>
        this.applyExtension(context.record, context.record.dir, context.task, plan, context),
      fingerprint: async (record, task) =>
        (await this.sourceMonitor.inspect(record, task)).fingerprint,
      persistFingerprint: async (appId, fingerprint) => {
        await this.sourceMonitor.writeBaseline(appId, fingerprint);
      },
    });
  }

  async initialize() {
    await writeFile(
      this.schemaPath,
      `${JSON.stringify(APP_MANIFEST_JSON_SCHEMA, null, 2)}\n`,
      { mode: 0o600 }
    );
    await this.repairs.initialize();
    await this.sourceMonitor.initialize();
  }

  enqueue(appId: string) {
    if (this.tasks.has(appId)) {
      throw new Error("该 App 已在安装队列中");
    }
    this.tasks.enqueue({ kind: "install", appId });
    this.emit({ appId, type: "progress", step: "排队中", operation: "install" });
    this.startWorker();
  }

  async enqueueRepair(appId: string) {
    if (this.tasks.has(appId)) throw new Error("该 App 已在任务队列中");
    await this.repairs.assertCanEnqueue(appId);
    const record = this.store.get(appId);
    if (!record) throw new Error("App 不存在");
    const site = repairSite(record);
    if (!site) throw new Error("当前失败阶段不能使用 Agent 修复");
    const runId = `r-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    this.tasks.enqueue({ kind: "repair", appId, site, runId });
    this.emit({ appId, type: "progress", step: "修复排队中", operation: "repair" });
    this.startWorker();
  }

  async cancel(appId: string) {
    const task = this.tasks.get(appId);
    if (!task) return;
    const error = new Error("用户取消");
    abortTaskBeforeCommit(task, error);
    await Promise.allSettled(
      [...task.pids].map((pid) => stopProcessGroup(pid))
    );
    const queued = this.tasks.takeQueued(appId);
    if (queued) {
      try {
        const record = this.store.get(appId);
        if (record?.state === "installing") {
          await this.markInstallFailed(appId, "clone", error);
        } else if (record?.state === "updating") {
          await this.store.update(appId, (current) => ({
            ...current,
            state: "update-failed",
            lastError: { phase: "update", message: "用户取消" },
          }));
        }
      } finally {
        this.tasks.complete(appId);
      }
    }
    await task.settled;
  }

  async retryInstall(appId: string) {
    const record = this.store.get(appId);
    if (!record || record.state !== "install-failed") {
      throw new Error("当前状态不能干净重装");
    }
    await this.store.update(appId, (current) => ({
      ...current,
      state: "installing",
      lastError: null,
      agentWarning: null,
      manifest: null,
    }));
    this.enqueue(appId);
  }

  async retryUpdate(appId: string) {
    const record = this.store.get(appId);
    if (!record || record.state !== "update-failed") {
      throw new Error("当前状态不能重试更新");
    }
    await this.rebuildAfterEdit(appId, true);
  }

  rebuildAfterEdit(appId: string, force = false) {
    return this.serializeMutation(appId, () =>
      this.rebuildAfterEditLocked(appId, force)
    );
  }

  rebuildAfterEditHeld(appId: string, force = false) {
    return this.rebuildAfterEditLocked(appId, force);
  }

  async reconcileSourceHeld(appId: string) {
    await this.sourceMonitor.reconcileHeld(appId);
  }

  private async rebuildAfterEditLocked(appId: string, force = false) {
    if (this.maintenanceGate.isLocked(appId)) throw new Error("App 修复中");
    const record = this.store.get(appId);
    if (!record?.manifest || !["ready", "update-failed"].includes(record.state)) {
      throw new Error("App 尚未就绪");
    }
    const task = this.localTask();
    let changedPaths: string[] = [];
    try {
      const changes = await this.sourceMonitor.inspect(record, task);
      changedPaths = changes.paths;
      await this.sourceMonitor.persist(appId, changes.fingerprint);
      const previousFingerprint = await this.sourceMonitor.readBaseline(appId);
      if (previousFingerprint && !force && previousFingerprint === changes.fingerprint) {
        return;
      }
      const editedManifest = appManifestSchema.parse(
        JSON.parse(await readFile(join(record.dir, "app.json"), "utf8"))
      );
      if (editedManifest.kind !== record.manifest.kind) {
        throw new Error("编辑不能改变 App kind");
      }

      await this.store.update(appId, (current) => ({
        ...current,
        state: "updating",
        lastError: null,
      }));
      this.emit({ appId, type: "progress", step: "正在应用 Agent 修改", operation: "update" });
      await this.appendLog(appId, "\n===== 编辑后更新 =====");
      /* compiled Base edits stage against an immutable snapshot while the previous
         sealed GUI remains active; only the later generation cutover may retire it. */
      if (!(editedManifest.kind === "base" && editedManifest.gui?.build)) {
        await this.runtime.stop(appId);
      }

      if (servesWebRuntime(editedManifest) && editedManifest.buildCmd) {
        await this.runShell(
          appId,
          editedManifest.buildCmd,
          record.dir,
          task,
          "正在重新构建",
          "update"
        );
      }
      if (
        changedPaths.some((path) =>
          /(^|\/)(\.agent-plugin|\.agent|skills|mcp)(\/|$)/.test(path)
        )
      ) {
        const plan = await inspectExtension(record.dir);
        if (plan && (await this.confirmExtension(record, plan)) === "approved") {
          await this.applyExtension(record, record.dir, task, plan);
        }
      }
      if (editedManifest.kind === "static") {
        await this.validateStaticArtifact(record.dir, editedManifest);
      }
      const publishFingerprint = await this.sourceMonitor.inspect(record, task);
      const sourceReceipt = await this.sourceMonitor.persist(
        appId,
        publishFingerprint.fingerprint
      );
      const ready = await this.store.publishGeneration(appId, (current) => {
        assertAppSourceReceipt(appSourceStateOf(current), sourceReceipt);
        return {
          ...current,
          manifest: editedManifest,
          state: "ready",
          lastError: null,
        };
      });
      if (servesWebRuntime(ready.manifest)) {
        await this.runtime.ensureRunning(appId);
      }
      const applied = await this.sourceMonitor.inspect(ready, task);
      await this.sourceMonitor.writeBaseline(appId, applied.fingerprint);
    } catch (cause) {
      const error = asError(cause);
      await this.store.update(appId, (current) => ({
        ...current,
        state: "update-failed",
        lastError: { phase: "update", message: error.message },
      }));
      await this.appendLog(appId, `[update:error] ${error.message}`);
      throw error;
    } finally {
      const latest = this.store.get(appId);
      if (latest) {
        await this.sourceMonitor.inspect(latest, task)
          .then((value) => this.sourceMonitor.persist(appId, value.fingerprint))
          .catch((cause) =>
            console.warn("[apps] source fingerprint final reconcile failed", cause)
          );
      }
    }
  }

  async shutdown() {
    await this.sourceMonitor.shutdown();
    await Promise.allSettled(
      this.tasks.entries().map(([appId]) => this.cancel(appId))
    );
    await this.worker;
    await this.mutations.drain();
  }

  private startWorker() {
    if (this.worker) return;
    this.worker = this.processQueue().finally(() => {
      this.worker = null;
      if (this.tasks.hasQueued()) this.startWorker();
    });
  }

  private async processQueue() {
    await drainSerialTasks(
      this.tasks,
      (appId, task, work) => this.runWork(appId, task, work),
      (appId, cause, work) => this.reportUnexpectedTaskFailure(appId, cause, work)
    );
  }

  private async runWork(appId: string, task: InstallTask, work: QueuedWork) {
    return this.serializeMutation(appId, () =>
      this.runWorkLocked(appId, task, work)
    );
  }

  private async runWorkLocked(appId: string, task: InstallTask, work: QueuedWork) {
    if (work.kind === "install") return this.installOne(appId, task);
    const timeout = setTimeout(() =>
      task.controller.abort(new Error("修复超过 30 分钟")), INSTALL_TIMEOUT_MS);
    try {
      await this.repairs.run(appId, work.site, work.runId, task);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async installOne(appId: string, task: InstallTask) {
    const record = this.store.get(appId);
    if (!record) return;
    const staging = join(this.store.appsRoot, ".staging", appId);
    const finalDir = record.dir;
    let phase: AppFailurePhase = "clone";
    const timeout = setTimeout(
      () => task.controller.abort(new Error("安装超过 30 分钟")),
      INSTALL_TIMEOUT_MS
    );
    try {
      await this.appendLog(appId, `\n===== 安装 ${new Date().toISOString()} =====`);
      await rm(staging, { recursive: true, force: true });
      await rm(finalDir, { recursive: true, force: true });
      await mkdir(staging, { recursive: true, mode: 0o700 });

      this.emit({ appId, type: "progress", step: "正在克隆仓库", operation: "install" });
      await this.execute(
        "git",
        [
          "clone",
          requireSourceRepoUrl(record),
          ".",
          "--depth",
          "1",
        ],
        {
          cwd: staging,
          env: sanitizedProcessEnvironment(),
          task,
          onStdout: (line) => void this.log(appId, `[clone] ${line}`),
          onStderr: (line) => void this.log(appId, `[clone] ${line}`),
        }
      );

      phase = "manifest";
      const candidate = await this.analyze(record, staging, task);
      const manifest = await finalizeInstall(staging, candidate, {
        runInstall: async (command) => {
          phase = "install";
          await this.runShell(appId, command, staging, task, "正在安装依赖");
        },
        runBuild: async (command) => {
          phase = "build";
          await this.runShell(appId, command, staging, task, "正在构建");
        },
        validateStatic: (value) => this.validateStaticArtifact(staging, value),
      });
      const plan = await inspectExtension(staging);
      const decision = plan
        ? await this.confirmExtension(record, plan)
        : "none";
      const deliveredManifest =
        decision === "declined" ? declineExtension(manifest) : manifest;
      await rename(staging, finalDir);
      // marketplace source 会被 Codex 固化为绝对路径，扩展必须在交付目录上注册。
      if (plan && decision === "approved") {
        await this.applyExtension(record, finalDir, task, plan);
      }
      const delivered = { ...record, dir: finalDir };
      const baseline = await this.sourceMonitor.inspect(delivered, task);
      const sourceReceipt = await this.sourceMonitor.writeBaseline(
        appId,
        baseline.fingerprint
      );
      await this.store.publishGeneration(appId, (current) => {
        assertAppSourceReceipt(appSourceStateOf(current), sourceReceipt);
        return {
          ...current,
          state: "ready",
          lastError: null,
          manifest: deliveredManifest,
        };
      }, { generationSourceDir: finalDir });
      this.emit({ appId, type: "progress", step: "安装完成", operation: "install" });
    } catch (cause) {
      const signalReason = task.controller.signal.reason;
      const error = task.controller.signal.aborted
        ? asError(signalReason ?? "用户取消")
        : asError(cause);
      await Promise.allSettled([
        rm(staging, { recursive: true, force: true }),
        rm(finalDir, { recursive: true, force: true }),
        this.sourceMonitor.removeBaseline(appId),
      ]);
      await this.markInstallFailed(appId, phase, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async analyze(
    record: AppRecord,
    staging: string,
    task: InstallTask
  ) {
    if (record.maintenanceAgent === "auto") {
      throw new Error("App 尚未钉住维护 Agent");
    }
    const descriptor = backendById(record.maintenanceAgent);
    if (!descriptor.maintenance || !descriptor.headless) {
      throw new Error(`${descriptor.displayName} 不支持 App 安装分析`);
    }
    const runtime = await this.maintenanceRuntime(descriptor.id);
    const session = await descriptor.maintenance.open({
      userData: this.userData,
      appId: record.id,
      workspace: staging,
      runtime,
    });
    this.emit({
      appId: record.id,
      type: "progress",
      step: `${descriptor.displayName} 正在只读分析`,
      operation: "install",
    });
    const run = headlessExecutor.run(descriptor, session.createJob({
      purpose: "install-analysis",
      cwd: staging,
      prompt: createInstallAnalysisPrompt(requireSourceRepoUrl(record)),
      outputSchema: this.schemaPath,
      sandbox: "read-only",
      network: false,
      timeoutMs: INSTALL_TIMEOUT_MS,
      onProcessGroup: (pid) => {
        task.pids.add(pid);
      },
      onProcessExit: (pid) => {
        task.pids.delete(pid);
      },
    }));
    const cancel = () => void run.cancel().catch(() => undefined);
    task.controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await run.result;
      await this.log(record.id, `[manifest] ${result.text}`);
      return appManifestSchema.parse(
        result.json ?? JSON.parse(result.text)
      );
    } finally {
      task.controller.signal.removeEventListener("abort", cancel);
    }
  }

  private async validateStaticArtifact(
    appDir: string,
    manifest: AppManifest
  ) {
    if (manifest.kind !== "static") throw new Error("manifest 不是 static App");
    const appReal = await realpath(appDir);
    const directory = resolve(appDir, manifest.staticDir);
    const directoryReal = await realpath(directory);
    if (!isContained(appReal, directoryReal)) {
      throw new Error("staticDir 通过符号链接逃逸 App 目录");
    }
    const index = await realpath(join(directoryReal, "index.html"));
    if (!isContained(directoryReal, index)) {
      throw new Error("index.html 通过符号链接逃逸 staticDir");
    }
    await access(index);
  }

  private async confirmExtension(
    record: AppRecord,
    plan: ExtensionPlan
  ): Promise<ExtensionDecision> {
    if (record.sourceRepoUrl === NAMING_STUDIO_URL) return "approved";
    return (await this.confirmExtensions(record, plan.details))
      ? "approved"
      : "declined";
  }

  private async applyExtension(
    record: AppRecord,
    appDir: string,
    task: InstallTask,
    plan: ExtensionPlan,
    repairContext?: RepairContext
  ) {
    if (record.maintenanceAgent === "auto") {
      throw new Error("App 尚未钉住维护 Agent");
    }
    const descriptor = backendById(record.maintenanceAgent);
    if (!descriptor.maintenance) {
      throw new Error(`${descriptor.displayName} 不支持 App 扩展配置`);
    }
    const runtime = await this.maintenanceRuntime(descriptor.id);
    const session = await descriptor.maintenance.open({
      userData: this.userData,
      appId: record.id,
      workspace: appDir,
      runtime,
    });
    const lease = await acquireAgentProcessLease(
      descriptor.id,
      "background",
      task.controller.signal
    );
    try {
      await session.applyExtension({
        userData: this.userData,
        record,
        appDir,
        value: plan,
        appendLog: (line) => this.appendLog(record.id, line),
        execute: async (executable, args, options) => {
          if (repairContext) {
            return repairContext.execute({
              intent: "apply-extension",
              executable,
              args,
              cwd: options.cwd,
              env: options.env,
              signal: task.controller.signal,
              allowFailure: options.allowFailure,
            });
          }
          return this.execute(executable, args, { ...options, task });
        },
      });
    } finally {
      lease.release();
    }
  }

  private async maintenanceRuntime(
    backend: Parameters<typeof backendById>[0]
  ) {
    const descriptor = backendById(backend);
    const snapshot = await backendRuntimeRegistry.resolveForSpawn(backend);
    if (
      snapshot.runtimeStatus !== "installed" ||
      snapshot.authStatus !== "authenticated" ||
      !snapshot.capabilities.maintenance
    ) {
      throw new Error(`${descriptor.displayName} 当前不可用于 App 维护`);
    }
    return snapshot.runtime;
  }

  private serializeMutation<T>(appId: string, operation: () => Promise<T>) {
    return this.mutations.run(appId, operation);
  }

  private localTask(): InstallTask {
    return {
      controller: new AbortController(),
      pids: new Set<number>(),
      started: true,
      commitStarted: false,
      settled: Promise.resolve(),
    };
  }

  private async markInstallFailed(
    appId: string,
    phase: AppFailurePhase,
    error: Error
  ) {
    if (!this.store.get(appId)) return;
    await this.store.update(appId, (current) => ({
      ...current,
      state: "install-failed",
      lastError: { phase, message: error.message },
      manifest: null,
    }));
    await this.appendLog(appId, `[${phase}:error] ${error.message}`).catch(
      (cause) => console.error("[apps] 无法写入安装失败日志", cause)
    );
  }

  private async reportUnexpectedTaskFailure(
    appId: string,
    cause: unknown,
    work: QueuedWork
  ) {
    const error = asError(cause);
    console.error(`[apps] install worker appId=${appId}`, error);
    const record = this.store.get(appId);
    if (work.kind === "repair") {
      await this.appendLog(appId, `[repair:fatal] ${error.message}`).catch(() => {});
    } else if (record?.state === "installing") {
      await this.markInstallFailed(appId, "install", error).catch(
        (secondary) =>
          console.error(`[apps] 无法收尾失败任务 appId=${appId}`, secondary)
      );
    }
  }

  private runShell(
    appId: string,
    command: string,
    cwd: string,
    task: InstallTask,
    step: string,
    operation: "install" | "update" = "install"
  ) {
    this.emit({
      appId,
      type: "progress",
      step: `${step}：${command.slice(0, 80)}`,
      operation,
    });
    const shell = strippedShell(command);
    return this.execute(shell.executable, shell.args, {
      cwd,
      env: sanitizedProcessEnvironment(),
      task,
      onStdout: (line) => void this.log(appId, `[command] ${line}`),
      onStderr: (line) => void this.log(appId, `[command:stderr] ${line}`),
    });
  }

  private execute(
    executable: string,
    args: string[],
    options: ExecuteOptions
  ) {
    return new Promise<ExecuteResult>((resolvePromise, reject) => {
      if (options.task.controller.signal.aborted) {
        reject(asError(options.task.controller.signal.reason ?? "操作已取消"));
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, args, {
          cwd: options.cwd,
          detached: true,
          env: options.env,
        });
      } catch (cause) {
        reject(asError(cause));
        return;
      }
      let stdout = "";
      let stderr = "";
      let spawned = false;
      const onAbort = () => {
        const pid = child.pid;
        if (pid) void stopProcessGroup(pid);
      };
      options.task.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const stdoutLines = createInterface({ input: child.stdout });
      const stderrLines = createInterface({ input: child.stderr });
      stdoutLines.on("line", (line) => options.onStdout?.(line));
      stderrLines.on("line", (line) => options.onStderr?.(line));
      child.once("spawn", () => {
        spawned = true;
        if (child.pid) options.task.pids.add(child.pid);
        if (options.stdin !== undefined) child.stdin.end(options.stdin);
        else child.stdin.end();
      });
      child.once("error", (error) => {
        options.task.controller.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code) => {
        options.task.controller.signal.removeEventListener("abort", onAbort);
        const pid = child.pid;
        if (pid) options.task.pids.delete(pid);
        void (async () => {
          if (pid) await stopProcessGroup(pid);
          const result = { code: code ?? 1, stdout, stderr };
          if (options.task.controller.signal.aborted) {
            reject(
              asError(options.task.controller.signal.reason ?? "操作已取消")
            );
          } else if (result.code === 0 || options.allowFailure) {
            resolvePromise(result);
          } else {
            const detail = stderr.trim() || stdout.trim();
            reject(
              new Error(
                `${executable} 退出 code=${result.code}${detail ? `：${detail.slice(-1_000)}` : ""}`
              )
            );
          }
        })().catch(reject);
      });
      if (!spawned && options.task.controller.signal.aborted) onAbort();
    });
  }

  private log(appId: string, line: string) {
    return this.appendLog(appId, line);
  }
}

function requireSourceRepoUrl(record: AppRecord) {
  if (!record.sourceRepoUrl) {
    throw new Error("Web App 缺少 GitHub 导入来源");
  }
  return record.sourceRepoUrl;
}
