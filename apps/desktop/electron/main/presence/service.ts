/**
 * [INPUT]: Depends on SettingsStore, login registration, the native menu bar/tray and main-window recovery.
 * [OUTPUT]: Provides independent persistent background and menu bar switches, transactional native icon saves, retry targets and shutdown fencing.
 * [POS]: Main presence authority; background residence does not require a menu bar icon or a Dock widget.
 */
import type { SettingsStore } from "../settings/settings-store";
import type { EffectivePresence, PresenceSnapshot } from "../../../shared/ipc/agent/presence-ipc";
import { loginProjection, type LoginItemPort } from "./platform/login-item";

type SurfacePort = { enable(): Promise<EffectivePresence>; disable(): void; available(): boolean };
const disabled = (): EffectivePresence => ({ status: "disabled", reason: null });
const enabled = (): EffectivePresence => ({ status: "enabled", reason: null });
export class PresenceService {
  private revision = 0;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(value: PresenceSnapshot) => void>();
  private login: EffectivePresence = { status: "pending", reason: null };
  private retention: EffectivePresence = disabled();
  private menuBar: EffectivePresence = disabled();
  private readonly stopWatching: () => void;
  constructor(private readonly ports: {
    settings: Pick<SettingsStore, "get" | "envelope" | "setTrusted" | "onChanged">;
    supported: boolean; login: LoginItemPort; tray: SurfacePort;
    restoreMain(): void; quitting?(): boolean;
  }) {
    let preferences = this.preferences();
    this.stopWatching = ports.settings.onChanged(() => {
      const next = this.preferences();
      this.publish();
      if (next !== preferences) { preferences = next; void this.refresh(); }
    });
  }
  private preferences() {
    const { keepRunningInBackground, showInMenuBar } = this.ports.settings.get();
    return JSON.stringify([keepRunningInBackground, showInMenuBar]);
  }
  snapshot(): PresenceSnapshot {
    const envelope = this.ports.settings.envelope();
    const { launchAtLogin, keepRunningInBackground, showInMenuBar } = envelope.settings;
    return { quitting: this.ports.quitting?.() ?? false, revision: this.revision, preferenceRevision: envelope.revision,
      preferences: { launchAtLogin, keepRunningInBackground, showInMenuBar },
      capabilities: { background: this.ports.supported, menuBar: this.ports.supported },
      login: this.login, retention: this.retention, menuBar: this.menuBar };
  }
  onChanged(listener: (value: PresenceSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  observe() { return this.ports.login.observation(); }
  initialize() { return this.refresh(); }
  refresh() {
    return this.enqueue(async () => {
      if (this.stopping()) return this.snapshot();
      try { this.login = loginProjection(this.ports.login, this.ports.settings.get().launchAtLogin, this.ports.login.read()); }
      catch { this.login = { status: "failed", reason: "login-failed" }; }
      if (this.retention.retryTarget === undefined) this.retention = this.ports.supported
        ? this.ports.settings.get().keepRunningInBackground ? enabled() : disabled() : { status: "unsupported", reason: "platform" };
      const state = await this.reconcileMenuBar();
      if (!this.stopping() && this.menuBar.retryTarget === undefined) this.menuBar = state;
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
      this.assertLive(); this.retention = { status: "pending", reason: null }; this.publish();
      try {
        await this.ports.settings.setTrusted({ keepRunningInBackground: target }); this.assertLive();
        this.retention = target ? enabled() : disabled();
        if (!target) this.ports.restoreMain();
      } catch {
        if (this.stopping()) return this.snapshot();
        this.retention = { status: "failed", reason: "save-failed", retryTarget: target };
      }
      return this.publish();
    });
  }
  setMenuBar(target: boolean) {
    if (typeof target !== "boolean") return Promise.reject(new Error("PRESENCE_BOOLEAN_REQUIRED"));
    if (!this.ports.supported) return Promise.reject(new Error("PRESENCE_PLATFORM_UNSUPPORTED"));
    return this.enqueue(async () => {
      this.assertLive();
      const previous = this.ports.settings.get().showInMenuBar;
      this.menuBar = { status: "pending", reason: null }; this.publish();
      try {
        if (target) {
          const prepared = await this.prepareTray(); this.assertLive();
          if (prepared.status !== "enabled") {
            this.menuBar = { status: "failed", reason: prepared.reason, retryTarget: target };
            return this.publish();
          }
        }
        await this.ports.settings.setTrusted({ showInMenuBar: target }); this.assertLive();
        if (!target) this.ports.tray.disable();
        this.menuBar = target ? enabled() : disabled();
      } catch {
        if (this.stopping()) { this.ports.tray.disable(); return this.snapshot(); }
        if (!previous) this.ports.tray.disable();
        this.menuBar = { status: "failed", reason: "save-failed", retryTarget: target };
      }
      return this.publish();
    });
  }
  private async prepareTray(): Promise<EffectivePresence> {
    try { return await this.ports.tray.enable(); }
    catch { return { status: "failed", reason: "tray-unavailable" }; }
    finally { if (this.stopping()) this.ports.tray.disable(); }
  }
  private async reconcileMenuBar(): Promise<EffectivePresence> {
    if (!this.ports.supported || !this.ports.settings.get().showInMenuBar) {
      this.ports.tray.disable();
      return this.ports.supported ? disabled() : { status: "unsupported", reason: "platform" };
    }
    const result = await this.prepareTray();
    if (!this.stopping() && result.status !== "enabled") this.ports.restoreMain();
    return result;
  }
  notifyLifecycle() { this.publish(); }
  private stopping() { return this.closed || Boolean(this.ports.quitting?.()); }
  private assertLive() { if (this.stopping()) throw new Error("PRESENCE_QUITTING"); }
  close() { this.closed = true; this.stopWatching(); this.ports.tray.disable(); this.listeners.clear(); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> { const flight = this.tail.then(work); this.tail = flight.catch(() => {}); return flight; }
  private publish() {
    this.revision += 1;
    const value = this.snapshot();
    for (const listener of this.listeners) { try { listener(value); } catch (cause) { console.warn("[presence] observer failed", cause); } }
    return value;
  }
}
