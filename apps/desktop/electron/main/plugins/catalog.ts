/**
 * [INPUT]: Depends on the plugin contract (BUILTIN_PLUGINS, views, details, settings, contract kinds), the one resolver (resolve.ts), the
 *           projections (describe.ts), the reserved identity policy, provenance-bearing owners, plugin state and settings stores, and read/disable ports over the Extension Registry, host-package
 *           manifests, each Agent's native plugins, Agent configurations and health; uses SerialQueue for settings persistence.
 * [OUTPUT]: Provides PluginCatalog — list, detail, setEnabled (C.3's rules: always-on, setup-required, unsupported, not-switchable),
 *           settings / setSettings (serialized persistence and revision-bound restart acknowledgement, or the owner's adapter with confirm), stopAdmission / close (flush accepted settings), resolve (the shared Resolution over every plugin),
 *           refresh (re-read and announce) / resolveNow, providerEnabled, workflowEnabled, workflowBlockedBy (named reasons for admission), dependentsOf, effectsOf and providersOf (impact),
 *           providerOverrides (what the Provider adapters may send), applyStoredStates, onChanged — plus PluginError, BuiltinOwner, CatalogPorts and
 *           installProviderPluginSettings / providerPluginSettings (the turn freeze's read of it).
 * [POS]: The desktop owner of the plugins page (T-P1/T-P4/T-P5). Built-ins switch in plugin-states.json (or through their own owner),
 *        installed packages through the Registry's disable convergence and re-enable, Agent-native plugins by their Agent. App packages
 *        participate in dependency resolution but stay outside plugin-facing views; disabled packages retain their manifest metadata.
 */
import { BUILTIN_PLUGINS, isReservedPluginId, type PluginDescriptor } from "@bottega/contracts/plugins/descriptor";
import { contractKindOf, type Resolution } from "@bottega/contracts/plugins/contracts";
import type { PluginDetail, PluginHealth, PluginView } from "@bottega/contracts/plugins/catalog";
import type { PluginEffectKind } from "@bottega/contracts/plugins/impact";
import { pluginDetailSchema, pluginViewSchema } from "@bottega/contracts/plugins/catalog";
import type { PluginSettingsView, SettingsAdapter, SettingsPatch, SettingsSubmitResult, SettingValue } from "@bottega/contracts/plugins/settings";
import type { LocalizedText } from "@bottega/contracts/plugins/text";
import type { HostPackageManifest } from "@bottega/contracts/host/manifest";
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import type { ProductResourceScope } from "@ai-chat/cloud-protocol/contracts/resources";
import type { AgentPluginInventoryEntry } from "../../../shared/ipc/settings/extensions-ipc";
import { hostPackageSwitchable } from "../extensions/product-policy";
import { builtinEntry, nativeEntry, nodeOf, packageEntry, viewOf, type PluginEntry } from "./describe";
import { resolvePlugins } from "./resolve";
import { SettingsRefusal, type PluginSettingsStore } from "./settings-store";
import { SerialQueue } from "../persistence/serial-queue";
import type { PluginStateStore } from "./states";

export class PluginError extends Error {}

/* The one catalog of this process, for the turn freeze (window/main-window.ts) that is composed apart from the foundation. */
let installed: PluginCatalog | null = null;
export const installProviderPluginSettings = (catalog: PluginCatalog | null) => { installed = catalog; };
export const installedPluginCatalog = () => installed;
/** A Provider plugin's changed settings for a turn about to start; empty when nothing changed or no catalog is composed. */
export const providerPluginSettings = (providerId: string) => installed?.providerOverrides(providerId) ?? Promise.resolve({});
type HostPackage = Readonly<{ installIdentity: string; scope: ProductResourceScope; administrativeState: string }>;

/** A built-in plugin whose switch has its own owner (Memory, Dock, Sketch join through this): the catalog reads it, never stores it. */
export type BuiltinOwner = Readonly<{
  descriptor: PluginDescriptor;
  /** Main-owned facts; ordinary plugin manifests cannot claim official provenance. */
  presentation?: Readonly<{official:boolean;version:string|null;origin?:string}>;
  enabled(): boolean;
  setEnabled?(enabled: boolean): Promise<void>;
  unsupported?(): LocalizedText | null;
  turnedOffAt?(): number | null;
  adapter?: SettingsAdapter;
  health?(): Promise<PluginHealth>;
  effects?(): Promise<ReadonlyArray<{ kind: PluginEffectKind; count: number; label: LocalizedText }>>;
}>;

