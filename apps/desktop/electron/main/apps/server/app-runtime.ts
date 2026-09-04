/**
 * [INPUT]: Depends on Node child_process/readline, backend runtime registry/headless executor, authorized App config, platform server-App policy, runtime audit/events, custody, store, gateway, and maintenance gate
 * [OUTPUT]: Provides AppRuntime for static/server generations; unsupported platform server Apps fail before custody, lsof, or spawn, and only web-runtime Apps can ever be branded start-failed
 * [POS]: The non-permanent mode of operation of the apps module is the only source of truth, and the end of its life cycle is empty; Process truth is always in the ProcessCustodyJournal, and no PID tables are created in this category
 */

import {
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  servesWebRuntime,
  type AppGeneration,
  type AppRequirement,
  type AppInstallEvent,
  type AppRecord,
  type ServerAppManifest,
} from "../../../../shared/apps-ipc";
import { platformCapabilityUnavailable } from "../../../../shared/platform-capabilities";
import { sanitizedProcessEnvironment } from "../../codex-runtime";
import { backendById, backendRuntimeRegistry } from "../../backends";
import { headlessExecutor } from "../../backends/headless-executor";
import { acquireAgentProcessLease } from "../../agent-process-supervisor";
import type {
  HeadlessRun,
  MaintenanceSession,
} from "../../backends/types";
import { stopProcessGroup, wait } from "../../process-group";
import { AppGateway } from "../gateway/app-gateway";
import { AppStore } from "../store/app-store";
import { MaintenanceGate } from "../maintenance/maintenance-gate";
import {
  assertLoopbackListeners,
  parseLsofListeners,
} from "../runtime/listener-audit";
import {
  asSettled,
  settleRuntimeStop,
} from "../runtime/lifecycle";
import {
  createServeLoop,
  hasServeContract,
  type ServeLoop,
} from "../runtime/serve-loop";
import { asError } from "../../errors";
import { strippedShell } from "../support";
import type { AppProcessCustodyEntry } from "../../../../shared/app-lifecycle";
import type {
  AppServerCustodyHandle,
  AppServerCustodyRuntime,
} from "../runtime/server-custody";
import type { AgentToolInventory } from "../runtime/agent-tools";

const START_TIMEOUT_MS = 60_000;
const AGENT_TURN_TIMEOUT_MS = 10 * 60_000;

type RuntimeEntry = {
  promise: Promise<{ origin: string }>;
  startupSettled: Promise<void>;
  agentSettled?: Promise<void>;
  serveLoop?: ServeLoop;
  /** guardian 进程；它是 detached 组长，真正的 App binary 是它的子进程 */
  child?: ChildProcessWithoutNullStreams;
  agentRun?: HeadlessRun;
  controller: AbortController;
  stopping: boolean;
  custody?: AppServerCustodyHandle;
  /** 收口单飞：崩溃退出与显式 stop 可能同时到达，两次 settle 会撞 revision */
  settled?: Promise<AppProcessCustodyEntry | undefined>;
};

/** 交付给 App binary 的可写根；activation-authorized 之前它不出现在任何 env 里。 */
export const APP_DATA_ENV = "APP_DATA_DIR";

export class AppRuntime {
  private readonly running = new Map<string, RuntimeEntry>();

  constructor(
    private readonly userData: string,
    private readonly store: AppStore,
    private readonly gateway: AppGateway,
    private readonly maintenanceGate: MaintenanceGate,
    private readonly emit: (event: AppInstallEvent) => void,
    private readonly appendLog: (appId: string, line: string) => Promise<void>,
    private readonly configEnvironment: (
      appId: string,
      requirements: readonly AppRequirement[]
    ) => Promise<NodeJS.ProcessEnv> = async () => ({}),
    private readonly serverCustody?: AppServerCustodyRuntime,
    private readonly epochRoot: (appId: string, dataEpochId: string) => string = (
      appId,
      dataEpochId
    ) => join(this.userData, "app-data", appId, dataEpochId),
    private readonly serverAppsEnabled = true
  ) {}

  /** Settings 现检与启动校验共用 maintenance adapter 的结构化 inventory。 */
  async inspectToolInventory(appId: string): Promise<AgentToolInventory | null> {
    const record = this.store.get(appId);
    if (!record) throw new Error("App 不存在");
    if (record.maintenanceAgent === "auto") return null;
    const descriptor = backendById(record.maintenanceAgent);
    if (!descriptor.maintenance) return null;
    const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
    if (
      snapshot.runtimeStatus !== "installed" ||
      snapshot.authStatus !== "authenticated"
    ) {
      return null;
    }
    const session = await descriptor.maintenance.open({
      userData: this.userData,
      appId: record.id,
      workspace: record.dir,
      runtime: snapshot.runtime,
    });
    const lease = await acquireAgentProcessLease(descriptor.id, "background");
    try {
      return await session.inspectToolInventory(record.dir) as AgentToolInventory;
    } finally {
      lease.release();
    }
  }

