/**
 * [INPUT]: Depends on shared Browser IPC, the injectable native window/view ports in ./ports, browser security, and shared status errors.
 * [OUTPUT]: Provides BrowserPanelService with a shared tab pool, replaceable host visibility tracking released on renderer destruction, renderer IPC, Agent batch cancellation, and background-tab sleep/wake with history restore.
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
} from "../../../shared/ipc/workspace/browser-ipc";
import { statusError } from "../ipc/errors";
import { rendererIpc } from "../registration/ipc-registrar";
import type { BrowserViewPort, BrowserWebContentsPort, BrowserWindowPort, TabRecord } from "./ports";
import { secureBrowserContents } from "./security";

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
  /* E3-01: the tab the person chose themselves (a click, a keyboard selection, or opening it). Only the renderer's person IPC sets
     it; any other change of selection — an Agent open, artifact reuse, the fallback after a close — clears it. */
  private personSelectedTabId: string | null = null;
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
        return this.createTab({ url: input.url, ownerChatId: null, byPerson: true });
      })
      .handle(BROWSER_CHANNEL.closeTab, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.closeTab(tabId);
        return this.snapshot();
      })
      .handle(BROWSER_CHANNEL.activateTab, (raw) => {
        const { tabId } = browserTabRequestSchema.parse(raw);
        this.selectByPerson(tabId);
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
      this.releaseHost?.();
      this.releaseHost = null;
      this.removeAttachedView();
      this.window = null;
      this.visible = false;
      this.hostVisible = false;
      this.emit();
    });
    this.renderSelection();
    this.emit();
  }

  async createTab(input: {
    url?: string;
    ownerChatId: string | null;
    /** The person opened it: their choice from creation, not after the page loads (E3-01). */
    byPerson?: boolean;
  }): Promise<BrowserTabProjection> {
    const artifactUrl = input.url && /^https:\/\/(?:claude\.ai|preview\.claude\.ai)\/code\/artifact\/[A-Za-z0-9-]+\/?$/.test(input.url) ? input.url : null;
    // Reused only by the Chat that opened it (F-46 ⑤); the tool layer refuses another Chat's tab too (E3-01), so no other Chat receives it or its snapshot.
    const existingArtifact = artifactUrl ? [...this.tabs.values()].find(tab => tab.url === artifactUrl && tab.ownerChatId === input.ownerChatId) : undefined;
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
    this.select(tabId, input.byPerson === true);
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
      // Falling back to a neighbour is not the person choosing it.
      this.select(ids[index + 1] ?? ids[index - 1] ?? null, false);
    }
    this.detachAndClose(record);
    this.tabs.delete(tabId);
    this.renderSelection();
    this.emit();
  }

  activateTab(tabId: string) {
    this.requireTab(tabId);
    this.select(tabId, false);
    this.renderSelection();
    this.emit();
  }

  /** The person selected this tab themselves; only renderer IPC calls this. */
  selectByPerson(tabId: string) {
    this.requireTab(tabId);
    // Already on screen: record the choice without re-parenting the view.
    if (this.selectedTabId === tabId) { this.personSelectedTabId = tabId; this.emit(); return; }
    this.select(tabId, true);
    this.renderSelection();
    this.emit();
  }

  private select(tabId: string | null, byPerson: boolean) {
    this.selectedTabId = tabId;
    this.personSelectedTabId = byPerson ? tabId : null;
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

  /** The person's tab a Chat may read: selected by the person and showing right now (E3-01). */
  get personReadableTabId() {
    const active = this.activeTabId;
    return active !== null && active === this.personSelectedTabId ? active : null;
  }

  get activeTabId() {
    return this.visible && this.hostVisible && !this.window?.isDestroyed() &&
      (this.window?.isVisible?.() ?? false) && !(this.window?.isMinimized?.() ?? false) ? this.selectedTabId : null;
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
      personSelectedTabId: this.personSelectedTabId,
      createdTabId,
    };
  }

  shutdown() {
    this.cancelSweep();
    this.visible = false;
    this.releaseHost?.();
    this.releaseHost = null;
    this.removeAttachedView();
    for (const controller of this.batchControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new Error("应用正在退出，浏览器动作批次终止"));
      }
    }
    this.batchControllers.clear();
    const records = [...this.tabs.values()];
    this.tabs.clear();
    this.select(null, false);
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
