/**
 * [INPUT]: Depends on shared Browser IPC, injectable native windows/views, browser security, and shared status errors.
 * [OUTPUT]: Provides BrowserPanelService with a shared tab pool, replaceable host visibility tracking, renderer IPC, Agent batch cancellation, and background-tab sleep/wake with history restore.
 * [POS]: Main/browser lifecycle truth source shared by renderer and tool callers
 */

import { randomUUID } from "node:crypto";
import {
  BROWSER_CHANNEL,
  BROWSER_DEFAULT_URL,
  BROWSER_TAB_LIMIT,
  BROWSER_TAB_SLEEP_AFTER_MS,
  browserCreateTabSchema,
  browserNavigateSchema,
  browserTabRequestSchema,
  browserViewportSchema,
  browserVisibleSchema,
  browserUrlSchema,
  type BrowserTabProjection,
  type BrowserTabsSnapshot,
  type BrowserViewport,
} from "../../../shared/browser-ipc";
import { statusError } from "../errors";
import { rendererIpc } from "../ipc-registrar";
import { secureBrowserContents } from "./security";

type EventListener = (...args: never[]) => void;

export type BrowserDebuggerResult = {
  frameTree?: unknown;
  nodes?: unknown[];
  object?: { objectId?: string };
  model?: { content?: unknown };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
  result?: { value?: unknown };
};

export type BrowserDebuggerPort = {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string
  ): Promise<BrowserDebuggerResult>;
  on(event: "detach" | "message", listener: EventListener): unknown;
  removeListener(event: "detach" | "message", listener: EventListener): unknown;
};

/** Mirrors Electron's NavigationEntry; `pageState` carries scroll offsets and form values. */
export type BrowserNavigationEntry = {
  url: string;
  title: string;
  pageState?: string;
};

export type BrowserNavigationHistoryPort = {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  getAllEntries(): BrowserNavigationEntry[];
  getActiveIndex(): number;
  restore(options: {
    entries: BrowserNavigationEntry[];
    index?: number;
  }): Promise<void>;
};

export type BrowserWebContentsPort = {
  id: number;
  debugger: BrowserDebuggerPort;
  navigationHistory: BrowserNavigationHistoryPort;
  session: BrowserSessionPort;
  loadURL(url: string): Promise<unknown>;
  reload(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
  isDestroyed(): boolean;
  close(): void;
  on(event: string, listener: EventListener): unknown;
  removeListener(event: string, listener: EventListener): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" }
  ): void;
};

export type BrowserSessionPort = {
  setPermissionCheckHandler(
    handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: unknown
    ) => boolean
  ): void;
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void
    ) => void
  ): void;
  on(event: "will-download", listener: EventListener): unknown;
};

export type BrowserViewPort = {
  webContents: BrowserWebContentsPort;
  setBounds(bounds: BrowserViewport): void;
};

export type BrowserWindowPort = {
  contentView: {
    addChildView(view: BrowserViewPort): void;
    removeChildView(view: BrowserViewPort): void;
  };
  webContents: {
    send(channel: string, value: unknown): void;
    once(event: "destroyed", listener: () => void): unknown;
  };
  isVisible?(): boolean;
  isMinimized?(): boolean;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
};

/** Everything a sleeping tab keeps so waking it lands on the same entry, not just the same URL. */
type TabHistory = { entries: BrowserNavigationEntry[]; index: number };

export type TabRecord = {
  tabId: string;
  /** `null` while asleep: the page process is gone and only the record below survives. */
  view: BrowserViewPort | null;
  ownerChatId: string | null;
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  agentActive: boolean;
  agentAction?: string;
  /** When the tab stopped being the visible selected tab; `null` while it is. */
  hiddenSince: number | null;
  history: TabHistory | null;
  /** Resolves when the wake load settles; awaited by ensureAwake, cleared on settle. */
  waking: Promise<void> | null;
};

/** A wake that never reports back must not pin an Agent tool call forever. */
const WAKE_LOAD_TIMEOUT_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;