export type CatalogPorts = {
  states: PluginStateStore;
  settings: PluginSettingsStore;
  now(): number;
  appVersion: string;
  owners?: readonly BuiltinOwner[];
  hostPackages(): readonly HostPackage[];
  hostManifest(installIdentity: string): Promise<HostPackageManifest | null>;
  /** The Registry's own disable convergence for one package, with the authority it requires. */
  disableHostPackage(item: HostPackage): Promise<void>;
  /** The Registry's re-enable: the same package as it was, refused (as a PluginError) when its files changed or it is still turning off. */
  reenableHostPackage(item: HostPackage): Promise<void>;
  nativePlugins(): Promise<readonly { backendId: string; plugins: readonly AgentPluginInventoryEntry[] }[]>;
  agentConfigs(): readonly AgentConfigView[];
  /** Names of the Projects with an enabled workflow binding. */
  workflowProjects(): readonly string[];
  /** Q29 effects of a built-in Provider switching: the process gate that stops new turns, probes and readers. */
  applyProvider(providerId: string, enabled: boolean): void;
  /** A plugin's health, provided in main by whoever runs it; null leaves it unknown. */
  health?(pluginId: string, entry: PluginEntry): Promise<PluginHealth | null>;
  /** Settings a package reads changed: `immediate` ids are published to it, `process-start` ones restart it when idle. */
  packageSettingsChanged?(installIdentity: string, ids: readonly string[], restart: boolean, applied: () => void): Promise<void>;
};

const UNKNOWN_HEALTH: PluginHealth = { level: "unknown", summary: { key: "plugins.health.unknown" }, facts: [], checkedAt: null };
const RELATED: Record<string, PluginDetail["related"]> = { provider: ["providers", "agent-configs", "usage"], workflow: ["providers", "agent-configs"],
  package: ["skills"], "agent-native": ["skills"] };

export class PluginCatalog {
  private readonly ownerSources = new Map<() => readonly BuiltinOwner[],ReadonlySet<string>>();
  private readonly listeners = new Set<() => void>();
  private readonly manifests = new Map<string, HostPackageManifest | null>();
  private natives: PluginEntry[] = [];
  private readonly pendingRestart = new Map<string, symbol>();
  private readonly settingsQueues = new Map<string, SerialQueue>();
  private settingsClosed = false;
  constructor(private readonly ports: CatalogPorts) {}
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private owners() {
    const core=new Set(BUILTIN_PLUGINS.map(plugin=>plugin.id));
    const trusted=(owner:BuiltinOwner,allowed:ReadonlySet<string>)=>!core.has(owner.descriptor.id)&&(!isReservedPluginId(owner.descriptor.id)||(allowed.has(owner.descriptor.id)&&owner.descriptor.source==='builtin'));
    const initial=(this.ports.owners??[]).filter(owner=>trusted(owner,new Set([owner.descriptor.id])));
    const dynamic=[...this.ownerSources].flatMap(([read,allowed])=>read().filter(owner=>trusted(owner,allowed)));
    return [...new Map([...initial,...dynamic].map(owner=>[owner.descriptor.id,owner])).values()];
  }
  addOwnerSource(read: () => readonly BuiltinOwner[],authority:Readonly<{reservedIds?:readonly string[]}>={}) {
    this.ownerSources.set(read,new Set(authority.reservedIds??[]));void this.refresh();return()=>{this.ownerSources.delete(read);void this.refresh();};
  }
  private builtinDescriptors() { return BUILTIN_PLUGINS; }
  private isStateBuiltin(id: string) { return this.builtinDescriptors().some(plugin => plugin.id === id); }
  private owner(id: string) { return this.owners().find(owner => owner.descriptor.id === id) ?? null; }

  /** Startup: Providers turned off in an earlier session stay off before anything spawns. */
  applyStoredStates() {
    for (const id of this.ports.states.offIds()) if (BUILTIN_PLUGINS.some(plugin => plugin.id === id && plugin.kind === "provider")) this.ports.applyProvider(id, false);
  }

