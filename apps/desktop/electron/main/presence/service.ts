/**
 * [INPUT]: Depends on SettingsStore envelopes, the selected login adapter, tray/panel ports, and restore intent.
 * [OUTPUT]: Provides serialized presence preferences, effective states carrying failed command targets, a single panel-or-tray recovery entry, live panel shortcut availability, revisioned observers, compensation, and readonly system-write observations.
 * [POS]: Main presence owner; settings writes and native presentation facts converge here.
 */

import type { SettingsStore } from "../settings-store";
import type { EffectivePresence, PresenceSnapshot } from "../../../shared/presence-ipc";
import { loginProjection, type LoginItemPort } from "./platform/login-item";

type SurfacePort = { enable(): Promise<EffectivePresence>; disable(): void; available(): boolean; effective?(): EffectivePresence };
const disabled = (): EffectivePresence => ({ status: "disabled", reason: null });
export class PresenceService {
  private revision = 0;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(value: PresenceSnapshot) => void>();
  private login: EffectivePresence = { status: "pending", reason: null };
  private retention: EffectivePresence = disabled();
  private top: EffectivePresence = disabled();
  private readonly unwatch: () => void;
  private topPreference = false;
  constructor(private readonly ports: {
    settings: Pick<SettingsStore, "get" | "envelope" | "setTrusted" | "onChanged">;
    supported: boolean; login: LoginItemPort; tray: SurfacePort; panel: SurfacePort;
    restoreMain(): void; quitting?(): boolean;
  }) {
    this.unwatch = ports.settings.onChanged(() => {
      if (ports.settings.get().showTaskStatusAtTop !== this.topPreference) void this.enqueue(() => this.applyTop());
      this.publish();
    });
  }
  snapshot(): PresenceSnapshot {
    const envelope = this.ports.settings.envelope();
    const { launchAtLogin, keepRunningInBackground, showTaskStatusAtTop } = envelope.settings;
    return { quitting: this.ports.quitting?.() ?? false, revision: this.revision, preferenceRevision: envelope.revision,
      preferences: { launchAtLogin, keepRunningInBackground, showTaskStatusAtTop },
      login: this.login, retention: this.retention, top: this.top.status === "enabled" ? this.ports.panel.effective?.() ?? this.top : this.top };
  }
  onChanged(listener: (value: PresenceSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  observe() { return this.ports.login.observation(); }
  async initialize() {
    await this.refresh();
    if (this.closed) return;
    if (!this.ports.supported) this.retention = { status: "unsupported", reason: "platform" };
    await this.applyTop();
    this.publish();
  }
  refresh() {
    return this.enqueue(async () => {
      if (this.closed) return this.snapshot();
      try { this.login = loginProjection(this.ports.login, this.ports.settings.get().launchAtLogin, this.ports.login.read()); }
      catch { this.login = { status: "failed", reason: "login-failed" }; }
      if (this.top.status === "enabled") this.top = await this.ports.panel.enable();
      if (this.top.status === "failed" && this.ports.settings.get().showTaskStatusAtTop) await this.applyTop();
      if (this.retention.status === "enabled" && !this.hasPanelEntry() && !this.ports.tray.available()) {
        this.ports.restoreMain();
        this.retention = { status: "failed", reason: "tray-unavailable" };
        this.ports.tray.disable();
      }
      return this.publish();
    });
  }
  setLaunchAtLogin(enabled: boolean) {
    if (typeof enabled !== "boolean") return Promise.reject(new Error("PRESENCE_BOOLEAN_REQUIRED"));
    if (this.ports.login.kind !== "macos") return Promise.reject(new Error("LOGIN_ITEM_UNSUPPORTED"));
    return this.enqueue(async () => {
      if (this.closed || this.ports.quitting?.()) throw new Error("PRESENCE_QUITTING");
      this.login = { status: "pending", reason: null }; this.publish();
      let previous: ReturnType<LoginItemPort["read"]> | undefined;
      let wrote = false;
      let verified = false;
      try {
        previous = this.ports.login.read();
        this.ports.login.write(enabled); wrote = true;
        const fact = this.ports.login.read();
        if (enabled !== fact.enabled && !(enabled && fact.approval)) throw new Error("LOGIN_ITEM_VERIFY_FAILED");
        verified = true;
        await this.ports.settings.setTrusted({ launchAtLogin: enabled });
        this.login = loginProjection(this.ports.login, enabled, fact);
      } catch {
        let compensationFailed = false;
        if (wrote && previous) {
          try {
            this.ports.login.write(previous.enabled);
            compensationFailed = this.ports.login.read().enabled !== previous.enabled;
          } catch { compensationFailed = true; }
        }
        this.login = { status: "failed", reason: compensationFailed || !verified ? "login-failed" : "save-failed", retryTarget: enabled };
      }
      return this.publish();
    });
  }
  setWindowRetention(enabled: boolean) {
    if (typeof enabled !== "boolean") return Promise.reject(new Error("PRESENCE_BOOLEAN_REQUIRED"));
    if (!this.ports.supported) return Promise.reject(new Error("PRESENCE_PLATFORM_UNSUPPORTED"));
    return this.enqueue(async () => {
      if (this.closed || this.ports.quitting?.()) throw new Error("PRESENCE_QUITTING");
      const wasEnabled = this.ports.settings.get().keepRunningInBackground;
      this.retention = { status: "pending", reason: null }; this.publish();
      try {
        const status = enabled ? await this.prepareRetentionEntry() : disabled();
        if (enabled && status.status !== "enabled") { this.retention = { ...status, retryTarget: enabled }; return this.publish(); }
        await this.ports.settings.setTrusted({ keepRunningInBackground: enabled });
        this.retention = status;
        if (!enabled) { this.ports.restoreMain(); this.ports.tray.disable(); }
      } catch {
        if (!wasEnabled) this.ports.tray.disable();
        this.retention = { status: "failed", reason: "save-failed", retryTarget: enabled };
      }
      return this.publish();
    });
  }
  private async applyTop() {
    if (this.closed || this.ports.quitting?.()) return;
    this.topPreference = this.ports.settings.get().showTaskStatusAtTop;
    if (!this.ports.supported) { this.top = { status: "unsupported", reason: "platform" }; return; }
    if (!this.topPreference) {
      // Establish the replacement before removing the current recovery entry.
      await this.syncRetentionEntry(true);
      this.ports.panel.disable(); this.top = disabled();
    }
    else {
      this.top = { status: "pending", reason: null }; this.publish();
      try { this.top = await this.ports.panel.enable(); } catch { this.top = { status: "failed", reason: "panel-unavailable" }; }
      await this.syncRetentionEntry();
    }
    this.publish();
  }
  private hasPanelEntry() { return this.top.status === "enabled" && this.ports.panel.available(); }
  private async prepareRetentionEntry(): Promise<EffectivePresence> {
    if (this.hasPanelEntry()) {
      if (this.ports.tray.available()) this.ports.tray.disable();
      return { status: "enabled", reason: null };
    }
    return this.ports.tray.enable();
  }
  private async syncRetentionEntry(forceTray = false) {
    if (this.closed || !this.ports.supported || this.ports.quitting?.() || !this.ports.settings.get().keepRunningInBackground) return;
    const commandFailure = this.retention.retryTarget === undefined ? null : this.retention;
    let effective: EffectivePresence;
    try { effective = forceTray ? await this.ports.tray.enable() : await this.prepareRetentionEntry(); }
    catch { effective = { status: "failed", reason: "tray-unavailable" }; }
    if (this.closed || this.ports.quitting?.()) return;
    if (effective.status !== "enabled") { this.ports.restoreMain(); this.ports.tray.disable(); }
    // Switching presentation must not erase a failed preference command or its retry target.
    this.retention = commandFailure ?? effective;
  }
  notifyLifecycle() { this.publish(); }
  panelFailed() {
    if (this.closed) return;
    this.top = { status: "failed", reason: "panel-unavailable" }; this.publish();
    void this.enqueue(async () => { await this.syncRetentionEntry(); if (!this.closed) this.publish(); });
  }
  close() { this.closed = true; this.unwatch(); this.ports.panel.disable(); this.ports.tray.disable(); this.listeners.clear(); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> { const flight = this.tail.then(work); this.tail = flight.catch(() => {}); return flight; }
  private publish() {
    this.revision += 1;
    const value = this.snapshot();
    for (const listener of this.listeners) { try { listener(value); } catch (cause) { console.warn("[presence] observer failed", cause); } }
    return value;
  }
}
