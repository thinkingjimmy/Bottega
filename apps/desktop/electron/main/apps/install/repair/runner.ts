/**
 * [INPUT]: Depends on fs/path, codex-runtime/process-group, apps/support, the store/runtime/maintenance gate, the site strategy, and the journal/supervisor pair
 * [OUTPUT]: Provides RepairRunner: lock-before-journal ordering, the seven-phase journal, fail-closed harvesting, idempotent commit, per-App startup recovery that never wedges the rest, orphan disposal, and `discard` for clean reinstall
 * [POS]: The install/repair transaction coordinator; it arranges safe ordering only, staging-vs-copy lives in site.ts, and manifest/command policy is injected by the adapter
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppInstallEvent,
  AppManifest,
  AppRecord,
} from "../../../../../shared/apps-ipc";
import type { MaintenanceGate } from "../../maintenance/maintenance-gate";
import type { AppRuntime } from "../../server/app-runtime";
import type { AppStore } from "../../store/app-store";
import { sanitizedProcessEnvironment } from "../../../codex-runtime";
import { stopProcessGroup } from "../../../process-group";
import { asError } from "../../../errors";
import { strippedShell } from "../../support";
import {
  declineExtension,
  ExtensionInfrastructureError,
  type ExtensionDecision,
  type ExtensionPlan,
} from "../extension";
import { beginTaskCommit, type InstallTask } from "../task-queue";
import {
  type RepairJournal,
  RepairJournalStore,
  type RepairPhase,
} from "./journal";
import {
  exists,
  repairSiteFor,
  type RepairSite,
  type SiteHooks,
  type SwapPresence,
} from "./site";
import {
  harvestProcess,
  runSupervised,
  type ActiveRepairProcess,
  type SupervisedOptions,
  SupervisedInfrastructureError,
} from "./supervisor";

export type RepairContext = {
  record: AppRecord;
  journal: RepairJournal;
  task: InstallTask;
  execute: (
    options: Omit<SupervisedOptions, "directory" | "nonce" | "onRegistered" | "onFinished">
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
};

export type RepairRunnerDeps = {
  userData: string;
  store: AppStore;
  runtime: AppRuntime;
  gate: MaintenanceGate;
  emit: (event: AppInstallEvent) => void;
  appendLog: (appId: string, line: string) => Promise<void>;
  clone: (context: RepairContext) => Promise<void>;
  repairSession: (context: RepairContext) => Promise<unknown>;
  finalize: (context: RepairContext, candidate: unknown) => Promise<AppManifest>;
  allocatePort: () => Promise<number>;
  auditBinding: (port: number, processGroup: number) => Promise<void>;
  inspectExtension: (appDir: string) => Promise<ExtensionPlan | null>;
  confirmExtension: (
    record: AppRecord,
    plan: ExtensionPlan
  ) => Promise<ExtensionDecision>;
  applyExtension: (
    context: RepairContext,
    plan: ExtensionPlan
  ) => Promise<void>;
  fingerprint: (record: AppRecord, task: InstallTask) => Promise<string>;
  persistFingerprint: (appId: string, fingerprint: string) => Promise<void>;
  harvest?: (process: ActiveRepairProcess) => ReturnType<typeof harvestProcess>;
};

/** 收割失败时的锁定文案，run 失败路径与启动恢复路径措辞不同。 */
type HarvestMessages = {
  mismatch: string;
  unknown: (detail: string) => string;
};

export class RepairRunner {
  readonly journals: RepairJournalStore;
  private recovering = true;
  private sequence = 0;

  constructor(private readonly deps: RepairRunnerDeps) {
    this.journals = new RepairJournalStore(deps.userData);
  }

  async initialize() {
    await this.recoverAll();
    this.recovering = false;
  }

  assertReady() {
    if (this.recovering) throw new Error("修复状态仍在恢复，请稍后重试");
  }

