/**
 * [INPUT]: Depends on shared Browser IPC, can be injected into WebContentsView/BrowserWindow seam and browser/security
 * [OUTPUT]: Provides BrowserPanelService: Universal tab pool, only active view, project event, chat release, single tab, only Agent batch and security destruction
 * [POS]: Main/browser lifecycle truth source shared by renderer and tool callers
 */

import { randomUUID } from "node:crypto";
import {
  BROWSER_CHANNEL,
  BROWSER_DEFAULT_URL,
  BROWSER_TAB_LIMIT,
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

export type BrowserNavigationHistoryPort = {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
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
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
};

type TabRecord = {
  tabId: string;
  view: BrowserViewPort;
  ownerChatId: string | null;
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  agentActive: boolean;
  agentAction?: string;
};

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

  constructor(private readonly dependencies: BrowserPanelServiceDependencies) {
    this.tabLimit = dependencies.tabLimit ?? BROWSER_TAB_LIMIT;
  }

  register(window: BrowserWindowPort, rendererUrl: string) {
    this.removeAttachedView();
    this.window = window;
    rendererIpc(window, rendererUrl, "拒绝非主窗口的浏览器请求")
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
    this.emit();
    await record.view.webContents.loadURL(url);
  }

  goBack(tabId: string) {
    const navigation = this.requireTab(tabId).view.webContents.navigationHistory;
    if (navigation.canGoBack()) navigation.goBack();
  }

  goForward(tabId: string) {
    const navigation = this.requireTab(tabId).view.webContents.navigationHistory;
    if (navigation.canGoForward()) navigation.goForward();
  }

  reload(tabId: string) {
    this.requireTab(tabId).view.webContents.reload();
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
    return this.visible ? this.selectedTabId : null;
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
      (record) => record.view.webContents === contents
    );
    if (!registered) {
      throw statusError(403, "拒绝调试非 Agent Browser 的 webContents");
    }
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

  private bindTab(record: TabRecord) {
    secureBrowserContents(record.view.webContents, {
      openTab: (url) =>
        void this.createTab({ url, ownerChatId: record.ownerChatId }).catch(
          (cause) => console.warn("[browser] window.open rejected", cause)
        ),
    });
    const refresh = () => {
      const contents = record.view.webContents;
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
    record.view.webContents.on("did-navigate", refresh);
    record.view.webContents.on("did-navigate-in-page", refresh);
    record.view.webContents.on("did-start-loading", start);
    record.view.webContents.on("did-stop-loading", stop);
    record.view.webContents.on(
      "page-title-updated",
      (_event: unknown, title: string) => {
        record.title = title;
        this.emit();
      }
    );
    record.view.webContents.on(
      "page-favicon-updated",
      (_event: unknown, favicons: string[]) => {
        record.faviconUrl = favicons.find((url) => /^https?:|^data:/.test(url));
        this.emit();
      }
    );
  }

  private project(record: TabRecord): BrowserTabProjection {
    const contents = record.view.webContents;
    const navigation = contents.navigationHistory;
    return {
      tabId: record.tabId,
      ownerChatId: record.ownerChatId,
      url: contents.isDestroyed() ? record.url : contents.getURL() || record.url,
      title: contents.isDestroyed()
        ? record.title
        : contents.getTitle() || record.title,
      ...(record.faviconUrl ? { faviconUrl: record.faviconUrl } : {}),
      loading: record.loading,
      canGoBack: !contents.isDestroyed() && navigation.canGoBack(),
      canGoForward: !contents.isDestroyed() && navigation.canGoForward(),
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
    if (!this.visible || !window || window.isDestroyed() || !this.selectedTabId) {
      this.removeAttachedView();
      return;
    }
    const record = this.tabs.get(this.selectedTabId);
    if (!record || record.view.webContents.isDestroyed()) {
      this.removeAttachedView();
      return;
    }
    if (this.attachedTabId !== record.tabId) {
      this.removeAttachedView();
      window.contentView.addChildView(record.view);
      this.attachedTabId = record.tabId;
    }
    record.view.setBounds(this.viewport);
  }

  private removeAttachedView() {
    const window = this.window;
    const tabId = this.attachedTabId;
    this.attachedTabId = null;
    if (!window || window.isDestroyed() || !tabId) return;
    const record = this.tabs.get(tabId);
    if (!record) return;
    try {
      window.contentView.removeChildView(record.view);
    } catch {
      // 未挂载的 view 由 Electron 视为 no-op；窄 seam 可选择抛错。
    }
  }

  private detachAndClose(record: TabRecord) {
    const contents = record.view.webContents;
    if (contents.isDestroyed()) return;
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

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
