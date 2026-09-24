/**
 * [INPUT]: Depends on an injected panel window factory/placement/focus ports and timers; no Electron import so the lifecycle is testable.
 * [OUTPUT]: Provides PanelLifecycle: absent → creating → hidden-ready → visible → idle → destroyed with single-flight creation, cancellable hover prewarm, one retained cold open intent keyed by interaction generation, busy feedback, focused vs non-activating presentation, idle destruction (60 s), and immediate teardown on lock/display change.
 * [POS]: system-dock/window panel owner (5.2, INV-09/18); prewarm never shows, focuses, or creates demand, and a cancelled or superseded intent never pops up later.
 */

import type { PanelView } from "../../../../shared/system-dock/ipc";

export type PanelState = "absent" | "creating" | "hidden-ready" | "visible" | "idle";
export type PanelWindow = { show(): void; showInactive(): void; focus(): void; hide(): void; destroy(): void; isDestroyed(): boolean;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void; isFocused(): boolean };
export type OpenRequest = { view: PanelView; focus: boolean; anchor: string | null };
export type PanelPorts = {
  create(): Promise<PanelWindow>;
  place(anchor: string | null): { x: number; y: number; width: number; height: number } | null;
  /** Re-validated right before a cold intent is shown: same account, display, target still present. */
  stillValid(request: OpenRequest, generation: number): boolean;
  presented(request: OpenRequest | null, focused: boolean): void;
  busy(anchor: string | null): void;
  failed(cause: unknown): void;
  idleMs?: number;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
};

export class PanelLifecycle {
  private state: PanelState = "absent";
  private window: PanelWindow | null = null;
  private creating: Promise<PanelWindow | null> | null = null;
  private generation = 0;
  private request: OpenRequest | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  constructor(private readonly ports: PanelPorts) {}
  current() { return { state: this.state, request: this.request, focused: Boolean(this.window && !this.window.isDestroyed() && this.window.isFocused()) }; }
  get visible() { return this.state === "visible"; }
  private get timers() { return this.ports.timers ?? { setTimeout, clearTimeout }; }
  /** Hover prewarm: creates hidden, never shows or focuses; a quick exit simply lets the idle timer reclaim it. */
  prewarm() { if (this.state === "absent") void this.ensure(); }
  private ensure(): Promise<PanelWindow | null> {
    if (this.window && !this.window.isDestroyed()) return Promise.resolve(this.window);
    if (this.creating) return this.creating;
    const epoch = this.epoch;
    this.state = "creating";
    const creating: Promise<PanelWindow | null> = this.ports.create().then((window) => {
      if (epoch !== this.epoch) { window.destroy(); return null; }
      this.window = window;
      if (this.state === "creating") { this.state = "hidden-ready"; this.armIdle(); }
      return window;
    }, (cause) => { if (epoch === this.epoch) { this.state = "absent"; this.ports.failed(cause); } return null; })
      .finally(() => { if (this.creating === creating) this.creating = null; });
    this.creating = creating;
    return creating;
  }
  /**
   * Opens now when warm; when cold, shows busy feedback and keeps exactly one intent, re-checked
   * after creation. A newer open/close/lock bumps the generation and the stale intent is dropped.
   */
  async open(request: OpenRequest): Promise<void> {
    const generation = ++this.generation;
    this.request = request;
    this.cancelIdle();
    const cold = !(this.window && !this.window.isDestroyed());
    if (cold) this.ports.busy(request.anchor);
    const window = await this.ensure();
    if (cold) this.ports.busy(null);
    if (!window || generation !== this.generation || !this.ports.stillValid(request, generation)) return;
    const bounds = this.ports.place(request.anchor);
    if (!bounds) { this.close(); return; }
    window.setBounds(bounds);
    this.state = "visible";
    if (request.focus) { window.show(); window.focus(); } else window.showInactive();
    this.ports.presented(request, request.focus);
  }
  /** Promote a read-only panel to an interactive one after the user acts inside it. */
  focus() {
    if (this.state !== "visible" || !this.window || this.window.isDestroyed() || !this.request) return;
    if (!this.request.focus) { this.request = { ...this.request, focus: true }; this.window.focus(); this.ports.presented(this.request, true); }
  }
  reposition() {
    if (this.state !== "visible" || !this.window || this.window.isDestroyed()) return;
    const bounds = this.ports.place(this.request?.anchor ?? null);
    if (bounds) this.window.setBounds(bounds); else this.close();
  }
  close() {
    this.generation++;
    const wasVisible = this.state === "visible";
    this.request = null;
    if (this.window && !this.window.isDestroyed()) { this.window.hide(); this.state = "idle"; this.armIdle(); }
    else if (this.state !== "creating") this.state = "absent";
    if (wasVisible) this.ports.presented(null, false);
  }
  private armIdle() {
    this.cancelIdle();
    this.idleTimer = this.timers.setTimeout(() => { this.idleTimer = null; if (this.state !== "visible") this.destroy(); }, this.ports.idleMs ?? 60_000);
  }
  private cancelIdle() { if (this.idleTimer) this.timers.clearTimeout(this.idleTimer); this.idleTimer = null; }
  /** Lock, display change, disable, or idle: cancel creation, drop intents, release the renderer (INV-18). */
  destroy() {
    this.epoch++; this.generation++;
    this.cancelIdle(); this.creating = null;
    const wasVisible = this.state === "visible";
    const window = this.window; this.window = null; this.request = null; this.state = "absent";
    if (window && !window.isDestroyed()) window.destroy();
    if (wasVisible) this.ports.presented(null, false);
  }
}
