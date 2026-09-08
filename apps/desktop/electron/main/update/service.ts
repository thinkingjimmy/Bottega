/**
 * [INPUT]: Depends on BrowserWindow, shared update IPC, one UpdateAdapter, signed candidate compatibility preflight, scheduling/forced-exit hooks, and a two-phase safe-quit port
 * [OUTPUT]: Provides app-singleton UpdateService with check/download state, durable-contract preflight, installer handoff, deferred requirement cancellation, candidate identity fences and retryable installation intent.
 * [POS]: The main-owned update lifecycle authority; windows subscribe to it but never own timers or updater listeners
 */

import { compareSemVer, meetsMinimum, parseSemVer } from "../../../shared/app-host/semver";
import type { AppCompatibilityFailure } from "../../../shared/app-host/contract";
import { randomUUID } from "node:crypto";
import type { SafeQuitResult } from "../startup/safe-quit";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { AppInfo, UpdateSnapshot } from "../../../shared/update-ipc";
import { UPDATE_CHANNEL } from "../../../shared/update-ipc";
import { resolvePlatformCapabilities } from "../../../shared/platform-capabilities";
import { rendererIpc, type RendererIpcRegistrar } from "../ipc-registrar";
import type {
  DownloadProgress,
  UpdateAdapter,
  UpdateAdapterEvents,
  UpdateInfo,
} from "./adapter";
import type { AppGuiCompatibilitySupport } from "../../../shared/app-gui/support";

const DAY_MS = 24 * 60 * 60 * 1_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const INSTALL_EXIT_TIMEOUT_MS = 10_000;
const LICENSE_BYTE_LIMIT = 1024 * 1024;
const LICENSE_URL = "https://github.com/thinkingjimmy/Bottega/blob/main/LICENSE";

type Timer = ReturnType<typeof setTimeout>;