  async assertCanEnqueue(appId: string) {
    this.assertReady();
    if (this.deps.gate.isLocked(appId)) throw new Error("App 修复中");
    if (await this.journals.read(appId)) {
      throw new Error("App 存在未处理的 repair journal，请先手工检查");
    }
  }

  // ============================================================
  // 正向事务：prepare → 产出候选 → 扩展决议 → commit
  // catch/finally 的 fail-closed 账本逐字保留，不因重构改变语义
  // ============================================================

  async run(
    appId: string,
    siteKind: "staging" | "copy",
    runId: string,
    task: InstallTask
  ) {
    this.assertReady();
    const record = this.deps.store.get(appId);
    if (!record) return;
    const site = repairSiteFor(siteKind);
    this.deps.gate.acquire(appId, runId);
    const journal = this.newJournal(site, appId, runId);
    const context = this.context(record, journal, task);
    let completed = false;
    let retainLock = false;
    let journalWritten = false;
    try {
      if (await this.journals.read(appId)) {
        retainLock = true;
        throw new Error("App 存在未处理的 repair journal，请先手工检查");
      }
      await this.journals.write(journal);
      journalWritten = true;
      await this.setWorkingState(appId, site.workingState);
      await site.prepare(this.hooks(context), context);
      await this.advance(journal, "running");
      const manifest = await this.produceCandidate(context);
      await this.resolveExtension(context, manifest);
      await this.commit(site, context, task);
      completed = true;
    } catch (cause) {
      if (retainLock || !journalWritten) throw cause;
      if (task.commitStarted) {
        retainLock = true;
        await this.lockFailed(record, `修复提交被中断，请保留 journal 手工检查：${asError(cause).message}`);
        throw cause;
      }
      retainLock = true;
      if (await this.fail(context, asError(cause))) retainLock = false;
    } finally {
      if (completed || !retainLock) {
        this.deps.gate.release(appId, runId);
      }
    }
  }

  private newJournal(site: RepairSite, appId: string, runId: string): RepairJournal {
    const roots = { userData: this.deps.userData, appsRoot: this.deps.store.appsRoot };
    return {
      appId,
      runId,
      site: site.kind,
      phase: "preparing",
      workspace: site.workspacePath(roots, appId, runId),
      trash: site.trashPath(roots, appId, runId),
      activeProcesses: [],
    };
  }

  private hooks(context: RepairContext): SiteHooks {
    return {
      stopRuntime: () => this.deps.runtime.stop(context.record.id),
      clone: () => this.deps.clone(context),
    };
  }

  /** 阶段推进必须落盘后才算数，崩溃一致性依赖此写入顺序。 */
  private async advance(journal: RepairJournal, phase: RepairPhase) {
    journal.phase = phase;
    await this.journals.write(journal);
  }

  private async produceCandidate(context: RepairContext): Promise<AppManifest> {
    const candidate = await this.deps.repairSession(context);
    await this.advance(context.journal, "finalizing");
    const manifest = await this.deps.finalize(context, candidate);
    if (manifest.kind === "server") {
      await this.verifyServer(context, manifest);
    }
    return manifest;
  }

  private async resolveExtension(context: RepairContext, manifest: AppManifest) {
    const plan = await this.deps.inspectExtension(context.journal.workspace);
    const decision = plan
      ? await this.deps.confirmExtension(context.record, plan)
      : "none";
    context.journal.extensionPlan = plan;
    context.journal.extensionDecision = decision;
    context.journal.finalManifest =
      decision === "declined" ? declineExtension(manifest) : manifest;
  }

  private async commit(site: RepairSite, context: RepairContext, task: InstallTask) {
    beginTaskCommit(task);
    await this.advance(context.journal, "swapping");
    await site.swap(context);
    await this.advance(context.journal, "swapped");
    if ((await this.settleCommit(site, context)) !== "done") {
      // commit 前 finalManifest 必已写入 journal；缺失只可能是编程错误。
      throw new Error("repair journal 缺少 finalManifest");
    }
  }