/** Unref'd so an idle sweep never keeps the main process alive on its own. */
function defaultSweepScheduler(run: () => void, intervalMs: number) {
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export class UserStoppedBrowserBatchError extends Error {
  readonly code = "stopped_by_user";

  constructor() {
    super("用户已停止当前浏览器动作批次");
    this.name = "UserStoppedBrowserBatchError";
  }
}

export type BrowserPanelServiceDependencies = {
  createView(): BrowserViewPort;
  tabLimit?: number;
  /** Injected clock and scheduler so sleep tests run on a fake clock instead of wall time. */
  now?(): number;
  sleepAfterMs?: number;
  scheduleSweep?(run: () => void, intervalMs: number): () => void;
};

export class BrowserPanelService {
  private readonly tabs = new Map<string, TabRecord>();
  private readonly batchControllers = new Map<string, AbortController>();
  private readonly tabLimit: number;
  private window: BrowserWindowPort | null = null;
  private attachedTabId: string | null = null;
  private viewport: BrowserViewport = { x: 0, y: 0, width: 0, height: 0 };
  private selectedTabId: string | null = null;
  private visible = false;
  private hostVisible = false;
  private rendererGone = false;
  private releaseHost: (() => void) | null = null;
  private readonly now: () => number;
  private readonly sleepAfterMs: number;
  private readonly cancelSweep: () => void;

  constructor(private readonly dependencies: BrowserPanelServiceDependencies) {
    this.tabLimit = dependencies.tabLimit ?? BROWSER_TAB_LIMIT;
    this.now = dependencies.now ?? Date.now;
    this.sleepAfterMs = dependencies.sleepAfterMs ?? BROWSER_TAB_SLEEP_AFTER_MS;
    // Sweeping less often than the threshold itself would stretch the promise
    // by up to one whole interval; at 30 minutes the minute cadence wins anyway.
    this.cancelSweep = (dependencies.scheduleSweep ?? defaultSweepScheduler)(
      () => this.sweep(),
      Math.max(1_000, Math.min(SWEEP_INTERVAL_MS, this.sleepAfterMs))
    );
  }

  attachHost(window: BrowserWindowPort) {
    this.releaseHost?.();
    this.removeAttachedView();
    this.window = window;
    this.rendererGone = false;
    const refreshHost = () => {
      if (this.window !== window) return;
      this.hostVisible = !this.rendererGone && !window.isDestroyed() &&
        (window.isVisible?.() ?? false) && !(window.isMinimized?.() ?? false);
      this.renderSelection(); this.emit();
    };
    this.hostVisible = !window.isDestroyed() && (window.isVisible?.() ?? false) && !(window.isMinimized?.() ?? false);
    for (const event of ["show", "hide", "minimize", "restore", "closed"]) window.on?.(event, refreshHost);
    const contents = window.webContents as typeof window.webContents & { on?(event: string, listener: () => void): void; removeListener?(event: string, listener: () => void): void };
    const gone = () => { if (this.window === window) { this.rendererGone = true; refreshHost(); } };
    contents.on?.("render-process-gone", gone);
    this.releaseHost = () => {
      for (const event of ["show", "hide", "minimize", "restore", "closed"]) window.removeListener?.(event, refreshHost);
      contents.removeListener?.("render-process-gone", gone);
    };
    refreshHost();
  }

  register(window: BrowserWindowPort, rendererUrl: string) {
    this.attachHost(window);
    rendererIpc(rendererUrl, "拒绝非主窗口的浏览器请求")
      .roles("main")
      .handle(BROWSER_CHANNEL.createTab, (raw) => {
        const input = browserCreateTabSchema.parse(raw ?? {});
        return this.createTab({ url: input.url, ownerChatId: null });
      })
      .handle(BROWSER_CHANNEL.closeTab, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.closeTab(tabId);
        return this.snapshot();
      })
      .handle(BROWSER_CHANNEL.activateTab, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.activateTab(tabId);
        return this.snapshot();
      })
      .handle(BROWSER_CHANNEL.navigate, async (raw) => {
        const input = browserNavigateSchema.parse(raw);
        await this.navigate(input.tabId, input.url);
        return this.project(this.requireTab(input.tabId));
      })
      .handle(BROWSER_CHANNEL.goBack, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.goBack(tabId);
      })
      .handle(BROWSER_CHANNEL.goForward, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.goForward(tabId);
      })
      .handle(BROWSER_CHANNEL.reload, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.reload(tabId);
      })
      .handle(BROWSER_CHANNEL.setViewport, (raw) => {
        this.setViewport(browserViewportSchema.parse(raw));
      })
      .handle(BROWSER_CHANNEL.setVisible, (raw) => {
        const { visible } = browserVisibleSchema.parse(raw);
        this.setVisible(visible);
        return this.snapshot();
      })
      .handle(BROWSER_CHANNEL.stopAgentBatch, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        return this.stopAgentBatch(tabId);
      });

    window.webContents.once("destroyed", () => {
      if (this.window !== window) return;
      this.removeAttachedView();
      this.window = null;
      this.visible = false;
      this.emit();
    });
    this.renderSelection();
    this.emit();
  }

  async createTab(input: {
    url?: string;
    ownerChatId: string | null;
  }): Promise<BrowserTabProjection> {
    const artifactUrl = input.url && /^https:\/\/(?:claude\.ai|preview\.claude\.ai)\/code\/artifact\/[A-Za-z0-9-]+\/?$/.test(input.url) ? input.url : null;
    const existingArtifact = artifactUrl ? [...this.tabs.values()].find(tab => tab.url === artifactUrl) : undefined;
    if (existingArtifact) { this.activateTab(existingArtifact.tabId); return this.snapshot().tabs.find(tab => tab.tabId === existingArtifact.tabId)!; }
    if (this.tabs.size >= this.tabLimit) {
      throw statusError(
        409,
        `浏览器 tab 已达 ${this.tabLimit} 个上限；请先用 browser_tabs 查看，再用 browser_close 关闭不用的 tab`
      );
    }
    const url = this.assertUrl(input.url ?? BROWSER_DEFAULT_URL);
    const tabId = `browser-${randomUUID()}`;
    const view = this.dependencies.createView();
    const record: TabRecord = {
      tabId,
      view,
      ownerChatId: input.ownerChatId,
      url,
      title: "New tab",
      loading: true,
      agentActive: false,
      hiddenSince: this.now(),
      history: null,
      waking: null,
    };
    this.tabs.set(tabId, record);
    this.bindTab(record);
    this.selectedTabId = tabId;
    this.renderSelection();
    this.emit(tabId);
    try {
      await view.webContents.loadURL(url);
    } catch (cause) {
      record.loading = false;
      record.title = "无法打开页面";
      this.emit();
      throw cause;
    }
    return this.project(record);
  }

  closeTab(tabId: string) {
    const record = this.requireTab(tabId);
    this.stopAgentBatch(tabId);
    if (this.attachedTabId === tabId) this.removeAttachedView();
    if (this.selectedTabId === tabId) {
      const ids = [...this.tabs.keys()];
      const index = ids.indexOf(tabId);
      this.selectedTabId =
        ids[index + 1] ?? ids[index - 1] ?? null;
    }
    this.detachAndClose(record);
    this.tabs.delete(tabId);
    this.renderSelection();
    this.emit();
  }

  activateTab(tabId: string) {
    this.requireTab(tabId);
    this.selectedTabId = tabId;
    this.renderSelection();
    this.emit();
  }

  async navigate(tabId: string, rawUrl: string) {
    const record = this.requireTab(tabId);
    const url = this.assertUrl(rawUrl);
    record.url = url;
    record.loading = true;
    const view = record.view;
    if (!view) {
      // A sleeping tab is about to leave its saved entry anyway: waking with no
      // history makes the wake load the requested URL instead of loading twice.
      record.history = null;
      this.wake(record);
      this.renderSelection();
      this.emit();
      await record.waking;
      return;
    }
    this.emit();
    await view.webContents.loadURL(url);
  }

  goBack(tabId: string) {
    const record = this.requireTab(tabId);
    if (!record.view) return this.wakeAtOffset(record, -1);
    const navigation = record.view.webContents.navigationHistory;
    if (navigation.canGoBack()) navigation.goBack();
  }

  goForward(tabId: string) {
    const record = this.requireTab(tabId);
    if (!record.view) return this.wakeAtOffset(record, 1);
    const navigation = record.view.webContents.navigationHistory;
    if (navigation.canGoForward()) navigation.goForward();
  }

  reload(tabId: string) {
    const record = this.requireTab(tabId);
    if (!record.view) return this.wakeAtOffset(record, 0);
    record.view.webContents.reload();
  }

  setViewport(viewport: BrowserViewport) {
    this.viewport = {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    };
    this.renderSelection();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.renderSelection();
    this.emit();
  }

  get activeTabId() {
    return this.visible && this.hostVisible && !this.window?.isDestroyed() &&
      (this.window?.isVisible?.() ?? false) && !(this.window?.isMinimized?.() ?? false) ? this.selectedTabId : null;
  }

  getTab(tabId: string): Readonly<TabRecord> | undefined {
    return this.tabs.get(tabId);
  }

  requireTab(tabId: string): TabRecord {
    const record = this.tabs.get(tabId);
    if (!record) throw statusError(404, "浏览器 tab 不存在");
    return record;
  }

  /** CDP 铁律：只有本注册表创建的 webContents 才可被 harness attach。 */
  assertRegisteredWebContents(contents: BrowserWebContentsPort) {
    const registered = [...this.tabs.values()].some(
      (record) => record.view?.webContents === contents
    );
    if (!registered) {
      throw statusError(403, "拒绝调试非 Agent Browser 的 webContents");
    }
  }

  /**
   * Agent entry point into a possibly sleeping tab: wakes it and waits for the
   * reload to settle, so callers always meet a live webContents.
   */
  async ensureAwake(tabId: string): Promise<TabRecord> {
    const record = this.requireTab(tabId);
    if (record.view) return record;
    this.wake(record);
    this.renderSelection();
    this.emit();
    await record.waking;
    return record;
  }

  releaseChat(chatId: string) {
    let changed = false;
    for (const record of this.tabs.values()) {
      if (record.ownerChatId !== chatId) continue;
      record.ownerChatId = null;
      changed = true;
    }
    if (changed) this.emit();
  }

  beginAgentBatch(tabId: string, upstream: AbortSignal) {
    const record = this.requireTab(tabId);
    if (this.batchControllers.has(tabId)) {
      throw statusError(409, "同一 tab 已有浏览器动作批次正在执行");
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(upstream.reason);
    if (upstream.aborted) forwardAbort();
    else upstream.addEventListener("abort", forwardAbort, { once: true });
    this.batchControllers.set(tabId, controller);
    record.agentActive = true;
    delete record.agentAction;
    this.emit();
    return {
      signal: controller.signal,
      finish: () => {
        upstream.removeEventListener("abort", forwardAbort);
        if (this.batchControllers.get(tabId) !== controller) return;
        this.batchControllers.delete(tabId);
        record.agentActive = false;
        delete record.agentAction;
        // A tab an Agent was driving until just now has not been idle for 30
        // minutes, whatever its hidden stamp said; the clock restarts here.
        record.hiddenSince = this.now();
        this.emit();
      },
    };
  }

  setAgentAction(tabId: string, action: string) {
    const record = this.requireTab(tabId);
    record.agentActive = true;
    record.agentAction = action;
    this.emit();
  }

  stopAgentBatch(tabId: string) {
    const controller = this.batchControllers.get(tabId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new UserStoppedBrowserBatchError());
    return true;
  }

  snapshot(createdTabId: string | null = null): BrowserTabsSnapshot {
    return {
      tabs: [...this.tabs.values()].map((record) => this.project(record)),
      activeTabId: this.activeTabId,
      selectedTabId: this.selectedTabId,
      createdTabId,
    };
  }

  shutdown() {
    this.cancelSweep();
    this.visible = false;
    this.removeAttachedView();
    for (const controller of this.batchControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new Error("应用正在退出，浏览器动作批次终止"));
      }
    }
    this.batchControllers.clear();
    const records = [...this.tabs.values()];
    this.tabs.clear();
    this.selectedTabId = null;
    for (const record of records) this.detachAndClose(record);
  }

  /** The clock runs for every tab that is not the one the user is looking at. */
  private markVisibility() {
    const active = this.activeTabId;
    const stamp = this.now();
    for (const record of this.tabs.values()) {
      if (record.tabId === active) record.hiddenSince = null;
      else record.hiddenSince ??= stamp;
    }
  }

  private sweep() {
    this.markVisibility();
    const deadline = this.now() - this.sleepAfterMs;
    let slept = false;
    for (const record of this.tabs.values()) {
      if (!record.view) continue;
      // An Agent batch owns the page until it settles; its CDP session and the
      // refs it handed out would die with the process.
      if (record.agentActive || this.batchControllers.has(record.tabId)) continue;
      if (record.hiddenSince === null || record.hiddenSince > deadline) continue;
      this.sleep(record);
      slept = true;
    }
    if (slept) this.emit();
  }

  private sleep(record: TabRecord) {
    const contents = record.view?.webContents;
    if (contents && !contents.isDestroyed()) {
      record.url = contents.getURL() || record.url;
      record.title = contents.getTitle() || record.title;
      try {
        record.history = {
          entries: contents.navigationHistory.getAllEntries(),
          index: contents.navigationHistory.getActiveIndex(),
        };
      } catch (cause) {
        console.warn("[browser] history snapshot failed", cause);
        record.history = null;
      }
    }
    if (this.attachedTabId === record.tabId) this.removeAttachedView();
    this.detachAndClose(record);
    record.view = null;
    record.loading = false;
    record.waking = null;
  }

  /** Builds the replacement view synchronously; the load it starts is awaited through `record.waking`. */
  private wake(record: TabRecord, index?: number): BrowserViewPort {
    const view = this.dependencies.createView();
    record.view = view;
    record.loading = true;
    record.hiddenSince = this.now();
    this.bindTab(record);
    const contents = view.webContents;
    const history = record.history;
    record.history = null;
    const waiting = this.trackWakeLoad(record, contents, () =>
      history && history.entries.length > 0
        ? contents.navigationHistory
            .restore({ entries: history.entries, index: index ?? history.index })
            .catch((cause) => {
              // Losing back/forward beats losing the page itself.
              console.warn("[browser] navigation history restore failed", cause);
              return contents.loadURL(record.url).then(() => undefined);
            })
        : contents.loadURL(record.url).then(() => undefined)
    );
    record.waking = waiting;
    void waiting.then(() => {
      if (record.waking === waiting) record.waking = null;
    });
    return view;
  }

  private wakeAtOffset(record: TabRecord, offset: number) {
    const history = record.history;
    const index = history
      ? Math.min(Math.max(history.index + offset, 0), history.entries.length - 1)
      : undefined;
    this.wake(record, index);
    this.renderSelection();
    this.emit();
  }

  /** Settles on did-stop-loading / did-fail-load, with a cap so a dead load cannot pin a tool call. */
  private trackWakeLoad(
    record: TabRecord,
    contents: BrowserWebContentsPort,
    start: () => Promise<void>
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        contents.removeListener("did-stop-loading", finish);
        contents.removeListener("did-fail-load", finish);
        resolve();
      };
      const timer = setTimeout(finish, WAKE_LOAD_TIMEOUT_MS);
      timer.unref();
      contents.on("did-stop-loading", finish);
      contents.on("did-fail-load", finish);
      void start()
        .catch((cause) => {
          console.warn("[browser] wake load failed", cause);
          record.loading = false;
          this.emit();
        })
        .finally(finish);
    });
  }

  private bindTab(record: TabRecord) {
    const bound = record.view;
    if (!bound) return;
    secureBrowserContents(bound.webContents, {
      openTab: (url) =>
        void this.createTab({ url, ownerChatId: record.ownerChatId }).catch(
          (cause) => console.warn("[browser] window.open rejected", cause)
        ),
    });
    const refresh = () => {
      const contents = bound.webContents;
      if (contents.isDestroyed()) return;
      record.url = contents.getURL() || record.url;
      record.title = contents.getTitle() || record.title;
      this.emit();
    };
    const start = () => {
      record.loading = true;
      refresh();
    };
    const stop = () => {
      record.loading = false;
      refresh();
    };
    bound.webContents.on("did-navigate", refresh);
    bound.webContents.on("did-navigate-in-page", refresh);
    bound.webContents.on("did-start-loading", start);
    bound.webContents.on("did-stop-loading", stop);
    bound.webContents.on(
      "page-title-updated",
      (_event: unknown, title: string) => {
        record.title = title;
        this.emit();
      }
    );
    bound.webContents.on(
      "page-favicon-updated",
      (_event: unknown, favicons: string[]) => {
        record.faviconUrl = favicons.find((url) => /^https?:|^data:/.test(url));
        this.emit();
      }
    );
  }

  private project(record: TabRecord): BrowserTabProjection {
    const contents = record.view?.webContents;
    const live = contents && !contents.isDestroyed() ? contents : null;
    // A sleeping tab keeps answering back/forward from its saved index, so the
    // address bar arrows read the same before and after the page process dies.
    const history = record.history;
    return {
      tabId: record.tabId,
      ownerChatId: record.ownerChatId,
      url: live ? live.getURL() || record.url : record.url,
      title: live ? live.getTitle() || record.title : record.title,
      ...(record.faviconUrl ? { faviconUrl: record.faviconUrl } : {}),
      loading: record.loading,
      canGoBack: live
        ? live.navigationHistory.canGoBack()
        : (history?.index ?? 0) > 0,
      canGoForward: live
        ? live.navigationHistory.canGoForward()
        : history !== null && history.index < history.entries.length - 1,
      sleeping: record.view === null,
      agentActive: record.agentActive,
      ...(record.agentAction ? { agentAction: record.agentAction } : {}),
    };
  }

  private assertUrl(value: string) {
    const parsed = browserUrlSchema.safeParse(value);
    if (!parsed.success) {
      throw statusError(400, "浏览器只允许 http(s) 地址，拒绝 file:/javascript: 等 scheme");
    }
    return parsed.data;
  }

  private renderSelection() {
    const window = this.window;
    if (!this.visible || !this.hostVisible || !window || window.isDestroyed() || !this.selectedTabId) {
      this.removeAttachedView();
      return;
    }
    const record = this.tabs.get(this.selectedTabId);
    if (!record) {
      this.removeAttachedView();
      return;
    }
    // Becoming the visible selected tab is the wake trigger: the view is created
    // synchronously so the panel has pixels to show, the load runs after.
    const view = record.view ?? this.wake(record);
    if (view.webContents.isDestroyed()) {
      this.removeAttachedView();
      return;
    }
    if (this.attachedTabId !== record.tabId) {
      this.removeAttachedView();
      window.contentView.addChildView(view);
      this.attachedTabId = record.tabId;
    }
    view.setBounds(this.viewport);
  }

  private removeAttachedView() {
    const window = this.window;
    const tabId = this.attachedTabId;
    this.attachedTabId = null;
    if (!window || window.isDestroyed() || !tabId) return;
    const record = this.tabs.get(tabId);
    if (!record?.view) return;
    try {
      window.contentView.removeChildView(record.view);
    } catch {
      // 未挂载的 view 由 Electron 视为 no-op；窄 seam 可选择抛错。
    }
  }

  private detachAndClose(record: TabRecord) {
    const contents = record.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (contents.debugger.isAttached()) {
      try {
        contents.debugger.detach();
      } catch (cause) {
        console.warn("[browser] debugger detach failed", cause);
      }
    }
    contents.close();
  }

  private emit(createdTabId: string | null = null) {
    this.markVisibility();
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send(
        BROWSER_CHANNEL.tabsChanged,
        this.snapshot(createdTabId)
      );
    } catch (cause) {
      console.warn("[browser] projection publish failed", cause);
    }
  }
}
