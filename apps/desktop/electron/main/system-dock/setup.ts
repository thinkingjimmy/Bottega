/**
 * [INPUT]: Depends on DockService, the shared layout/placement/local-state models, the read-only system Dock import adapter, and Electron shell for the Login Items pane.
 * [OUTPUT]: Provides DockSetup: the Settings → Dock flows — setup preview (mode-dependent preselection, existing layout untouched), revision-checked serialized confirmation that refuses stale previews, keeps failed launches retryable, and commits enabled only after the runtime starts, cancel, manual copy, strictly validated display intents and preferences, mode switch, disable, restore, mode-aware renderer/replacement resume, reset, conflict resolution, and the recovery settings deep link.
 * [POS]: system-dock/Settings flow owner (3.1, INV-01/02/07); default and cancelled paths never write system preferences or register anything.
 */

import { shell } from "electron";
import { randomUUID } from "node:crypto";
import type { ConflictChoice, DockSettingsSnapshot, DockSetupPreview, SetupConfirm } from "../../../shared/system-dock/ipc";
import { buildDefaultLayout, type DockLayout } from "../../../shared/system-dock/layout";
import { applyPreferencePatch, dockPreferencePatchSchema, DOCK_CONSENT_VERSION, type DockMode, type DockPreferencePatch } from "../../../shared/system-dock/local-state";
import { appendImported } from "../../../shared/system-dock/placement";
import { confirmedDrafts, readImportCandidates, type ImportSession } from "./native/import";
import type { DockService } from "./service";

type Session = { mode: DockMode | null; import: ImportSession | null; layoutRevision: number; expiresAt: number };
const SESSION_TTL_MS = 30 * 60_000;

