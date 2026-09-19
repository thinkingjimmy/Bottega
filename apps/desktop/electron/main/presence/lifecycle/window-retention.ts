/**
 * [INPUT]: Depends on Product WindowRegistry lifecycle facts, retryable main readiness failures, and quit/recovery callbacks.
 * [OUTPUT]: Provides main hide/restore, deferred opens, last-product quit interception, and bounded crashed-renderer replacement.
 * [POS]: Product window presentation owner; auxiliary windows never participate in product counting.
 */

import type { ProductWindowRecord, WindowRegistry } from "../../window/surfaces/window-registry";
import { MainWindowUnavailableError } from "./main-window-readiness";

export class WindowRetention {
  private launch: (() => Promise<ProductWindowRecord>) | null = null;
  private opening: Promise<ProductWindowRecord> | null = null;
  private openIntent = false;
  private recovered = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly ports: {
    windows: WindowRegistry; enabled(): boolean; quitting(): boolean;
    requestQuit(): void; finished?(): boolean; recovered?(): void; retained?(): void;
  }) {
    this.unsubscribe = ports.windows.subscribe((event) => {
      if (event.type === "registered" && event.record.role === "main") {
        event.record.window.on("close", (...args) => {
          if (ports.quitting()) { if (!ports.finished?.()) (args[0] as { preventDefault(): void }).preventDefault(); return; }
          (args[0] as { preventDefault(): void }).preventDefault();
          if (ports.enabled() || ports.windows.list("app-window").length) { event.record.window.hide?.(); if (ports.enabled()) ports.retained?.(); }
          else ports.requestQuit();
        });
      }
      if (event.type === "renderer-gone" && event.record.role === "main") {
        const visible = event.record.window.isVisible?.() ?? false;
        this.recovered = true;
        ports.windows.invalidate(event.record);
        if (!event.record.window.isDestroyed()) event.record.window.destroy();
        if (visible || !ports.enabled()) this.open();
      }
    });
  }
  get recovering() { return this.opening !== null || this.openIntent; }
  configure(launch: () => Promise<ProductWindowRecord>) { this.launch = launch; }
  async initialize(silent: boolean) { await this.ensureMain(); if (!silent || this.openIntent) this.open(); }
  ensureMain(): Promise<ProductWindowRecord> {
    if (this.opening) return this.opening;
    const main = this.ports.windows.main();
    if (main) return Promise.resolve(main);
    if (!this.launch) return Promise.reject(new Error("MAIN_WINDOW_NOT_READY"));
    this.opening = this.createMain().finally(() => { this.opening = null; });
    return this.opening;
  }
  private async createMain() {
    for (let attempt = 0; ; attempt++) {
      try { return await this.launch!(); }
      catch (cause) {
        // A vanished startup renderer gets one replacement within the shared opening flight.
        if (!(cause instanceof MainWindowUnavailableError) || attempt >= 1 || this.ports.quitting()) throw cause;
      }
    }
  }
  open() {
    if (this.ports.quitting()) return;
    this.openIntent = true;
    if (!this.launch) return;
    void this.ensureMain().then((main) => {
      if (!this.ports.quitting()) { this.ports.windows.focus(main.windowId); this.openIntent = false;
        if (this.recovered) { this.recovered = false; this.ports.recovered?.(); } }
    }).catch((cause) => console.error("[presence] main window restore failed", cause));
  }
  beforeAppClose(record: ProductWindowRecord) {
    if (this.ports.quitting()) return true;
    const otherVisible = this.ports.windows.list().some((candidate) =>
      candidate.windowId !== record.windowId && (candidate.window.isVisible?.() ?? false));
    if (!this.ports.enabled() && !otherVisible && this.ports.windows.list("app-window").length === 1) {
      this.ports.requestQuit(); return true;
    }
    return false;
  }
  close() { this.unsubscribe(); }
}