  /** Every plugin as known now: package manifests and native plugins are read again. */
  private async entries(): Promise<PluginEntry[]> {
    {
      for (const item of this.ports.hostPackages()) {
        this.manifests.set(item.installIdentity, await this.ports.hostManifest(item.installIdentity).catch(() => null));
      }
      this.natives = (await this.ports.nativePlugins().catch(() => [])).flatMap(backend =>
        backend.plugins.filter(plugin => plugin.origin === "user").map(plugin => nativeEntry(backend.backendId, plugin)));
    }
    return this.entriesSync();
  }
  private entriesSync(): PluginEntry[] {
    const states = this.ports.states;
    const builtins = this.builtinDescriptors().map(descriptor => {
      const turnedOffAt = descriptor.turnOff.allowed ? states.turnedOffAt(descriptor.id) : null;
      return builtinEntry(descriptor, { enabled: turnedOffAt === null, version: this.ports.appVersion, unsupported: null, turnedOffAt });
    });
    const owned = this.owners().map(owner => ({...builtinEntry(owner.descriptor, { enabled: owner.enabled(), version: this.ports.appVersion,
      unsupported: owner.unsupported?.() ?? null, turnedOffAt: owner.turnedOffAt?.() ?? null }),
      ...(owner.presentation??{official:owner.descriptor.source==='builtin',version:owner.descriptor.source==='builtin'?this.ports.appVersion:null})}));
    const packages = this.ports.hostPackages().filter(item=>!isReservedPluginId(item.installIdentity)).map(item => {
      const manifest = this.manifests.get(item.installIdentity) ?? null;
      return packageEntry(item.installIdentity, manifest, { active: item.administrativeState === "active", switchable: hostPackageSwitchable(item.scope) });
    });
    return [...builtins, ...owned, ...packages, ...this.natives];
  }
  /** Apps stay in the dependency graph even though their presentation belongs to the Apps page (§4.5). */
  private isListed(entry: PluginEntry) { return entry.descriptor.source !== "package" || this.manifests.get(entry.descriptor.id)?.presentation !== "app"; }
  private resolution(entries: readonly PluginEntry[]): Resolution { return resolvePlugins(entries.map(nodeOf), contractKindOf); }
  /** The shared resolution over what the catalog last read (sync: host negotiation and workflow admission use it). */
  resolve(overrides: Readonly<Record<string, boolean>> = {}): Resolution {
    return resolvePlugins(this.entriesSync().map(entry => ({ ...nodeOf(entry), ...(entry.descriptor.id in overrides ? { enabled: overrides[entry.descriptor.id] } : {}) })), contractKindOf);
  }
  /** Reads package manifests again and tells the page (Workflow's Projects, a package installed or removed). */
  async refresh() { await this.entries(); this.emit(); }
  /** The resolution over the Registry as it is now, announcing nothing (host-package negotiation asks on every start). */
  async resolveNow() { await this.entries(); return this.resolve(); }

  private extras(entry: PluginEntry): Pick<PluginView, "usedBy" | "workflowIn"> {
    if (entry.providerId) {
      const users = this.ports.agentConfigs().filter(config => !config.deleted && config.payload?.provider === entry.providerId).map(config => config.payload!.name);
      return { usedBy: users.slice(0, 64) };
    }
    if (entry.descriptor.id === "workflow") return { workflowIn: [...this.ports.workflowProjects()].slice(0, 64) };
    return {};
  }

  async list(): Promise<PluginView[]> {
    const entries = await this.entries(), resolution = this.resolution(entries);
    return entries.filter(entry => this.isListed(entry)).map(entry => pluginViewSchema.parse(viewOf(entry, resolution, this.extras(entry))));
  }

  async detail(pluginId: string): Promise<PluginDetail> {
    const entries = await this.entries(), resolution = this.resolution(entries);
    const entry = entries.find(item => item.descriptor.id === pluginId && this.isListed(item));
    if (!entry) throw new PluginError("plugin-not-found");
    const { descriptor } = entry;
    const provided = new Set(descriptor.provides.filter(contract => contractKindOf(contract) !== "host"));
    const health = await (this.owner(pluginId)?.health?.() ?? this.ports.health?.(pluginId, entry) ?? Promise.resolve(null)).catch(() => null);
    return pluginDetailSchema.parse({
      ...viewOf(entry, resolution, this.extras(entry)),
      description: descriptor.description ?? null,
      provides: descriptor.provides,
      requires: descriptor.requires.filter(contract => contractKindOf(contract) !== "host")
        .map(contract => ({ contract, satisfiedBy: (resolution.owners[contract] ?? []).filter(id => id !== pluginId) })),
      dependents: entries.filter(other => this.isListed(other) && other.descriptor.id !== pluginId && other.descriptor.requires.some(contract => provided.has(contract))).map(other => other.descriptor.id),
      health: health ?? UNKNOWN_HEALTH,
      settings: descriptor.settings.length ? await this.settings(pluginId) : null,
      capabilities: descriptor.capabilities,
      related: descriptor.kind === "provider" ? RELATED.provider : RELATED[descriptor.id] ?? RELATED[descriptor.source] ?? [],
    });
  }