export class DockSetup {
  private readonly sessions = new Map<string, Session>();
  private flight: Promise<unknown> = Promise.resolve();
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.flight.then(run, run).finally(() => this.service.publish());
    this.flight = next.catch(() => undefined);
    return next;
  }
  constructor(private readonly service: DockService) {}
  private session(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) { this.sessions.delete(sessionId); throw new Error("DOCK_SETUP_SESSION_EXPIRED"); }
    return session;
  }
  private assertSupported() { if (!this.service.capability.supported) throw new Error("DOCK_UNSUPPORTED"); }
  /** Replacement previews read the system Dock once and preselect; coexistence waits for an explicit copy (P-01, INV-01). */
  async beginSetup(mode: DockMode): Promise<DockSetupPreview> {
    this.assertSupported();
    if (mode === "replace" && !this.service.capability.replacement) throw new Error("DOCK_REPLACEMENT_UNSUPPORTED");
    const record = this.service.ports.config.snapshot();
    const layoutExists = record.layout.initialized;
    const imported = !layoutExists && mode === "replace" && this.service.native && this.service.apps
      ? await readImportCandidates({ native: this.service.native, apps: this.service.apps, mode }) : null;
    return this.open(mode, imported, record.localRevision, layoutExists ? record.layout : this.defaults(imported ? confirmedDrafts(imported, imported.candidates.filter((candidate) => candidate.preselected).map((candidate) => candidate.key)) : []));
  }
  /** Manual "Copy from system Dock": never preselected, appended only after confirmation (3.3). */
  async importCandidates(): Promise<DockSetupPreview> {
    this.assertSupported();
    if (!this.service.native || !this.service.apps) throw new Error("DOCK_UNSUPPORTED");
    const record = this.service.ports.config.snapshot();
    const imported = await readImportCandidates({ native: this.service.native, apps: this.service.apps, mode: "coexist" });
    return this.open(null, imported, record.localRevision, record.layout.initialized ? record.layout : this.defaults([]));
  }
  private open(mode: DockMode | null, imported: ImportSession | null, layoutRevision: number, preview: DockLayout): DockSetupPreview {
    for (const [id, session] of this.sessions) if (session.expiresAt < Date.now()) this.sessions.delete(id);
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { mode, import: imported, layoutRevision, expiresAt: Date.now() + SESSION_TTL_MS });
    return { sessionId, mode: mode ?? this.service.ports.local.get().preferredMode, layoutExists: this.service.ports.config.layout().initialized, layoutRevision,
      candidates: imported?.candidates ?? [], readFailure: imported?.readFailure ?? null, preview };
  }
  private defaults(apps: Parameters<typeof buildDefaultLayout>[0]["apps"]) {
    return buildDefaultLayout({ apps, limitsBackends: this.service.usage.defaultBackends() });
  }
  cancelSetup(sessionId: string) { this.sessions.delete(sessionId); }
  confirmSetup(input: SetupConfirm): Promise<DockSettingsSnapshot> { return this.serial(() => this.confirmSetupNow(input)); }
  private async confirmSetupNow(input: SetupConfirm): Promise<DockSettingsSnapshot> {
    this.assertSupported();
    const session = this.session(input.sessionId);
    if (session.mode !== null && session.mode !== input.mode) throw new Error("DOCK_SETUP_MODE_CHANGED");
    const replace = input.mode === "replace";
    if (replace && (!input.acknowledged || !this.service.capability.replacement)) throw new Error("DOCK_CONSENT_REQUIRED");
    const drafts = session.import ? confirmedDrafts(session.import, input.selected) : [];
    const config = this.service.ports.config;
    /* The preview the user confirmed is only valid for the layout it was built from. Anything since — a local edit,
       or a cloud layout (even a deliberately cleared one) adopted meanwhile — needs a fresh preview, never a merge of
       the old selection into the new layout (3.1, INV-07). Checked inside the store's serialized edit. */
    await config.edit((layout) => layout.initialized ? appendImported(layout, drafts).layout : this.defaults(drafts), session.layoutRevision);
    // A failed launch keeps a retryable preview, but never repeats a committed import.
    session.layoutRevision = config.snapshot().localRevision;
    session.import = null;
    const started = this.service.started;
    try {
      await this.service.ports.ensureBackground();
      if (replace) this.service.replacement?.register();
      if (!started) await this.service.start();
      await this.service.ports.local.update((state) => ({ ...state, enabled: true, preferredMode: input.mode, replacementEnabled: replace,
        consentVersion: replace ? DOCK_CONSENT_VERSION : state.consentVersion }));
      if (replace) await this.service.replacement?.prepare();
      this.sessions.delete(input.sessionId);
      return this.service.settingsSnapshot();
    } catch (cause) {
      if (!started) await this.service.stop("quit").catch(() => undefined);
      throw cause;
    }
  }

  confirmImport(input: { sessionId: string; selected: readonly string[] }): Promise<DockSettingsSnapshot> { return this.serial(() => this.confirmImportNow(input)); }
  private async confirmImportNow(input: { sessionId: string; selected: readonly string[] }): Promise<DockSettingsSnapshot> {
    const session = this.session(input.sessionId);
    const drafts = session.import ? confirmedDrafts(session.import, input.selected) : [];
    this.sessions.delete(input.sessionId);
    if (drafts.length) await this.service.ports.config.edit((layout) => appendImported(layout, drafts).layout);
    await this.service.resolveAll();
    return this.service.settingsSnapshot();
  }
  setPreference(patch: DockPreferencePatch): Promise<DockSettingsSnapshot> { return this.serial(() => this.setPreferenceNow(patch)); }
  private async setPreferenceNow(patch: DockPreferencePatch): Promise<DockSettingsSnapshot> {
    this.assertSupported();
    const { displaySelection, ...preferences } = dockPreferencePatchSchema.parse(patch);
    await this.service.ports.local.update((state) => {
      const displayPreference = displaySelection ? this.service.resolveDisplaySelection(displaySelection) : state.displayPreference;
      const next = applyPreferencePatch(state, preferences, this.service.capability.replacement ? this.service.actualMode() ?? state.preferredMode : "coexist");
      return { ...next, displayPreference };
    });
    this.service.publish();
    return this.service.settingsSnapshot();
  }
  /** Coexistence clears the replacement intent and unregisters; replacement needs the recorded consent (INV-02). */
  setMode(mode: DockMode): Promise<DockSettingsSnapshot> { return this.serial(() => this.setModeNow(mode)); }
  private async setModeNow(mode: DockMode): Promise<DockSettingsSnapshot> {
    const state = this.service.ports.local.get();
    if (mode === "replace") {
      if (!this.service.capability.replacement) throw new Error("DOCK_REPLACEMENT_UNSUPPORTED");
      if (state.consentVersion !== DOCK_CONSENT_VERSION) throw new Error("DOCK_CONSENT_REQUIRED");
      await this.service.ports.local.update((current) => ({ ...current, preferredMode: "replace", replacementEnabled: true }));
      this.service.replacement?.register();
      await this.service.replacement?.prepare();
    } else {
      await this.service.replacement?.unregister();
      await this.service.ports.local.update((current) => ({ ...current, preferredMode: "coexist", replacementEnabled: false }));
    }
    this.service.publish();
    return this.service.settingsSnapshot();
  }
  disable(): Promise<DockSettingsSnapshot> { return this.serial(() => this.disableNow()); }
  private async disableNow(): Promise<DockSettingsSnapshot> {
    await this.service.stop("disable");
    await this.service.ports.local.update((state) => ({ ...state, enabled: false, replacementEnabled: false }));
    this.service.publish();
    return this.service.settingsSnapshot();
  }
  restoreSystemDock(): Promise<DockSettingsSnapshot> { return this.serial(async () => { await this.service.replacement?.suspend("user-restored"); return this.service.settingsSnapshot(); }); }
  resume(): Promise<DockSettingsSnapshot> { return this.serial(async () => {
    if (this.service.actualMode() === "coexist" || !this.service.started) await this.service.resumeBar();
    else {
      if (!this.service.capability.replacement) throw new Error("DOCK_REPLACEMENT_UNSUPPORTED");
      this.service.replacement?.readRegistration();
      await this.service.replacement?.resume();
    }
    return this.service.settingsSnapshot();
  }); }
  resetLayout(): Promise<DockSettingsSnapshot> { return this.serial(() => this.resetLayoutNow()); }
  private async resetLayoutNow(): Promise<DockSettingsSnapshot> {
    await this.service.ports.config.edit(() => this.defaults([]));
    return this.service.settingsSnapshot();
  }
  async resolveConflict(choice: ConflictChoice): Promise<DockSettingsSnapshot> {
    if (!this.service.sync) throw new Error("DOCK_SYNC_UNAVAILABLE");
    await this.service.sync.resolveConflict(choice);
    return this.service.settingsSnapshot();
  }
  async openRecoverySettings() {
    if (process.platform === "darwin") await shell.openExternal("x-apple.systempreferences:com.apple.LoginItems-Settings.extension");
  }
}
