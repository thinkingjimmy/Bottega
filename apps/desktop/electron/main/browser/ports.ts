/**
 * [INPUT]: Depends on shared Browser IPC for the viewport shape.
 * [OUTPUT]: Provides the injectable Electron ports the Browser panel drives (debugger, navigation history, web contents, session, view, window) and TabRecord, one pooled tab's state.
 * [POS]: Type-only seam of main/browser: BrowserPanelService, security, the agent overlay, CDP harness and action execution depend on these instead of Electron, so tests can inject fakes.
 */
import type { BrowserViewport } from "../../../shared/ipc/workspace/browser-ipc";

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