  /** Turning on needs no confirmation; turning off is confirmed by the page after the impact preview (Q29). */
  async setEnabled(pluginId: string, enabled: boolean) {
    const entry = await this.fieldsOf(pluginId);
    const { descriptor } = entry;
    if (!descriptor.turnOff.allowed) throw new PluginError(descriptor.turnOff.reason === "always-on" ? "plugin-always-on" : "plugin-not-switchable");
    if (enabled && entry.unsupported) throw new PluginError("plugin-unsupported");
    if (enabled && !entry.enabled && descriptor.turnOn.mode === "setup") throw new PluginError("plugin-setup-required");
    const owner = this.owner(pluginId);
    if (owner) {
      if (!owner.setEnabled) throw new PluginError("plugin-not-switchable");
      await owner.setEnabled(enabled);
      return this.emit();
    }
    if (this.isStateBuiltin(pluginId)) {
      await this.ports.states.set(pluginId, enabled, this.ports.now());
      if (descriptor.kind === "provider") this.ports.applyProvider(pluginId, enabled);
      return this.emit();
    }
    const item = this.ports.hostPackages().find(candidate => candidate.installIdentity === pluginId);
    if (!item) throw new PluginError("plugin-not-found");
    if (!hostPackageSwitchable(item.scope)) throw new PluginError("plugin-not-switchable");
    if (enabled === (item.administrativeState === "active")) return;
    await (enabled ? this.ports.reenableHostPackage(item) : this.ports.disableHostPackage(item));
    this.emit();
  }

  private async fieldsOf(pluginId: string) {
    const entry = (await this.entries()).find(item => item.descriptor.id === pluginId && this.isListed(item));
    if (!entry) throw new PluginError("plugin-not-found");
    return entry;
  }

  async settings(pluginId: string): Promise<PluginSettingsView> {
    const { descriptor } = await this.fieldsOf(pluginId);
    const view = await this.ports.settings.view(pluginId, descriptor.settings, this.pendingRestart.has(pluginId));
    const adapter = this.owner(pluginId)?.adapter;
    if (!adapter) return view;
    const owned = await adapter.read();
    const adapted = descriptor.settings.filter(field => field.owner === "adapter");
    for (const field of adapted) if (owned[field.id] !== undefined) view.values[field.id] = owned[field.id];
    return { ...view, changed: [...view.changed, ...adapted.filter(field => "default" in field && owned[field.id] !== undefined && owned[field.id] !== field.default).map(field => field.id)] };
  }

  setSettings(pluginId: string, patch: SettingsPatch, confirmation?: string): Promise<SettingsSubmitResult> {
    if (this.settingsClosed) return Promise.reject(new Error("Plugin settings are closed"));
    let queue = this.settingsQueues.get(pluginId);
    if (!queue) this.settingsQueues.set(pluginId, queue = new SerialQueue());
    return queue.enqueue(() => this.submitSettings(pluginId, patch, confirmation));
  }

  stopAdmission() {
    this.settingsClosed = true;
    for (const queue of this.settingsQueues.values()) queue.close();
  }

  async close() {
    this.stopAdmission();
    await Promise.all([...this.settingsQueues.values()].map(queue => queue.flush()));
  }