  /**
   * swapped → configuring → committed 的幂等阶梯，正向提交与崩溃恢复共用。
   * 恢复路径缺 finalManifest 返回哨兵而非抛错，避免 recoverAll 整体 fail-closed。
   */
  private async settleCommit(
    site: RepairSite,
    context: RepairContext
  ): Promise<"done" | "missing-manifest"> {
    const journal = context.journal;
    if (journal.phase === "swapped") {
      if (!journal.finalManifest) return "missing-manifest";
      await this.persistSwapped(context, journal.finalManifest);
      await this.advance(journal, "configuring");
    }
    if (journal.phase === "configuring") {
      if (journal.extensionDecision === "approved" && journal.extensionPlan) {
        await this.applyWithWarning(context, journal.extensionPlan);
      }
      await this.markReady(context.record.id);
      await this.advance(journal, "committed");
    }
    // 先清 trash 再删 journal：中间崩溃可幂等重入 committed。
    await site.cleanupCommitted(journal);
    await this.journals.remove(context.record.id);
    return "done";
  }

  private context(record: AppRecord, journal: RepairJournal, task: InstallTask): RepairContext {
    return {
      record,
      journal,
      task,
      execute: async (options) => {
        const nonce = `${journal.runId}-${++this.sequence}`;
        return runSupervised({
          ...options,
          nonce,
          directory: join(this.deps.userData, "apps-state", "supervisor"),
          onRegistered: async (process) => {
            journal.activeProcesses.push(process);
            await this.journals.write(journal);
          },
          onFinished: async (finishedNonce) => {
            journal.activeProcesses = journal.activeProcesses.filter(
              (process) => process.nonce !== finishedNonce
            );
            await this.journals.write(journal);
          },
        });
      },
    };
  }

  private setWorkingState(appId: string, state: "installing" | "updating") {
    return this.deps.store.update(appId, (record) => ({
      ...record,
      state,
      lastError: null,
      agentWarning: null,
    }));
  }

  private markReady(appId: string) {
    return this.deps.store.update(appId, (record) => ({
      ...record,
      state: "ready",
      lastError: null,
    }));
  }

  private async lockFailed(record: AppRecord, message: string) {
    await this.deps.store.update(record.id, (current) => ({
      ...current,
      state: current.manifest ? "update-failed" : "install-failed",
      lastError: {
        phase: current.manifest ? "update" : "install",
        message,
      },
    }));
  }

  private async persistSwapped(context: RepairContext, manifest: AppManifest) {
    const delivered = { ...context.record, manifest };
    const fingerprint = await this.deps.fingerprint(delivered, context.task);
    context.journal.baselineFingerprint = fingerprint;
    await this.deps.persistFingerprint(context.record.id, fingerprint);
    await this.deps.store.publishGeneration(context.record.id, (record) => ({
      ...record,
      manifest,
    }));
  }

  private async applyWithWarning(context: RepairContext, plan: ExtensionPlan) {
    try {
      await this.deps.applyExtension(context, plan);
    } catch (cause) {
      if (
        cause instanceof ExtensionInfrastructureError ||
        cause instanceof SupervisedInfrastructureError
      ) throw cause;
      const message = asError(cause).message;
      await this.deps.store.update(context.record.id, (record) => ({
        ...record,
        agentWarning: message.slice(0, 3_500),
      }));
    }
  }