export type UpdateServiceOptions = {
  adapter: UpdateAdapter | null;
  resolveAppRequirement?(requestId: string): Promise<AppCompatibilityFailure>;
  currentVersion: string;
  electronVersion: string;
  platform: NodeJS.Platform;
  resourcesPath: string;
  automaticInstall: boolean;
  candidateCompatibility?: Readonly<{
    load(version: string): Promise<AppGuiCompatibilitySupport>;
    apply(matrix: AppGuiCompatibilitySupport): Promise<void>;
  }>;
  prepareSafeQuit(reason: "update", interactive?: boolean): Promise<SafeQuitResult>;
  hasStopOperations?(): boolean;
  forceExit(code: number): void;
  now?: () => number;
  setTimer?: (action: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

const idleSnapshot = (
  options: Pick<UpdateServiceOptions, "currentVersion" | "automaticInstall">
): UpdateSnapshot => ({
  revision: 0,
  phase: "idle",
  currentVersion: options.currentVersion,
  availableVersion: null,
  progress: null,
  checkedAt: null,
  error: null,
  lastError: null,
  automaticInstall: options.automaticInstall,
});

export class UpdateService {
  private snapshotValue: UpdateSnapshot;
  private readonly windows = new Set<BrowserWindow>();
  private readonly listeners: Array<{
    event: keyof UpdateAdapterEvents;
    listener: UpdateAdapterEvents[keyof UpdateAdapterEvents];
  }> = [];
  private checkFlight: Promise<UpdateSnapshot> | null = null;
  private downloadFlight: Promise<UpdateSnapshot> | null = null;
  private requirementFlight: Promise<UpdateSnapshot> | null = null;
  private requirement: AppCompatibilityFailure | null = null;
  private minimumCheck = false;
  private suppressAutomaticInstall = false;
  private installFlight: Promise<void> | null = null;
  private firstTimer: Timer | null = null;
  private intervalTimer: Timer | null = null;
  private installExitTimer: Timer | null = null;
  private started = false;
  private terminalHandoff = false;
  private adapterEpoch = 0;
  private downloadVersion: string | null = null;
  private readonly observers = new Set<(snapshot: UpdateSnapshot) => void>();

  onChanged(listener: (snapshot: UpdateSnapshot) => void) {
    this.observers.add(listener);
    return () => { this.observers.delete(listener); };
  }
  private checkKind: "background" | "manual" = "background";

  constructor(private readonly options: UpdateServiceOptions) {
    this.snapshotValue = idleSnapshot(options);
    this.bindAdapter();
  }

  snapshot() {
    return this.snapshotValue;
  }

  start() {
    if (this.started || !this.options.adapter || this.candidateHeld()) return;
    this.started = true;
    this.firstTimer = this.timer(() => void this.check(false), FIRST_CHECK_DELAY_MS);
  }

  stop() {
    if (this.firstTimer) this.clearTimer(this.firstTimer);
    if (this.intervalTimer) this.clearTimer(this.intervalTimer);
    if (this.installExitTimer) this.clearTimer(this.installExitTimer);
    this.firstTimer = null;
    this.intervalTimer = null;
    this.installExitTimer = null;
    for (const { event, listener } of this.listeners) {
      this.options.adapter?.off(event, listener as never);
    }
    this.listeners.length = 0;
    this.started = false;
  }

  check(manual = true): Promise<UpdateSnapshot> {
    if (!this.options.adapter) return Promise.resolve(this.snapshotValue);
    if (this.requirementFlight && !this.minimumCheck) return this.requirementFlight;
    if (this.candidateHeld()) return Promise.resolve(this.snapshotValue);
    if (this.downloadFlight && this.snapshotValue.phase === "available") return Promise.resolve(this.snapshotValue);
    if (this.snapshotValue.phase === "downloading") {
      return Promise.reject(new Error("更新正在安装，不能重复检查"));
    }
    if (this.checkFlight) return this.checkFlight;
    const now = this.now();
    if (
      !manual &&
      this.snapshotValue.checkedAt !== null &&
      now - this.snapshotValue.checkedAt < DAY_MS
    ) {
      this.scheduleNextCheck();
      return Promise.resolve(this.snapshotValue);
    }
    const operationId = ++this.adapterEpoch;
    this.checkKind = manual ? "manual" : "background";
    this.publish({
      ...this.snapshotValue,
      phase: "checking",
      error: null,
      progress: null,
    });
    const flight = this.options.adapter
      .checkForUpdates(operationId)
      .then(() => this.snapshotValue)
      .catch((cause) => {
        if (this.snapshotValue.phase === "checking") this.handleError(asError(cause));
        return this.snapshotValue;
      })
      .finally(() => {
        this.checkFlight = null;
        this.scheduleNextCheck();
      });
    this.checkFlight = flight;
    return flight;
  }

  checkMinimum(context: AppCompatibilityFailure): Promise<UpdateSnapshot> {
    if (!context.minBottegaVersion || !parseSemVer(context.minBottegaVersion)) {
      return Promise.reject(new Error("APP_COMPATIBILITY_REQUIREMENT_INVALID"));
    }
    if (this.installFlight || this.terminalHandoff) {
      this.publish({ ...this.snapshotValue, appRequirement: { context, status: "install-busy" } });
      return Promise.resolve(this.snapshotValue);
    }
    if (!this.requirementFlight || !this.requirement ||
        compareSemVer(context.minBottegaVersion, this.requirement.minBottegaVersion!) > 0) {
      this.requirement = context;
    }
    if (this.requirementFlight) return this.requirementFlight;
    // Synchronous admission also fences installNow while candidate validation yields.
    this.suppressAutomaticInstall = true;
    this.suspendChecks();
    let finish!: (snapshot: UpdateSnapshot) => void;
    const flight = new Promise<UpdateSnapshot>((resolve) => { finish = resolve; });
    this.requirementFlight = flight;
    void Promise.resolve().then(async () => {
      try {
        for (;;) {
          const accepted = this.requirement;
          await this.checkRequiredCandidate();
          if (accepted === this.requirement) break;
        }
      } catch (cause) {
        this.handleError(asError(cause));
        this.requirementStatus("error");
      }
      this.requirementFlight = null;
      if (!this.requirement) this.scheduleNextCheck();
      finish(this.snapshotValue);
    });
    return flight;
  }

  dismissAppRequirement() {
    // The cleared intent is observed after the admitted operation settles;
    // requirementFlight keeps installation fenced until that safe boundary.
    this.requirement = null;
    // Dismissing guidance never resumes a previously suppressed automatic restart.
    this.publish({ ...this.snapshotValue, appRequirement: null });
    if (this.requirementFlight) return this.requirementFlight;
    this.scheduleNextCheck();
    return Promise.resolve(this.snapshotValue);
  }

  private requirementStatus(status: NonNullable<UpdateSnapshot["appRequirement"]>["status"]) {
    if (this.requirement) this.publish({ ...this.snapshotValue, appRequirement: { context: this.requirement, status } });
  }

  private async checkRequiredCandidate(): Promise<UpdateSnapshot> {
    for (;;) {
      const context = this.requirement;
      if (!context) return this.snapshotValue;
      const minimum = context.minBottegaVersion!;
      if (meetsMinimum(this.options.currentVersion, minimum)) {
        this.requirementStatus("satisfied");
        return this.snapshotValue;
      }
      if (meetsMinimum(this.snapshotValue.availableVersion, minimum) &&
          ["available", "downloading", "ready"].includes(this.snapshotValue.phase)) {
        if (this.snapshotValue.phase !== "ready" || !this.options.adapter?.validateDownloadedCandidate ||
            await this.options.adapter.validateDownloadedCandidate(this.snapshotValue.availableVersion!)) {
          if (context !== this.requirement) continue;
          this.requirementStatus("satisfied");
          return this.snapshotValue;
        }
      }
      if (this.downloadFlight) {
        this.requirementStatus("waiting-download");
        await this.downloadFlight;
        continue;
      }
      if (this.checkFlight) {
        this.requirementStatus("checking");
        await this.checkFlight;
        continue;
      }
      await this.clearCandidate();
      if (context !== this.requirement) continue;
      if (!this.options.adapter) throw new Error("UPDATE_CHECK_UNAVAILABLE");
      this.requirementStatus("checking");
      if (context !== this.requirement) continue;
      this.minimumCheck = true;
      try { await this.check(true); }
      finally { this.minimumCheck = false; }
      if (context !== this.requirement) continue;
      this.requirementStatus(this.snapshotValue.phase === "error" ? "error" :
        meetsMinimum(this.snapshotValue.availableVersion, minimum) ? "satisfied" : "unavailable");
      return this.snapshotValue;
    }
  }

  private async clearCandidate() {
    ++this.adapterEpoch;
    this.downloadVersion = null;
    this.publish({ ...this.snapshotValue, phase: "idle", candidateId: null, availableVersion: null, progress: null, error: null });
    await this.options.adapter?.invalidateCandidate?.();
  }

  downloadAndInstall(): Promise<UpdateSnapshot> {
    if (this.requirementFlight) return this.requirementFlight;
    if (this.requirement && !meetsMinimum(this.snapshotValue.availableVersion, this.requirement.minBottegaVersion!)) {
      return Promise.reject(new Error("APP_HOST_UPDATE_REQUIRED"));
    }
    if (!this.options.adapter || !this.options.automaticInstall) {
      return Promise.reject(new Error("当前平台只支持手动下载安装更新"));
    }
    if (this.candidateHeld()) return Promise.resolve(this.snapshotValue);
    if (this.snapshotValue.phase === "downloading" && this.downloadFlight) return this.downloadFlight;
    if (this.snapshotValue.phase !== "available") {
      return Promise.reject(new Error("当前没有可下载的更新"));
    }
    if (this.downloadFlight) return this.downloadFlight;
    const version = this.snapshotValue.availableVersion;
    this.downloadVersion = version;
    const operationId = ++this.adapterEpoch;
    const flight = Promise.resolve()
      .then(async () => {
        if (!version) throw new Error("GUI_COMPATIBILITY_VERSION_UNAVAILABLE");
        const compatibility = this.options.candidateCompatibility;
        if (compatibility) {
          const matrix = await compatibility.load(version);
          await compatibility.apply(matrix);
        }
        if (this.downloadVersion !== version || this.candidateHeld()) return;
        this.publish({
          ...this.snapshotValue,
          phase: "downloading",
          progress: { percent: 0, transferred: 0, total: 0 },
          error: null,
        });
        await this.options.adapter!.downloadUpdate(operationId);
      })
      .then(async () => {
        await this.installFlight;
        return this.snapshotValue;
      })
      .catch((cause) => {
        if (!this.candidateHeld()) this.handleError(asError(cause), "download");
        return this.snapshotValue;
      })
      .finally(() => {
        this.downloadFlight = null;
      });
    this.downloadFlight = flight;
    return flight;
  }

  register(
    window: BrowserWindow,
    rendererUrl: string,
    registrar: RendererIpcRegistrar = rendererIpc
  ) {
    this.windows.add(window);
    registrar(rendererUrl, "拒绝非主窗口的更新请求")
      .handle(UPDATE_CHANNEL.snapshot, () => this.snapshot())
      .handle(UPDATE_CHANNEL.check, () => this.check(true))
      .handle(UPDATE_CHANNEL.checkForApp, async (requestId) => {
        if (typeof requestId !== "string" || !this.options.resolveAppRequirement) throw new Error("APP_COMPATIBILITY_REQUEST_UNAVAILABLE");
        return this.checkMinimum(await this.options.resolveAppRequirement(requestId));
      })
      .handle(UPDATE_CHANNEL.dismissAppRequirement, () => this.dismissAppRequirement())
      .handle(UPDATE_CHANNEL.downloadAndInstall, () =>
        this.downloadAndInstall()
      )
      .handle(UPDATE_CHANNEL.installNow, (candidateId) => {
        if (typeof candidateId !== "string") throw new Error("UPDATE_CANDIDATE_REQUIRED");
        return this.installNow(candidateId);
      })
      .handle(UPDATE_CHANNEL.appInfo, () => this.appInfo());
    window.once("closed", () => this.windows.delete(window));
  }

  async appInfo(): Promise<AppInfo> {
    return {
      version: this.options.currentVersion,
      electron: this.options.electronVersion,
      platform: this.options.platform,
      platformSupport: resolvePlatformCapabilities(this.options.platform),
      licenseText: await readBoundedLicense(this.options.resourcesPath),
      licenseUrl: LICENSE_URL,
    };
  }

  private bindAdapter() {
    const adapter = this.options.adapter;
    if (!adapter) return;
    // check() owns the transition; delayed adapter notifications must not replace an admitted candidate.
    this.listen("update-available", (info) => { if (this.currentEvent(info)) this.available(info); });
    this.listen("update-not-available", (info) => { if (this.currentEvent(info)) this.notAvailable(); });
    this.listen("download-progress", (progress) => { if (this.currentEvent(progress)) this.progress(progress); });
    this.listen("update-downloaded", (info) => {
      if (!this.currentEvent(info) || this.snapshotValue.phase !== "downloading" || info.version !== this.downloadVersion) return;
      const candidateId = randomUUID();
      this.suspendChecks();
      this.publish({ ...this.snapshotValue, phase: "ready", candidateId, progress: null, error: null });
      if (!this.suppressAutomaticInstall && !this.requirementFlight && !(this.options.hasStopOperations?.() ?? true)) void this.installNow(candidateId, false);
    });
    this.listen("error", (error) => {
      if (!this.currentEvent(error)) return;
      if (this.terminalHandoff) { this.options.forceExit(1); return; }
      if (this.candidateHeld()) return;
      this.handleError(
        error,
        ["downloading", "installing"].includes(this.snapshotValue.phase)
          ? "download"
          : "check"
      );
    });
  }

  private currentEvent(event?: { operationId?: number }) { return event?.operationId === undefined || event.operationId === this.adapterEpoch; }

  private listen<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ) {
    this.options.adapter!.on(event, listener);
    this.listeners.push({ event, listener });
  }

  private available(info: UpdateInfo) {
    if (this.snapshotValue.phase !== "checking") return;
    this.publish({
      ...this.snapshotValue,
      phase: "available",
      availableVersion: info.version,
      checkedAt: this.now(),
      progress: null,
      error: null,
      lastError: null,
    });
  }

  private notAvailable() {
    if (this.snapshotValue.phase !== "checking") return;
    this.publish({
      ...this.snapshotValue,
      phase: "not-available",
      availableVersion: null,
      checkedAt: this.now(),
      progress: null,
      error: null,
      lastError: null,
    });
  }

  private progress(progress: DownloadProgress) {
    /* 只有仍在下载时才收进度。掉队的 progress 事件（下载已报错、或
       update-downloaded 之后才到）否则会把相位从 error/installing 拽回
       downloading——而那之后不会再有任何事件来纠正它，界面就永久停在
       一个假的下载中。相位只准向前走。 */
    if (this.snapshotValue.phase !== "downloading") return;
    this.publish({
      ...this.snapshotValue,
      progress: {
        percent: clamp(progress.percent, 0, 100),
        transferred: Math.max(0, progress.transferred),
        total: Math.max(0, progress.total),
      },
    });
  }

  installNow(candidateId: string, interactive = true): Promise<UpdateSnapshot> {
    if (this.terminalHandoff) return Promise.resolve(this.snapshotValue);
    if (this.requirementFlight || (this.requirement && !meetsMinimum(this.snapshotValue.availableVersion, this.requirement.minBottegaVersion!))) {
      return Promise.reject(new Error("UPDATE_CANDIDATE_STALE"));
    }
    if (!candidateId || candidateId !== this.snapshotValue.candidateId ||
        !this.candidateHeld() || !this.options.adapter) {
      return Promise.reject(new Error("UPDATE_CANDIDATE_STALE"));
    }
    if (!this.installFlight) {
      this.installFlight = Promise.resolve().then(() => this.install(candidateId, interactive)).finally(() => { this.installFlight = null; });
    }
    return this.installFlight.then(() => this.snapshotValue);
  }

  async invalidateCandidate(candidateId: string) {
    if (this.installFlight || this.terminalHandoff || this.downloadFlight || this.requirementFlight) return;
    if (this.snapshotValue.phase !== "ready" || this.snapshotValue.candidateId !== candidateId) return;
    await this.clearCandidate();
    this.scheduleNextCheck();
  }

  private candidateHeld() { return ["ready", "installing"].includes(this.snapshotValue.phase); }
  private suspendChecks() {
    if (this.firstTimer) this.clearTimer(this.firstTimer);
    if (this.intervalTimer) this.clearTimer(this.intervalTimer);
    this.firstTimer = null;
    this.intervalTimer = null;
  }

  private async install(candidateId: string, interactive: boolean) {
    try {
      if (this.options.adapter?.validateDownloadedCandidate && !await this.options.adapter.validateDownloadedCandidate(this.snapshotValue.availableVersion ?? undefined)) {
        await this.clearCandidate();
        return;
      }
      if (this.snapshotValue.candidateId !== candidateId) return;
      this.publish({ ...this.snapshotValue, phase: "installing", progress: null });
      const safe = await this.options.prepareSafeQuit("update", interactive);
      if (safe !== "ready") {
        this.publish({ ...this.snapshotValue, phase: "ready", error: safe === "failed" ? "UPDATE_SAFE_QUIT_FAILED" : null });
        return;
      }
    } catch (cause) {
      this.publish({ ...this.snapshotValue, phase: "ready", error: sanitizeError(asError(cause).message) });
      return;
    }
    this.terminalHandoff = true;
    try {
      this.options.adapter?.quitAndInstall();
    } catch {
      this.options.forceExit(1);
      return;
    }
    this.installExitTimer = this.timer(
      () => this.options.forceExit(0),
      INSTALL_EXIT_TIMEOUT_MS
    );
  }

  private handleError(error: Error, kind: "check" | "download" = "check") {
    if (this.terminalHandoff) {
      this.options.forceExit(1);
      return;
    }
    const message = sanitizeError(error.message);
    if (kind === "check" && this.checkKind === "background") {
      this.publish({
        ...this.snapshotValue,
        phase: "idle",
        error: null,
        lastError: message,
      });
      return;
    }
    this.publish({
      ...this.snapshotValue,
      phase: "error",
      error: message,
      lastError: message,
      progress: null,
    });
  }

  private publish(snapshot: UpdateSnapshot) {
    this.snapshotValue = Object.freeze({ ...snapshot, revision: (this.snapshotValue.revision ?? 0) + 1 });
    for (const observer of this.observers) {
      try { observer(this.snapshotValue); } catch (cause) { console.warn("[update] observer failed", cause); }
    }
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(UPDATE_CHANNEL.subscribe, this.snapshotValue);
      }
    }
  }

  private scheduleNextCheck() {
    if (!this.started || !this.options.adapter || this.candidateHeld()) return;
    if (this.intervalTimer) this.clearTimer(this.intervalTimer);
    this.intervalTimer = this.timer(() => void this.check(false), DAY_MS);
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private timer(action: () => void, delay: number) {
    const timer = this.options.setTimer?.(action, delay) ?? setTimeout(action, delay);
    timer.unref?.();
    return timer;
  }

  private clearTimer(timer: Timer) {
    if (this.options.clearTimer) this.options.clearTimer(timer);
    else clearTimeout(timer);
  }
}

async function readBoundedLicense(resourcesPath: string) {
  const path = join(resourcesPath, "LICENSE");
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > LICENSE_BYTE_LIMIT) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function sanitizeError(message: string) {
  return message
    .replace(/https?:\/\/\S+/gi, "<update-endpoint>")
    .replace(
      /(token|authorization|password|secret)=?\s*[^\s,;]+/gi,
      "$1=<redacted>"
    )
    .slice(0, 500);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause));
}
