/**
 * [INPUT]: Depends on Electron-compatible BrowserWindow/WebContents event and send capabilities plus product window roles
 * [OUTPUT]: Provides WindowRegistry, global windowRegistry, stable main/app lookup, focus, lifecycle events, and role-scoped publication
 * [POS]: Window surfaces process-global identity owner; no caller selects a window through BrowserWindow.getAllWindows ordering
 */

import type { ProductWindowRole } from "../../../../shared/window-surfaces-ipc";

export type RegisteredWebContents = {
  id: number;
  session: object;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
};

export type RegisteredBrowserWindow = {
  id: number;
  webContents: RegisteredWebContents;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  destroy(): void;
  once(event: "closed", listener: () => void): unknown;
  on(
    event: "closed" | "close" | "ready-to-show" | "unresponsive",
    listener: (...args: unknown[]) => void
  ): unknown;
};

export type ProductWindowRecord = Readonly<{
  windowId: string;
  role: ProductWindowRole;
  appId: string | null;
  rendererUrl: string;
  sessionPartition: string;
  session: object;
  window: RegisteredBrowserWindow;
  webContentsId: number;
}>;

export type WindowRegistryEvent =
  | Readonly<{ type: "registered"; record: ProductWindowRecord }>
  | Readonly<{ type: "closed"; record: ProductWindowRecord }>
  | Readonly<{ type: "renderer-gone"; record: ProductWindowRecord; reason: string }>;

type RendererGoneSource = RegisteredWebContents & {
  on?(event: "render-process-gone", listener: (_event: unknown, details: { reason?: string }) => void): unknown;
};

export class WindowRegistry {
  private readonly records = new Map<string, ProductWindowRecord>();
  private readonly byContents = new Map<number, ProductWindowRecord>();
  private readonly goneContents = new Set<number>();
  private readonly listeners = new Set<(event: WindowRegistryEvent) => void>();

  register(
    input: Omit<ProductWindowRecord, "session" | "sessionPartition" | "webContentsId"> &
      Readonly<{ sessionPartition?: string }>
  ) {
    const existing = this.records.get(input.windowId);
    if (existing && existing.window !== input.window) {
      throw new Error(`Product window id already exists: ${input.windowId}`);
    }
    const record: ProductWindowRecord = Object.freeze({
      ...input,
      webContentsId: input.window.webContents.id,
      sessionPartition: input.sessionPartition ?? "default",
      session: input.window.webContents.session,
    });
    this.records.set(record.windowId, record);
    this.byContents.set(record.webContentsId, record);
    this.goneContents.delete(record.webContentsId);
    input.window.once("closed", () => this.remove(record));
    const contents = input.window.webContents as RendererGoneSource;
    contents.on?.("render-process-gone", (_event, details) => {
      this.goneContents.add(record.webContentsId);
      this.emit({
        type: "renderer-gone",
        record,
        reason: details?.reason ?? "unknown",
      });
    });
    this.emit({ type: "registered", record });
    return record;
  }

  get(windowId: string) {
    return this.live(this.records.get(windowId));
  }

  fromWebContents(webContentsId: number) {
    return this.live(this.byContents.get(webContentsId));
  }

  main() {
    return [...this.records.values()].find(
      (record) => record.role === "main" && this.live(record)
    );
  }

  app(appId: string) {
    return [...this.records.values()].find(
      (record) =>
        record.role === "app-window" &&
        record.appId === appId &&
        this.live(record)
    );
  }

  list(role?: ProductWindowRole) {
    return [...this.records.values()].filter(
      (record) => this.live(record) && (!role || record.role === role)
    );
  }

  focus(windowId: string) {
    const record = this.get(windowId);
    if (!record) return false;
    if (record.window.isMinimized()) record.window.restore();
    record.window.show();
    record.window.focus();
    return true;
  }

  publish(
    channel: string,
    value: unknown,
    predicate: (record: ProductWindowRecord) => boolean = () => true
  ) {
    let delivered = 0;
    for (const record of this.list()) {
      if (!predicate(record) || record.window.webContents.isDestroyed()) continue;
      record.window.webContents.send(channel, value);
      delivered += 1;
    }
    return delivered;
  }

  subscribe(listener: (event: WindowRegistryEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private remove(record: ProductWindowRecord) {
    if (this.records.get(record.windowId) !== record) return;
    this.records.delete(record.windowId);
    this.byContents.delete(record.webContentsId);
    this.goneContents.delete(record.webContentsId);
    this.emit({ type: "closed", record });
  }

  private live(record: ProductWindowRecord | undefined) {
    return record &&
      !this.goneContents.has(record.webContentsId) &&
      !record.window.isDestroyed()
      ? record
      : undefined;
  }

  private emit(event: WindowRegistryEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

export const windowRegistry = new WindowRegistry();