  ensureRunning(appId: string) {
    if (this.maintenanceGate.isLocked(appId)) {
      return Promise.reject(new Error("App 修复中，暂时无法启动"));
    }
    const existing = this.running.get(appId);
    if (existing) return existing.promise;

    const entry: RuntimeEntry = {
      promise: Promise.resolve({ origin: "" }),
      startupSettled: Promise.resolve(),
      controller: new AbortController(),
      stopping: false,
    };
    entry.promise = this.start(appId, entry).catch((cause) =>
      this.handleStartFailure(appId, entry, cause)
    );
    entry.startupSettled = asSettled(entry.promise);
    this.running.set(appId, entry);
    return entry.promise;
  }

  /**
   * 先撤 route 与 durable「打算释放」，再发信号，最后用精确进程组退出证据收口。
   * 反过来做的话，「发过 kill」就会被当成已释放——而那正是 orphan 的来源。
   */
  async stop(appId: string) {
    const entry = this.running.get(appId);
    if (!entry) {
      this.gateway.unregister(appId);
      return;
    }
    entry.controller.abort(new Error("App runtime stopped"));
    entry.serveLoop?.dispose();
    this.gateway.unregister(appId);
    try {
      await entry.custody?.beginRelease();
      await settleRuntimeStop(entry, () => this.stopKnownProcesses(entry));
      const settled = await this.settleCustody(entry);
      if (settled && settled.phase !== "released" && settled.phase !== "aborted") {
        /* 说不清那个 PID 是不是还活着：不发第二次信号，App 留在 quarantine，
           由启动 reconcile 与恢复面继续收敛。 */
        throw Object.assign(
          new Error(
            `APP_SERVER_CUSTODY_UNSETTLED: ${appId} 的进程状态无法确认（${settled.phase}）`
          ),
          { status: 409 }
        );
      }
    } finally {
      /* 抛不抛都要摘牌：留一条死 entry 在表里，这个 App 从此既起不来也停不掉，
         连删都删不掉——收割结论是另一回事，登记表必须先回到干净状态。 */
      if (this.running.get(appId) === entry) {
        this.running.delete(appId);
        this.gateway.unregister(appId);
        this.emit({ appId, type: "runtime", state: "stopped" });
      }
    }
  }

  /** 崩溃退出与显式 stop 可能同时到达；收口只允许发生一次。 */
  private settleCustody(entry: RuntimeEntry) {
    entry.settled ??= entry.custody
      ? entry.custody.settle()
      : Promise.resolve(undefined);
    return entry.settled;
  }

  private async handleStartFailure(
    appId: string,
    entry: RuntimeEntry,
    cause: unknown
  ): Promise<never> {
    const intentionalStop = entry.stopping;
    const error = asError(cause);
    entry.stopping = true;
    entry.controller.abort(error);
    entry.serveLoop?.dispose();
    try {
      await this.stopKnownProcesses(entry);
    } catch (cleanupCause) {
      throw new AggregateError(
        [error, cleanupCause],
        `App 启动失败且进程清理失败：${error.message}`
      );
    }
    /* 收口判据只有一条：intent 从未 spawn → 永久 aborted tombstone；
       已有身份 → 必须按 identity 退出才 released，说不清就 quarantine。
       「revision 等于几」不是证据，绝不用它猜进程死没死。 */
    await this.settleCustody(entry).catch((cleanupCause) =>
      this.appendLog(
        appId,
        `[runtime] custody 收口失败：${asError(cleanupCause).message}`
      )
    );
    if (this.running.get(appId) === entry) {
      this.running.delete(appId);
      this.gateway.unregister(appId);
    }
    const record = this.store.get(appId);
    /* 只有真的有 web runtime 的 App 才可能「启动失败」。Base App 根本没有这条
       生命线，对它调 start 是调用方的契约违约；把违约记成 App 自身的
       update-failed，会让一次调用错误变成永久变砖（状态非 ready 之后
       surface/grant/Design enabled 全线关门），故此处按资格收窄。 */
    if (!intentionalStop && record?.state === "ready" && servesWebRuntime(record.manifest)) {
      await this.store.update(appId, (current) => ({
        ...current,
        state: "update-failed",
        lastError: { phase: "start", message: error.message },
      }));
    }
    throw error;
  }