  private async submitSettings(pluginId: string, patch: SettingsPatch, confirmation?: string): Promise<SettingsSubmitResult> {
    const entry = await this.fieldsOf(pluginId);
    const fields = entry.descriptor.settings, byId = new Map(fields.map(field => [field.id, field]));
    if (Object.keys(patch).some(id => !byId.has(id))) return { status: "refused", code: "setting-unknown" };
    const adapted = Object.entries(patch).filter(([id]) => byId.get(id)!.owner === "adapter");
    const stored = Object.fromEntries(Object.entries(patch).filter(([id]) => byId.get(id)!.owner === "store"));
    if (adapted.length) {
      const adapter = this.owner(pluginId)?.adapter;
      if (!adapter || adapted.some(([, value]) => value === null)) return { status: "refused", code: "setting-invalid" };
      const result = await adapter.submit(Object.fromEntries(adapted) as Record<string, SettingValue>, confirmation);
      if (result.status !== "applied") return result;
    }
    let changed: string[] = [];
    if (Object.keys(stored).length) {
      try { changed = await this.ports.settings.submit(pluginId, fields, stored); }
      catch (cause) { if (cause instanceof SettingsRefusal) return { status: "refused", code: cause.code }; throw cause; }
    }
    const restart = changed.some(id => byId.get(id)!.appliesAt === "process-start");
    if (entry.descriptor.source === "package" && changed.length) {
      const revision = Symbol(pluginId);
      if (restart) this.pendingRestart.set(pluginId, revision);
      await this.ports.packageSettingsChanged?.(pluginId, changed, restart, () => this.restarted(pluginId, revision))
        .catch(cause => console.warn("[plugins] settings delivery failed", cause));
      const immediate = changed.filter(id => byId.get(id)!.appliesAt === "immediate");
      if (restart && immediate.length) await this.ports.packageSettingsChanged?.(pluginId, immediate, false, () => {})
        .catch(cause => console.warn("[plugins] settings delivery failed", cause));
    }
    this.emit();
    return { status: "applied", view: await this.settings(pluginId) };
  }
  /** The package restarted with its current settings. */
  restarted(pluginId: string, revision = this.pendingRestart.get(pluginId)) {
    if (this.pendingRestart.get(pluginId) === revision && this.pendingRestart.delete(pluginId)) this.emit();
  }
  /** What a Provider adapter may send: only values a person changed (C.5: a default sends no override). */
  providerOverrides(providerId: string): Promise<Record<string, SettingValue>> {
    const descriptor = BUILTIN_PLUGINS.find(plugin => plugin.id === providerId);
    return descriptor ? this.ports.settings.overrides(providerId, descriptor.settings) : Promise.resolve({});
  }

  /** Whether a Provider may run: a built-in one by its state, one supplied by a package by that package being on. */
  providerEnabled(providerId: string) {
    if (BUILTIN_PLUGINS.some(plugin => plugin.id === providerId && plugin.kind === "provider")) return this.ports.states.turnedOffAt(providerId) === null;
    return true;
  }
  /** The Providers a plugin supplies, or null for an id that is not installed (for the impact preview). */
  async providersOf(pluginId: string): Promise<string[] | null> {
    const entry = (await this.entries()).find(item => item.descriptor.id === pluginId && this.isListed(item));
    if (!entry) return null;
    return entry.providerId && (entry.descriptor.source !== "package" || entry.enabled) ? [entry.providerId] : [];
  }
  /** Plugins that would become unusable if this one were off (C.4's dependents): resolve again with it off. */
  async dependentsOf(pluginId: string): Promise<Array<{ pluginId: string; name: LocalizedText }>> {
    const entries = await this.entries();
    const before = this.resolution(entries);
    const after = resolvePlugins(entries.map(entry => entry.descriptor.id === pluginId ? { ...nodeOf(entry), enabled: false } : nodeOf(entry)), contractKindOf);
    return entries.filter(entry => this.isListed(entry) && entry.descriptor.id !== pluginId && before.plugins[entry.descriptor.id]?.usable && !after.plugins[entry.descriptor.id]?.usable)
      .map(entry => ({ pluginId: entry.descriptor.id, name: entry.descriptor.name }));
  }
  /** Read-only owner effects; dynamic feature owners retain their lifecycle authority. */
  effectsOf(pluginId: string) { return this.owner(pluginId)?.effects?.() ?? Promise.resolve([]); }
  /** Whether the Workflow switch is on (running runs pause when it goes off). */
  workflowEnabled() { return this.ports.states.turnedOffAt("workflow") === null; }
  /** Workflow admission's named reason (T-D10): what Workflow waits for, or null when it can start runs. */
  workflowBlockedBy() {
    const state = this.resolve().plugins.workflow;
    return state && !state.usable ? state.blockedBy : null;
  }
  private emit() { for (const listener of this.listeners) listener(); }
}
