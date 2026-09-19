/**
 * [INPUT]: Depends on SettingsStore, login, background-scoped screens, native entries, and window recovery.
 * [OUTPUT]: Provides one background switch, transactional display selection, capability-aware fallback, and durable retry targets.
 * [POS]: Main presence authority; native availability remains distinct from preference command failures.
 */

import type { SettingsStore } from "../settings-store";
import type { EffectiveDisplayPresence, EffectivePresence, PresenceDisplayMode, PresenceReason, PresenceSnapshot } from "../../../shared/presence-ipc";
import { loginProjection, type LoginItemPort } from "./platform/login-item";
import type { PresenceScreenSource } from "./notch/screen-monitor";

type SurfacePort = { enable(): Promise<EffectivePresence>; disable(): void; available(): boolean; effective?(): EffectivePresence };
const disabled = () => ({ status: "disabled" as const, reason: null });
const enabled = () => ({ status: "enabled" as const, reason: null });
export class PresenceService {
  private revision = 0;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(value: PresenceSnapshot) => void>();
  private login: EffectivePresence = { status: "pending", reason: null };
  private retention: EffectivePresence = disabled();
  private display: EffectiveDisplayPresence = disabled();
  private readonly stopWatching: Array<() => void>;
  constructor(private readonly ports: {
    settings: Pick<SettingsStore, "get" | "envelope" | "setTrusted" | "onChanged">;
    supported: boolean; macos: boolean; screens: PresenceScreenSource;
    login: LoginItemPort; tray: SurfacePort; panel: SurfacePort;
    restoreMain(): void; quitting?(): boolean;
  }) {
    let capability = JSON.stringify(ports.screens.capability()), background = ports.settings.get().keepRunningInBackground;
    this.stopWatching = [ports.settings.onChanged(() => {
      const next = ports.settings.get().keepRunningInBackground;
      this.publish(); if (next !== background) { background = next; void this.refresh(); }
    }), ports.screens.onChanged(() => {
      const next = JSON.stringify(ports.screens.capability());
      if (next === capability) return;
      capability = next;
      this.publish();
      if (ports.settings.get().keepRunningInBackground && !this.stopping()) {
        void this.enqueue(async () => { if (!this.stopping()) { await this.reconcile(); this.publish(); } });
      }
    })];
  }
  private mode(): PresenceDisplayMode | null {
    if (this.ports.panel.available()) return "notch";
    return this.ports.tray.available() ? "icon" : null;
  }
  snapshot(): PresenceSnapshot {
    const envelope = this.ports.settings.envelope();
    const { launchAtLogin, keepRunningInBackground, showTaskStatusAtTop } = envelope.settings;
    return { quitting: this.ports.quitting?.() ?? false, revision: this.revision, preferenceRevision: envelope.revision,
      preferences: { launchAtLogin, keepRunningInBackground, showTaskStatusAtTop },
      capabilities: { background: this.ports.supported, displayModeSelection: this.ports.macos, notch: this.ports.screens.capability() },
      effectiveDisplayMode: keepRunningInBackground ? this.mode() : null,
      login: this.login, retention: this.retention, display: this.display,
      top: this.ports.panel.available() ? this.ports.panel.effective?.() ?? enabled() : disabled() };
  }
  onChanged(listener: (value: PresenceSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  observe() { return this.ports.login.observation(); }
  initialize() { return this.refresh(); }
  refresh() {
    return this.enqueue(async () => {
      if (this.stopping()) return this.snapshot();
      try { this.login = loginProjection(this.ports.login, this.ports.settings.get().launchAtLogin, this.ports.login.read()); }
      catch { this.login = { status: "failed", reason: "login-failed" }; }
      if (this.ports.supported && this.ports.settings.get().keepRunningInBackground) await this.ports.screens.start();
      if (!this.stopping()) await this.reconcile();
      return this.publish();
    });
  }
  setLaunchAtLogin(enabled: boolean) {
    if (typeof enabled !== "boolean") return Promise.reject(new Error("PRESENCE_BOOLEAN_REQUIRED"));
    if (this.ports.login.kind !== "macos") return Promise.reject(new Error("LOGIN_ITEM_UNSUPPORTED"));
    return this.enqueue(async () => {
      this.assertLive();
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
  setWindowRetention(target: boolean) {
    if (typeof target !== "boolean") return Promise.reject(new Error("PRESENCE_BOOLEAN_REQUIRED"));
    if (!this.ports.supported) return Promise.reject(new Error("PRESENCE_PLATFORM_UNSUPPORTED"));
    return this.enqueue(async () => {
      this.assertLive();
      const previous = this.mode();
      const wasEnabled = this.ports.settings.get().keepRunningInBackground;
      this.retention = { status: "pending", reason: null }; this.publish();
      try {
        let prepared: Awaited<ReturnType<PresenceService["preparePreferred"]>> | undefined;
        if (target) {
          await this.ports.screens.start(); this.assertLive();
          prepared = await this.preparePreferred();
          if (!prepared.mode) {
            this.retention = { status: "failed", reason: prepared.reason, retryTarget: target };
            if (!wasEnabled) this.clearEntries();
            return this.publish();
          }
        }
        await this.ports.settings.setTrusted({ keepRunningInBackground: target }); this.assertLive();
        if (target && prepared?.mode) {
          this.display = { status: "enabled", reason: prepared.reason };
          this.retention = enabled();
          if (prepared.mode === "notch" && !this.ports.panel.available()) await this.reconcile(true);
          else this.commitEntry(prepared.mode);
        } else {
          this.ports.restoreMain(); this.clearEntries(); this.retention = disabled(); this.display = disabled();
        }
      } catch {
        if (this.stopping()) { this.clearEntries(); return this.snapshot(); }
        this.rollback(previous);
        if (!wasEnabled) this.ports.screens.stop();
        this.retention = { status: "failed", reason: "save-failed", retryTarget: target };
      }
      return this.publish();
    });
  }
  setDisplayMode(target: PresenceDisplayMode) {
    if (target !== "icon" && target !== "notch") return Promise.reject(new Error("PRESENCE_DISPLAY_MODE_REQUIRED"));
    if (!this.ports.macos) return Promise.reject(new Error("PRESENCE_DISPLAY_MODE_UNSUPPORTED"));
    return this.enqueue(async () => {
      this.assertLive();
      if (!this.ports.settings.get().keepRunningInBackground) throw new Error("PRESENCE_BACKGROUND_DISABLED");
      const previous = this.mode();
      this.display = { status: "pending", reason: null }; this.publish();
      try {
        if (target === "notch") await this.ports.screens.start();
        this.assertLive();
        const capability = this.ports.screens.capability();
        const result = target === "notch" && capability.status !== "available"
          ? { status: "failed" as const, reason: capability.reason ?? "screen-unavailable" as const }
          : await this.prepare(target);
        if (result.status !== "enabled") {
          this.display = { status: "failed", reason: result.reason, retryTarget: target };
          if (!this.mode()) await this.reconcile(true);
          return this.publish();
        }
        await this.ports.settings.setTrusted({ showTaskStatusAtTop: target === "notch" }); this.assertLive();
        // Screen changes during a save are reconciled before removing the old entry.
        if (target === "notch" && !this.ports.panel.available()) {
          this.display = { status: "enabled", reason: this.ports.screens.capability().reason };
          await this.reconcile(true);
        } else {
          this.commitEntry(target); this.display = enabled();
          if (this.retention.retryTarget === undefined) this.retention = enabled();
        }
      } catch {
        if (this.stopping()) { this.clearEntries(); return this.snapshot(); }
        this.rollback(previous);
        this.display = { status: "failed", reason: "save-failed", retryTarget: target };
      }
      return this.publish();
    });
  }
  private desiredMode(): PresenceDisplayMode {
    return this.ports.macos && this.ports.settings.get().showTaskStatusAtTop ? "notch" : "icon";
  }
  private async prepare(mode: PresenceDisplayMode): Promise<EffectivePresence> {
    this.assertLive();
    let result: EffectivePresence;
    try { result = await (mode === "notch" ? this.ports.panel : this.ports.tray).enable(); }
    catch { result = { status: "failed", reason: mode === "notch" ? "panel-unavailable" : "tray-unavailable" }; }
    if (this.stopping()) { this.clearEntries(); this.assertLive(); }
    return result;
  }
  private async preparePreferred(forceIcon = false): Promise<{ mode: PresenceDisplayMode | null; reason: PresenceReason }> {
    let reason: PresenceReason = null;
    if (this.desiredMode() === "notch" && !forceIcon) {
      const capability = this.ports.screens.capability();
      if (capability.status === "available") {
        const panel = await this.prepare("notch");
        if (panel.status === "enabled" && this.ports.panel.available()) return { mode: "notch", reason: null };
        reason = panel.reason ?? "panel-unavailable";
      } else reason = capability.reason ?? "screen-unavailable";
    }
    const tray = await this.prepare("icon");
    return { mode: tray.status === "enabled" ? "icon" : null, reason: tray.status === "enabled" ? reason : tray.reason };
  }
  private commitEntry(mode: PresenceDisplayMode) {
    if (mode === "notch") this.ports.tray.disable();
    else this.ports.panel.disable();
  }
  private rollback(previous: PresenceDisplayMode | null) {
    if (previous === "notch" && this.ports.panel.available()) this.ports.tray.disable();
    else if (previous === "icon" && this.ports.tray.available()) this.ports.panel.disable();
    else { this.ports.restoreMain(); this.ports.panel.disable(); this.ports.tray.disable(); }
  }
  private async reconcile(forceIcon = false) {
    if (this.stopping()) return;
    if (!this.ports.supported || !this.ports.settings.get().keepRunningInBackground) {
      this.clearEntries();
      if (this.retention.retryTarget === undefined) this.retention = this.ports.supported ? disabled() : { status: "unsupported", reason: "platform" };
      if (this.display.retryTarget === undefined) this.display = disabled();
      return;
    }
    const prepared = await this.preparePreferred(forceIcon);
    if (prepared.mode) this.commitEntry(prepared.mode);
    if (!this.mode()) { this.ports.restoreMain(); this.ports.panel.disable(); this.ports.tray.disable(); }
    if (this.retention.retryTarget === undefined) this.retention = this.mode() ? enabled() : { status: "failed", reason: prepared.reason };
    if (this.display.retryTarget === undefined) this.display = { status: prepared.mode ? "enabled" : "failed", reason: prepared.reason };
  }
  notifyLifecycle() { this.publish(); }
  panelFailed() {
    if (this.stopping()) return;
    this.display = { status: "failed", reason: "panel-unavailable", retryTarget: "notch" }; this.publish();
    void this.enqueue(async () => { if (!this.stopping()) { await this.reconcile(true); this.publish(); } });
  }
  private stopping() { return this.closed || Boolean(this.ports.quitting?.()); }
  private assertLive() { if (this.stopping()) throw new Error("PRESENCE_QUITTING"); }
  private clearEntries() { this.ports.panel.disable(); this.ports.tray.disable(); this.ports.screens.stop(); }
  close() { this.closed = true; this.stopWatching.forEach((stop) => stop()); this.clearEntries(); this.listeners.clear(); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> { const flight = this.tail.then(work); this.tail = flight.catch(() => {}); return flight; }
  private publish() {
    this.revision += 1;
    const value = this.snapshot();
    for (const listener of this.listeners) { try { listener(value); } catch (cause) { console.warn("[presence] observer failed", cause); } }
    return value;
  }
}