  private async stopKnownProcesses(entry: RuntimeEntry) {
    const pids = [entry.child?.pid].filter(
      (pid): pid is number => Boolean(pid)
    );
    const results = await Promise.allSettled(
      [
        ...pids.map((pid) => stopProcessGroup(pid)),
        ...(entry.agentRun ? [entry.agentRun.cancel()] : []),
      ]
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "App 进程组清理失败");
    }
  }

  allocateRepairPort() {
    return this.gateway.allocateUpstreamPort();
  }

  auditRepairBinding(port: number, processGroup: number) {
    return this.auditLoopbackBinding(port, processGroup);
  }

  async shutdown() {
    await Promise.all([...this.running.keys()].map((appId) => this.stop(appId)));
    await this.gateway.close();
  }

  getOrigin(appId: string) {
    return this.gateway.getOrigin(appId);
  }

  isRunning(appId: string) {
    return this.running.has(appId);
  }

  private async start(appId: string, entry: RuntimeEntry) {
    const record = this.store.get(appId);
    if (
      !record?.manifest ||
      (record.state !== "ready" && record.state !== "updating")
    ) {
      throw new Error("App 尚未安装完成");
    }
    const manifest = record.manifest;
    const active = record.generationBinding.active;
    const generation = record.generations.find(
      (item) => item.generationId === active?.generationId
    );
    if (!active || !generation) throw new Error("App active generation 无效");
    if (!servesWebRuntime(manifest)) {
      throw new Error("Base App 不启动 Web runtime");
    }
    if (manifest.kind === "static") {
      await this.gateway.registerStatic(
        appId,
        join(
          this.store.contentRoot(record.id, generation.generationId),
          manifest.staticDir
        ),
        {
          generationId: active.generationId,
          lifecycleRevision: record.lifecycleRevision,
        }
      );
    } else {
      if (!this.serverAppsEnabled) throw platformCapabilityUnavailable("serverApps");
      await this.startServer(record, manifest, generation, active, entry);
    }

    if (entry.stopping) throw new Error("App 启动已取消");
    const result = { origin: this.gateway.getOrigin(appId) };
    this.emit({ appId, type: "runtime", state: "running" });
    if (hasServeContract(manifest)) {
      entry.agentSettled = this.startAgentLoop(
        record,
        entry,
        manifest.serveAgentPrompt,
        manifest
      );
    }
    return result;
  }

  /**
   * D29：intent → capability-free guardian → owned → activation-authorized
   * → 经 authenticated channel 交付 sealed code/data epoch → activated。
   *
   * 顺序不可交换：sealed root、data epoch 与 App env 全程扣在 main 手里，
   * guardian spawn 时只带控制通道三件套；durable 授权点先于能力出门，
   * 于是重启永远知道「那个进程有没有可能已经在写这份数据」。
   */
  private async startServer(
    record: AppRecord,
    manifest: ServerAppManifest,
    generation: AppGeneration,
    active: NonNullable<AppRecord["generationBinding"]["active"]>,
    entry: RuntimeEntry
  ) {
    if (active.runtime.kind !== "server") {
      throw new Error("server App 缺少 data epoch binding");
    }
    if (!this.serverCustody) {
      throw new Error("App server custody 尚未装配，拒绝直接 spawn");
    }
    const dataEpochId = active.runtime.dataEpochId;
    const custody = await this.serverCustody.begin({
      appId: record.id,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: record.lifecycleRevision,
      dataEpochId,
    });
    entry.custody = custody;
    const upstreamPort = await this.gateway.allocateUpstreamPort();
    const command = manifest.startCmd
      .replaceAll("{PORT}", String(upstreamPort))
      .replaceAll("{HOST}", "127.0.0.1");
    const guardian = this.launchGuardian(
      record,
      generation,
      command,
      dataEpochId,
      entry
    );
    await custody.delivered;
    /* 健康检查直接打上游端口：route 要等 activated 才发布，此刻经 origin
       去探等于永远探不到（gateway 会 404），60 秒后以一句泛泛超时收场。 */
    await this.waitUntilHealthy(upstreamPort, manifest.healthPath, entry);
    if (!guardian.pid) throw new Error("App server 启动后缺少 pid");
    await this.auditLoopbackBinding(upstreamPort, guardian.pid);
    if (custody.entry.phase !== "activated") {
      throw new Error("App server custody 未到达 activated，拒绝发布 route");
    }
    await this.gateway.registerProxy(record.id, upstreamPort, {
      generationId: active.generationId,
      lifecycleRevision: record.lifecycleRevision,
    });
  }

  /**
   * guardian 是 detached 组长，App binary 是它的子进程且 `stdio:"inherit"`，
   * 所以这里拿到的 stdout/stderr 就是 App 自己的输出——日志链一格不少。
   */
  private launchGuardian(
    record: AppRecord,
    generation: AppGeneration,
    command: string,
    dataEpochId: string,
    entry: RuntimeEntry
  ) {
    const shell = strippedShell(command);
    const child = entry.custody!.launch({
      command: shell.executable,
      args: shell.args,
      // sealed code root 与 data epoch 都属于 capability：只在交付时刻出门
      cwd: this.store.contentRoot(record.id, generation.generationId),
      env: {
        ...sanitizedProcessEnvironment(),
        [APP_DATA_ENV]: this.epochRoot(record.id, dataEpochId),
      },
    });
    entry.child = child;
    this.pipeLogs(record.id, "runtime", child);
    child.once("close", (code) => {
      if (entry.child === child) entry.child = undefined;
      const current = this.running.get(record.id);
      if (current !== entry) return;
      if (entry.stopping) {
        void this.appendLog(
          record.id,
          `[runtime] 停止期间进程退出 code=${String(code)}`
        );
        return;
      }
      entry.serveLoop?.dispose();
      if (entry.agentRun) {
        void entry.agentRun.cancel().catch((cause) =>
          this.appendLog(
            record.id,
            `[agent] App 崩溃后的维护进程清理失败：${asError(cause).message}`
          )
        );
      }
      this.running.delete(record.id);
      this.gateway.unregister(record.id);
      this.emit({ appId: record.id, type: "runtime", state: "crashed" });
      /* 崩溃也要有 durable 收口：进程组确已退出才写 released，
         探不清就留 quarantine，绝不因为「close 事件到了」当作已释放。 */
      void this.settleCustody(entry).catch((cause) =>
        this.appendLog(
          record.id,
          `[runtime] 崩溃后 custody 收口失败：${asError(cause).message}`
        )
      );
      void this.appendLog(
        record.id,
        `[runtime] 进程退出 code=${String(code)}`
      );
    });
    return child;
  }

  private async waitUntilHealthy(
    upstreamPort: number,
    healthPath: string,
    entry: RuntimeEntry
  ) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    const url = `http://127.0.0.1:${upstreamPort}${healthPath}`;
    while (Date.now() < deadline && !entry.stopping) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status === 200) return;
      } catch {
        // 上游尚未监听，继续轮询。
      }
      await wait(500);
    }
    throw new Error("App 在 60 秒内未通过健康检查");
  }

  private async auditLoopbackBinding(port: number, processGroup: number) {
    const executable = process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof";
    const stdout = await new Promise<string>((resolvePromise, reject) => {
      execFile(
        executable,
        ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"],
        { env: sanitizedProcessEnvironment(), encoding: "utf8" },
        (error, stdout) => {
          if (error) {
            reject(new Error(`无法审计 App 监听地址：${error.message}`));
            return;
          }
          resolvePromise(stdout);
        }
      );
    });
    const listeners = parseLsofListeners(stdout);
    const processGroups = new Map<number, number>();
    await Promise.all(
      [...new Set(listeners.map((listener) => listener.pid))].map(
        async (pid) => {
          processGroups.set(pid, await this.processGroupId(pid));
        }
      )
    );
    assertLoopbackListeners(listeners, port, processGroup, processGroups);
  }

  private processGroupId(pid: number) {
    return new Promise<number>((resolvePromise, reject) => {
      execFile(
        "/bin/ps",
        ["-o", "pgid=", "-p", String(pid)],
        { env: sanitizedProcessEnvironment(), encoding: "utf8" },
        (error, stdout) => {
          const processGroup = Number(stdout.trim());
          if (error || !Number.isInteger(processGroup) || processGroup <= 0) {
            reject(
              new Error(
                `无法确认监听进程 ${pid} 的进程组：${error?.message ?? "无有效 PGID"}`
              )
            );
            return;
          }
          resolvePromise(processGroup);
        }
      );
    });
  }

  private async startAgentLoop(
    record: AppRecord,
    entry: RuntimeEntry,
    prompt: string,
    manifest: ServerAppManifest
  ) {
    try {
      if (entry.stopping || this.running.get(record.id) !== entry) return;
      if (record.maintenanceAgent === "auto") {
        throw new Error("App 尚未钉住维护 Agent");
      }
      const descriptor = backendById(record.maintenanceAgent);
      if (!descriptor.maintenance || !descriptor.headless) {
        throw new Error(`${descriptor.displayName} 不支持 App 伺服维护`);
      }
      const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
      if (
        snapshot.runtimeStatus !== "installed" ||
        snapshot.authStatus !== "authenticated"
      ) {
        throw new Error(`${descriptor.displayName} 当前不可用，伺服维护已暂停`);
      }
      const capabilities = snapshot.capabilities;
      if (
        !capabilities.maintenance ||
        !capabilities.headless.includes("serve")
      ) {
        throw new Error(`${descriptor.displayName} 的 App 维护运行时不可用`);
      }
      if (record.headlessConsent?.backend !== descriptor.id) {
        throw new Error(`${descriptor.displayName} 缺少无人值守维护授权`);
      }
      const session = await descriptor.maintenance.open({
        userData: this.userData,
        appId: record.id,
        workspace: record.dir,
        runtime: snapshot.runtime,
      });
      if (entry.stopping || this.running.get(record.id) !== entry) return;
      const inventoryLease = await acquireAgentProcessLease(
        descriptor.id,
        "background",
        entry.controller.signal
      );
      try {
        await this.verifyAgentTools(record, session);
      } finally {
        inventoryLease.release();
      }
      await this.setAgentWarning(record.id, null);
      await this.appendLog(record.id, "[agent] 结构化工具校验通过");

      const loop = createServeLoop({
        appId: record.id,
        userData: this.userData,
        appDir: record.dir,
        manifest,
        runAgentTurn: () =>
          this.runAgentTurn(record, entry, descriptor, session, prompt),
        appendLog: (line) => this.appendLog(record.id, line),
        setWarning: (warning) => this.setAgentWarning(record.id, warning),
      });
      entry.serveLoop = loop;
      if (entry.stopping || this.running.get(record.id) !== entry) {
        loop.dispose();
      }
      await loop.settled;
      if (entry.serveLoop === loop) entry.serveLoop = undefined;
    } catch (cause) {
      const message = asError(cause).message;
      await this.appendLog(record.id, `[agent] ${message}`).catch((error) =>
        console.error("[apps] 无法写入 Agent 错误日志", error)
      );
      if (!entry.stopping && this.running.get(record.id) === entry) {
        await this.setAgentWarning(record.id, message);
      }
    }
  }

  private async verifyAgentTools(
    record: AppRecord,
    session: MaintenanceSession
  ) {
    const manifest = record.manifest;
    const requirements =
      manifest?.kind === "server" ? manifest.agentRequirements : null;
    if (!requirements) {
      throw new Error("Agent 工具要求未记录，请干净重装此 App");
    }
    const inventory = await session.inspectToolInventory(record.dir);
    session.validateRequirements(requirements, inventory);
  }

  private async setAgentWarning(appId: string, warning: string | null) {
    const normalized = warning?.slice(0, 3_500) ?? null;
    const current = this.store.get(appId);
    if (!current || current.agentWarning === normalized) return;
    await this.store.update(appId, (record) => ({
      ...record,
      agentWarning: normalized,
    }));
  }

  private async runAgentTurn(
    record: AppRecord,
    entry: RuntimeEntry,
    descriptor: ReturnType<typeof backendById>,
    session: MaintenanceSession,
    prompt: string
  ) {
    if (entry.stopping || this.running.get(record.id) !== entry) {
      return Promise.reject(new Error("Agent 单轮已取消"));
    }
    const processEnv = await this.configEnvironment(
      record.id,
      record.manifest?.requirements?.tools ?? []
    );
    const run = headlessExecutor.run(descriptor, session.createJob({
      purpose: "serve",
      cwd: record.dir,
      prompt,
      sandbox: "workspace-write",
      network: false,
      processEnv,
      timeoutMs: AGENT_TURN_TIMEOUT_MS,
      onProcessGroup: (pid) => {
        void this.appendLog(record.id, `[agent] 单轮进程 PID=${pid} PGID=${pid}`);
      },
    }));
    entry.agentRun = run;
    return run.result
      .then((result) => result.text)
      .finally(() => {
        if (entry.agentRun === run) entry.agentRun = undefined;
      });
  }

  private pipeLogs(
    appId: string,
    prefix: string,
    child: ChildProcessWithoutNullStreams
  ) {
    const pipe = (stream: NodeJS.ReadableStream, suffix: string) => {
      const lines = createInterface({ input: stream });
      lines.on("line", (line) => {
        void this.appendLog(appId, `[${prefix}${suffix}] ${line}`);
      });
    };
    pipe(child.stdout, "");
    pipe(child.stderr, ":stderr");
  }
}
