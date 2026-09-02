/**
 * [INPUT]: Depends on BrowserWindow, shared update IPC, one UpdateAdapter, signed candidate compatibility preflight, scheduling/forced-exit hooks, and a two-phase safe-quit port
 * [OUTPUT]: Provides app-singleton UpdateService with check/download state, fail-closed durable-contract preflight, non-returning installer handoff, IPC registration, TTL, and sanitized pre-terminal errors
 * [POS]: The main-owned update lifecycle authority; windows subscribe to it but never own timers or updater listeners
 */

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
  currentVersion: string;
  electronVersion: string;
  platform: NodeJS.Platform;
  resourcesPath: string;
  automaticInstall: boolean;
  candidateCompatibility?: Readonly<{
    load(version: string): Promise<AppGuiCompatibilitySupport>;
    apply(matrix: AppGuiCompatibilitySupport): Promise<void>;
  }>;
  prepareSafeQuit(reason: "update"): Promise<boolean>;
  forceExit(code: number): void;
  now?: () => number;
  setTimer?: (action: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

const idleSnapshot = (
  options: Pick<UpdateServiceOptions, "currentVersion" | "automaticInstall">
): UpdateSnapshot => ({
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
  private installFlight: Promise<void> | null = null;
  private firstTimer: Timer | null = null;
  private intervalTimer: Timer | null = null;
  private installExitTimer: Timer | null = null;
  private started = false;
  private terminalHandoff = false;
  private checkKind: "background" | "manual" = "background";

  constructor(private readonly options: UpdateServiceOptions) {
    this.snapshotValue = idleSnapshot(options);
    this.bindAdapter();
  }

  snapshot() {
    return this.snapshotValue;
  }

  start() {
    if (this.started || !this.options.adapter) return;
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
    if (this.checkFlight) return this.checkFlight;
    if (["downloading", "installing"].includes(this.snapshotValue.phase)) {
      return Promise.reject(new Error("更新正在安装，不能重复检查"));
    }
    const now = this.now();
    if (
      !manual &&
      this.snapshotValue.checkedAt !== null &&
      now - this.snapshotValue.checkedAt < DAY_MS
    ) {
      this.scheduleNextCheck();
      return Promise.resolve(this.snapshotValue);
    }
    this.checkKind = manual ? "manual" : "background";
    this.publish({
      ...this.snapshotValue,
      phase: "checking",
      error: null,
      progress: null,
    });
    const flight = this.options.adapter
      .checkForUpdates()
      .then(() => this.snapshotValue)
      .catch((cause) => {
        this.handleError(asError(cause));
        return this.snapshotValue;
      })
      .finally(() => {
        this.checkFlight = null;
        this.scheduleNextCheck();
      });
    this.checkFlight = flight;
    return flight;
  }

  downloadAndInstall(): Promise<UpdateSnapshot> {
    if (!this.options.adapter || !this.options.automaticInstall) {
      return Promise.reject(new Error("当前平台只支持手动下载安装更新"));
    }
    if (this.downloadFlight) return this.downloadFlight;
    if (this.snapshotValue.phase !== "available") {
      return Promise.reject(new Error("当前没有可下载的更新"));
    }
    const version = this.snapshotValue.availableVersion;
    const flight = Promise.resolve()
      .then(async () => {
        if (!version) throw new Error("GUI_COMPATIBILITY_VERSION_UNAVAILABLE");
        const compatibility = this.options.candidateCompatibility;
        if (compatibility) {
          const matrix = await compatibility.load(version);
          await compatibility.apply(matrix);
        }
        this.publish({
          ...this.snapshotValue,
          phase: "downloading",
          progress: { percent: 0, transferred: 0, total: 0 },
          error: null,
        });
        await this.options.adapter!.downloadUpdate();
      })
      .then(async () => {
        await this.installFlight;
        return this.snapshotValue;
      })
      .catch((cause) => {
        this.handleError(asError(cause), "download");
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
    registrar(window, rendererUrl, "拒绝非主窗口的更新请求")
      .handle(UPDATE_CHANNEL.snapshot, () => this.snapshot())
      .handle(UPDATE_CHANNEL.check, () => this.check(true))
      .handle(UPDATE_CHANNEL.downloadAndInstall, () =>
        this.downloadAndInstall()
      )
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
    this.listen("checking-for-update", () => {
      if (this.snapshotValue.phase !== "checking") {
        this.publish({ ...this.snapshotValue, phase: "checking", error: null });
      }
    });
    this.listen("update-available", (info) => this.available(info));
    this.listen("update-not-available", () => this.notAvailable());
    this.listen("download-progress", (progress) => this.progress(progress));
    this.listen("update-downloaded", () => {
      this.installFlight ??= this.install().finally(() => {
        this.installFlight = null;
      });
    });
    this.listen("error", (error) =>
      this.handleError(
        error,
        ["downloading", "installing"].includes(this.snapshotValue.phase)
          ? "download"
          : "check"
      )
    );
  }

  private listen<K extends keyof UpdateAdapterEvents>(
    event: K,
    listener: UpdateAdapterEvents[K]
  ) {
    this.options.adapter!.on(event, listener);
    this.listeners.push({ event, listener });
  }

  private available(info: UpdateInfo) {
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

  private async install() {
    this.publish({ ...this.snapshotValue, phase: "installing", progress: null });
    const safe = await this.options.prepareSafeQuit("update").catch((cause) => {
      this.handleError(asError(cause), "download");
      return false;
    });
    if (!safe) {
      if (this.snapshotValue.phase === "installing") {
        this.handleError(new Error("无法安全关闭应用，更新未安装"), "download");
      }
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
    this.snapshotValue = Object.freeze(snapshot);
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(UPDATE_CHANNEL.subscribe, this.snapshotValue);
      }
    }
  }

  private scheduleNextCheck() {
    if (!this.started || !this.options.adapter) return;
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