  private async verifyServer(
    context: RepairContext,
    manifest: Extract<AppManifest, { kind: "server" }>
  ) {
    const port = await this.deps.allocatePort();
    const command = manifest.startCmd
      .replaceAll("{PORT}", String(port))
      .replaceAll("{HOST}", "127.0.0.1");
    let processError: Error | null = null;
    const running = context.execute({
      intent: "server-preflight",
      ...strippedShell(command),
      cwd: context.journal.workspace,
      env: sanitizedProcessEnvironment(),
      signal: context.task.controller.signal,
    }).catch((cause) => {
      processError = asError(cause);
    });
    let active: (typeof context.journal.activeProcesses)[number] | undefined;
    try {
      const deadline = Date.now() + 60_000;
      const url = `http://127.0.0.1:${port}${manifest.healthPath}`;
      while (Date.now() < deadline) {
        if (processError) throw processError;
        active = context.journal.activeProcesses.find(
          (process) => process.intent === "server-preflight"
        );
        const healthy = await fetch(url, { redirect: "manual" })
          .then((response) => response.status === 200)
          .catch(() => false);
        if (healthy && active) {
          await this.deps.auditBinding(port, active.pgid);
          return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
      throw new Error("修复后的 server 在 60 秒内未通过健康检查");
    } finally {
      active ??= context.journal.activeProcesses.find(
        (process) => process.intent === "server-preflight"
      );
      if (active) await stopProcessGroup(active.pgid);
      await running;
    }
  }

  // ============================================================
  // fail-closed 账本：收割不干净就锁定并保留 journal，绝不清场
  // ============================================================

  private async harvestAll(
    record: AppRecord,
    journal: RepairJournal,
    messages: HarvestMessages
  ) {
    for (const process of journal.activeProcesses) {
      try {
        if ((await this.harvest(process)) === "mismatch") {
          await this.lockFailed(record, messages.mismatch);
          return false;
        }
      } catch (cause) {
        await this.lockFailed(record, messages.unknown(asError(cause).message));
        return false;
      }
    }
    return true;
  }

  private async fail(context: RepairContext, error: Error) {
    const harvested = await this.harvestAll(context.record, context.journal, {
      mismatch: "修复进程身份不匹配，已保留 journal 与现场供手工检查",
      unknown: (detail) => `修复进程收割状态未知，已保留现场：${detail}`,
    });
    if (!harvested) return false;
    await rm(context.journal.workspace, { recursive: true, force: true });
    const site = repairSiteFor(context.journal.site);
    await this.deps.store.update(context.record.id, (record) =>
      site.failedPatch(record, context.record, error)
    );
    await this.deps.appendLog(context.record.id, `[repair:error] ${error.message}`);
    await this.journals.remove(context.record.id);
    return true;
  }

  // ============================================================
  // 启动恢复：按 journal 阶段处置，未知现场保留全部证据
  // ============================================================

  private async recoverAll() {
    const names = await this.journals.list();
    for (const name of names.filter((value) => value.endsWith(".repair-journal"))) {
      const appId = name.slice(0, -".repair-journal".length);
      const journal = await this.journals.read(appId);
      if (journal) await this.recover(journal);
    }
  }

  private async recover(journal: RepairJournal) {
    this.deps.gate.acquire(journal.appId, journal.runId);
    let retainLock = false;
    try {
      const record = this.deps.store.get(journal.appId);
      if (!record) {
        retainLock = await this.recoverOrphan(journal);
        return;
      }
      const harvested = await this.harvestAll(record, journal, {
        mismatch: "修复进程身份不匹配，请手工检查 journal",
        unknown: (detail) => `修复进程收割状态未知，请手工检查 journal：${detail}`,
      });
      if (!harvested) {
        retainLock = true;
        return;
      }
      const site = repairSiteFor(journal.site);
      if (["preparing", "running", "finalizing"].includes(journal.phase)) {
        retainLock = !(await this.fail(
          this.context(record, journal, this.recoveredTask(false)),
          new Error("上次 Agent 修复被中断")
        ));
        return;
      }
      if (journal.phase === "swapping") {
        const next = await this.recoverSwapping(site, record, journal);
        if (next !== "forward") {
          retainLock = next === "locked";
          return;
        }
      }
      const context = this.context(record, journal, this.recoveredTask(true));
      if ((await this.settleCommit(site, context)) === "missing-manifest") {
        retainLock = true;
        await this.lockFailed(record, "repair journal 缺少 finalManifest");
      }
    } catch (cause) {
      /* 已经把这个 App 锁死并留下 journal，处置就到此为止：再往上抛会打断
         recoverAll，让排在后面的 App 连恢复的机会都没有，最终整个启动崩溃。 */
      retainLock = true;
      const message = asError(cause).message;
      const record = this.deps.store.get(journal.appId);
      if (record) {
        await this.lockFailed(record, `修复恢复失败，已保留 journal：${message}`);
      }
      console.error(`[apps] ${journal.appId} 的修复恢复失败，已保留现场`, cause);
    } finally {
      if (!retainLock) this.deps.gate.release(journal.appId, journal.runId);
    }
  }

  /**
   * 干净重装的前置清场：journal / workspace / trash 与维护锁全部作废。
   * 不清就是把一份「描述已经不存在的那棵树」的账本留给下次启动重放——
   * 它会把刚重装好的 App 重新标记为失败，或把上一代 manifest 再发布一次。
   */
  async discard(appId: string) {
    const journal = await this.journals.read(appId);
    if (!journal) return;
    await rm(journal.workspace, { recursive: true, force: true });
    if (journal.trash) await rm(journal.trash, { recursive: true, force: true });
    await this.journals.remove(appId);
    this.deps.gate.release(appId, journal.runId);
  }

  /** swapping 崩溃现场处置：locked 锁定 / rollback 复位并走 fail / forward 推进。 */
  private async recoverSwapping(
    site: RepairSite,
    record: AppRecord,
    journal: RepairJournal
  ): Promise<"locked" | "failed" | "forward"> {
    const disposition = site.classifySwap(await this.swapPresence(record, journal));
    if (disposition === "locked") {
      await this.lockFailed(record, "修复提交现场状态未知，请手工检查 journal");
      return "locked";
    }
    if (disposition === "rollback") {
      await site.rollback({ record, journal });
      const settled = await this.fail(
        this.context(record, journal, this.recoveredTask(false)),
        new Error("上次 Agent 修复在提交前被中断")
      );
      return settled ? "failed" : "locked";
    }
    await this.advance(journal, "swapped");
    return "forward";
  }

  private async swapPresence(
    record: AppRecord,
    journal: RepairJournal
  ): Promise<SwapPresence> {
    return {
      dir: await exists(record.dir),
      workspace: await exists(journal.workspace),
      trash: journal.trash ? await exists(journal.trash) : false,
    };
  }

  /** 崩溃恢复用的合成任务；commitStarted 决定失败路径走 fail 还是锁定。 */
  private recoveredTask(commitStarted: boolean): InstallTask {
    return {
      controller: new AbortController(),
      pids: new Set(),
      started: true,
      commitStarted,
      settled: Promise.resolve(),
    };
  }

  private async recoverOrphan(journal: RepairJournal) {
    for (const process of journal.activeProcesses) {
      try {
        if ((await this.harvest(process)) === "mismatch") return true;
      } catch {
        return true;
      }
    }
    if (["preparing", "running", "finalizing"].includes(journal.phase)) {
      if (journal.trash && await exists(journal.trash)) return true;
      await rm(journal.workspace, { recursive: true, force: true });
      await this.journals.remove(journal.appId);
      return false;
    }
    if (journal.phase === "committed") {
      await rm(journal.workspace, { recursive: true, force: true });
      if (journal.trash) await rm(journal.trash, { recursive: true, force: true });
      await this.journals.remove(journal.appId);
      return false;
    }
    // 没有 AppRecord 就无法证明正式目录与 manifest 的归属；保留全部证据。
    return true;
  }

  private harvest(process: ActiveRepairProcess) {
    return this.deps.harvest?.(process) ?? harvestProcess(process);
  }
}
