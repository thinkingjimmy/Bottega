/**
 * [INPUT]: Canonical plugin contracts, real filesystem identity, strict durable storage and whole-package activation.
 * [OUTPUT]: Scoped paginated plugin catalogs, plugin lifecycle, reserved official Widget activation and immutable version selection.
 * [POS]: Main platform facade used by startup, authoring/build owners, renderer IPC and isolated contribution hosts.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import {
  UNIFIED_PLUGIN_MANIFEST, unifiedPluginCatalogItemSchema, unifiedPluginCatalogSummarySchema, unifiedPluginInstallInputSchema, unifiedPluginListQuerySchema,
  unifiedPluginManifestSchema, unifiedPluginRestoreInputSchema, type PluginContribution, type UnifiedPluginCatalogItem,
  type UnifiedPluginCatalogPage, type UnifiedPluginCatalogSummary, type UnifiedPluginInstallInput, type UnifiedPluginListQuery, type UnifiedPluginMode,
  type UnifiedPluginRevision, type UnifiedPluginRestoreInput, type UnifiedPluginManifest,
} from "@bottega/contracts/plugins/platform";
import { UnifiedPluginActivation } from "./activation";
import { PluginContributionRegistry } from "./registry";
import { UnifiedPluginStore, type UnifiedPluginStoredRecord } from "./store";
import type { RegisterUnifiedPluginInput, UnifiedPluginPlatformOptions, PluginOperationOptions, PluginActivationOptions, PluginSourceBuild, PluginActivationIdentity, OfficialWidgetOperation } from "./model";
import { PluginSourceSupersededError } from "./model";
import { assertUnreservedWidget, canActivateWidget } from "./official-widgets/identity";
import { isDistributedWidgetId, isOfficialWidgetId, type OfficialWidgetId } from "../../../../shared/system-dock/widgets/catalog/distribution";
export type { PreparedPluginRuntime, UnifiedPluginPlatformOptions, RegisterUnifiedPluginInput, PluginOperationOptions } from "./model";

export type UnifiedPluginHostAdapter = Readonly<{
  state(): { enabled: boolean; ready: boolean; status?: UnifiedPluginCatalogItem["status"]; error?: string };
  setEnabled(enabled: boolean, hostImpact?: { revision: number; digest: string }): Promise<void>;
  remove?(hostImpact?: { revision: number; digest: string }): Promise<void>;
}>;
const errorMessage = (cause: unknown) => String(cause instanceof Error ? cause.message : cause).slice(0, 2048);
function settingsCatalogIncludes(manifest: UnifiedPluginManifest) {
  const app = ["base-app", "web-app", "server-app"].includes(manifest.source.format);
  const widget = manifest.contributions.some(value => value.kind === "widget");
  return (!app && !widget) || manifest.contributions.some(value =>
    value.kind === "tool" || value.kind === "mode" || value.kind === "composer" ||
    (value.kind === "page" && !app && !value.hostAppId));
}

export class UnifiedPluginPlatform {
  readonly registry = new PluginContributionRegistry();
  readonly store: UnifiedPluginStore;
  private readonly activation: UnifiedPluginActivation;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly disableParticipants = new Set<(pluginId: string) => Promise<void>>();
  private readonly hostAdapters = new Map<string, UnifiedPluginHostAdapter>();
  private readonly listeners = new Set<(event: { revision: number }) => void>();
  private readonly now: () => number;
  private healthyTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private closing?: Promise<void>;

  constructor(readonly options: UnifiedPluginPlatformOptions) {
    this.now = options.now ?? Date.now;
    this.store = new UnifiedPluginStore(options.userData, this.now);
    this.activation = new UnifiedPluginActivation(this.store, this.registry, options, () => this.changed(), this.now, id => { const state = this.hostAdapters.get(id)?.state(); return Boolean(state?.enabled && state.ready); });
  }
  async initialize(): Promise<void> {
    await this.store.initialize();
    const pending = this.store.read(state => state.plugins.filter(record => record.installation.enabled && record.activeRevision));
    while (pending.length) {
      let progress = false;
      for (const record of [...pending]) {
        if (record.manifest.dependencies.some(dependency => pending.some(value => value.manifest.id === dependency.pluginId))) continue;
        pending.splice(pending.indexOf(record), 1); progress = true;
        const revision = record.revisions.find(value => value.revisionId === record.activeRevision);
        if (!revision) continue;
        if (!canActivateWidget(revision, this.options.developmentWidgetDistribution, record.installation.origin)) {
          await this.fail(record.manifest.id, new Error("This Widget needs an official package"), "unavailable");
          continue;
        }
        try { await this.activation.activate(revision, { startup: true }); }
        catch (cause) { this.options.reportError?.(cause); }
      }
      if (!progress) {
        for (const record of pending) await this.fail(record.manifest.id, new Error("Plugin dependency cycle prevents startup"), "unavailable");
        break;
      }
    }
    this.healthyTimer = setTimeout(() => {
      void this.store.markHealthy().catch(error => this.options.reportError?.(error));
    }, this.options.startupWindowMs ?? 30_000);
    this.healthyTimer.unref();
  }
  onBeforeDisable(participant: (pluginId: string) => Promise<void>): () => void {
    this.disableParticipants.add(participant); return () => this.disableParticipants.delete(participant);
  }
  onChanged(listener: (event: { revision: number }) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  list(query: UnifiedPluginListQuery = {}): UnifiedPluginCatalogPage {
    const { cursor, limit, search, scope } = unifiedPluginListQuerySchema.parse(query);
    return this.store.read(state => {
      const [cursorRevision, offsetValue] = cursor?.split(":").map(Number) ?? [state.revision, 0];
      if (cursorRevision !== state.revision) throw new Error("Stale plugin catalog cursor; restart pagination");
      const offset = offsetValue ?? 0;
      const normalized = search?.trim().toLocaleLowerCase();
      const records = state.plugins.filter(({ manifest }) => {
        if (scope === "settings" && !settingsCatalogIncludes(manifest)) return false;
        return !normalized || [manifest.name, manifest.id, manifest.description ?? ""]
          .some(value => value.toLocaleLowerCase().includes(normalized));
      })
        .sort((a, b) => a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0);
      const items: UnifiedPluginCatalogSummary[] = [];
      const pageFor = (count: number): UnifiedPluginCatalogPage => ({ items: [], total: records.length, revision: state.revision,
        ...(offset + count < records.length ? { nextCursor: state.revision + ":" + (offset + count) } : {}),
        ...(state.safeMode ? { safeMode: state.safeMode } : {}) });
      let bytes = 0;
      for (const record of records.slice(offset, offset + limit)) {
        const item = this.summaryView(record), nextBytes = bytes + Buffer.byteLength(JSON.stringify(item)) + (items.length ? 1 : 0);
        if (nextBytes + Buffer.byteLength(JSON.stringify(pageFor(items.length + 1))) > 256 * 1024) {
          if (!items.length) throw new Error("Plugin catalog summary exceeds the transport page budget");
          break;
        }
        items.push(item); bytes = nextBytes;
      }
      return { ...pageFor(items.length), items };
    });
  }
  get(pluginId: string): UnifiedPluginCatalogItem | null {
    return this.store.read(state => {
      const record = state.plugins.find(value => value.manifest.id === pluginId);
      return record ? this.view(record) : null;
    });
  }
  summary(pluginId: string): UnifiedPluginCatalogSummary | null {
    return this.store.read(state => {
      const record = state.plugins.find(value => value.manifest.id === pluginId);
      return record ? this.summaryView(record) : null;
    });
  }
  refreshReadiness() { this.assertOpen(); this.changed(); }
  listContributions(kind?: PluginContribution["kind"]) { return this.registry.list(kind); }
  modes(): UnifiedPluginMode[] {
    return this.store.read(state => state.plugins.flatMap(record => record.manifest.contributions
      .filter(value => value.kind === "mode").map(mode => ({
        id: mode.id, pluginId: record.manifest.id, pluginName: record.manifest.name, name: mode.name, description: mode.description, prompt: mode.prompt, tools: mode.tools,
        ...(mode.nativeRequirements ? { nativeRequirements: mode.nativeRequirements } : {}),
        ready: this.isActive(record.manifest.id),
        ...(!record.installation.enabled ? { unavailableReason: "Plugin is disabled" }
          : !this.isActive(record.manifest.id) ? { unavailableReason: record.error ?? "Plugin is not ready" } : {}),
      }))));
  }
  async install(input: UnifiedPluginInstallInput): Promise<UnifiedPluginCatalogItem> {
    const value = unifiedPluginInstallInputSchema.parse(input), directory = await realpath(value.directory);
    const path = join(directory, UNIFIED_PLUGIN_MANIFEST), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Plugin declaration is not a bounded regular file");
    const inspected = await this.inspect({ directory: value.directory });
    const manifest = inspected.manifest;
    if (value.expectedManifestDigest && value.expectedManifestDigest !== inspected.manifestDigest) throw new Error("Plugin declaration changed after inspection; inspect it again before installation");
    if (inspected.requiresTrust && !value.trust)
      throw new Error("Trust confirmation is required for " + manifest.name + " (" + (manifest.source.url ?? directory) + "): plugin code can read all Bottega credentials and browser cookies");
    const distribution = await lstat(join(directory, "plugin-package.json")).catch(cause => { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; });
    if (distribution) {
      if (!distribution.isFile() || distribution.isSymbolicLink()) throw new Error("Plugin package metadata is invalid");
      const { receiveUnifiedPluginDistribution } = await import("../distribution/receiver");
      return receiveUnifiedPluginDistribution(this, this.options.userData, value);
    }
    return this.register({ manifest, packageDirectory: directory,
      ...(manifest.source.editable ? { sourceDirectory: directory } : {}), ...(value.trust ? { trust: true as const } : {}) });
  }
  async inspect(input: { directory: string }) {
    const directory = await this.directory(input.directory), path = join(directory, UNIFIED_PLUGIN_MANIFEST), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Plugin declaration is not a bounded regular file");
    const declared = unifiedPluginManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
    assertUnreservedWidget(declared.id);
    if (declared.source.format === "bottega") await this.directory(input.directory, true);
    const existing = this.get(declared.id);
    const owned = Boolean(existing && existing.directory.packageDirectory === directory);
    const manifest = unifiedPluginManifestSchema.parse({ ...declared,
      essential: Boolean(owned && existing?.installation.origin === "official" && existing.manifest.essential),
      source: owned && existing?.installation.origin !== "external" ? declared.source
        : existing?.installation.origin === "external" ? existing.manifest.source : { ...declared.source, kind: "external", editable: false } });
    return { manifest, manifestDigest: "sha256:" + hashCanonical(declared),
      requiresTrust: !owned || Boolean(existing?.installation.origin === "external" && existing.installation.trustAcceptedAt === undefined) };
  }
  async register(input: RegisterUnifiedPluginInput): Promise<UnifiedPluginCatalogItem> {
    this.assertOpen();
    const declared = unifiedPluginManifestSchema.parse(input.manifest);
    assertUnreservedWidget(declared.id);
    const registered = this.get(declared.id);
    const manifest = unifiedPluginManifestSchema.parse({ ...declared,
      essential: Boolean(declared.essential && input.trustedEssential && declared.source.kind === "official" && registered?.installation.origin !== "external"),
      ...(registered?.installation.origin === "external" ? { source: { ...declared.source, kind: "external", editable: false } } : {}) });
    if ((manifest.source.format === "host-package" || manifest.contributions.some(value => "hostAppId" in value && value.hostAppId || "hostViewId" in value && value.hostViewId || "hostPackageId" in value && value.hostPackageId)) && !input.hostAdapter)
      throw new Error("Hosted contributions require a main-owned adapter registration");
    const native = manifest.source.format === "bottega";
    const packageDirectory = await this.directory(input.packageDirectory, native);
    const sourceDirectory = input.sourceDirectory ? await this.directory(input.sourceDirectory, native) : undefined;
    if (manifest.source.kind === "external" && !input.trust && !this.get(manifest.id)?.installation.trustAcceptedAt)
      throw new Error("Trust confirmation is required: external plugin code can read all Bottega credentials and browser cookies");
    return this.serialize(manifest.id, async () => {
      await this.store.mutate(state => {
        input.assertCurrent?.();
        const existing = state.plugins.find(record => record.manifest.id === manifest.id);
        if (state.plugins.some(record => record.manifest.id !== manifest.id &&
          ((sourceDirectory && record.directory.sourceDirectory === sourceDirectory) || record.directory.packageDirectory === packageDirectory)))
          throw new Error("This source directory is already registered to another plugin");
        if (existing && !input.replace) {
          if (existing.directory.packageDirectory !== packageDirectory ||
            existing.directory.sourceDirectory !== sourceDirectory) throw new Error("Plugin identity is already bound to a different directory");
          return;
        }
        if (existing) {
          // Editing a declaration does not change the running manifest until an immutable candidate commits.
          existing.directory = { ...existing.directory, packageDirectory, ...(sourceDirectory ? { sourceDirectory } : {}), missing: false };
          if (!existing.activeRevision) { existing.manifest = manifest; if (input.enabled !== undefined) existing.installation.enabled = input.enabled; }
          if (sourceDirectory) existing.sourceProject = {
            pluginId: manifest.id, sourceDirectory, projectId: input.projectId ?? existing.sourceProject?.projectId,
            chatIds: [...new Set([...(existing.sourceProject?.chatIds ?? []), ...(input.chatIds ?? [])])],
            createdAt: existing.sourceProject?.createdAt ?? this.now(),
          };
          return;
        }
        const enabled = input.enabled ?? true, now = this.now();
        state.plugins.push({
          manifest, installation: { pluginId: manifest.id, installedAt: now, enabled, origin: manifest.source.kind,
            ...(input.trust ? { trustAcceptedAt: now } : {}) },
          directory: { pluginId: manifest.id, packageDirectory, ...(sourceDirectory ? { sourceDirectory } : {}), registeredAt: now, missing: false },
          ...(sourceDirectory ? { sourceProject: { pluginId: manifest.id, sourceDirectory, ...(input.projectId ? { projectId: input.projectId } : {}),
            chatIds: [...new Set(input.chatIds ?? [])], createdAt: now } } : {}),
          status: enabled ? "installed" : "disabled", instanceCount: 0, warnings: [], revisions: [], activation: null, sourceVersion: 0,
        });
      });
      this.changed(); return this.require(manifest.id);
    });
  }
  async bindSource(input: { pluginId: string; sourceDirectory: string; projectId?: string; chatId?: string }): Promise<void> {
    const directory = await this.directory(input.sourceDirectory, this.get(input.pluginId)?.manifest.source.format === "bottega");
    await this.store.mutate(state => {
      const record = this.record(state.plugins, input.pluginId);
      if (state.plugins.some(value => value.manifest.id !== input.pluginId && value.directory.sourceDirectory === directory))
        throw new Error("This source directory is already registered to another plugin");
      if (record.sourceProject?.projectId && input.projectId && record.sourceProject.projectId !== input.projectId)
        throw new Error("A plugin source can have only one Project");
      const previous = record.sourceProject;
      record.directory.sourceDirectory = directory;
      record.sourceProject = { pluginId: input.pluginId, sourceDirectory: directory, projectId: input.projectId ?? previous?.projectId,
        chatIds: [...new Set([...(previous?.chatIds ?? []), ...(input.chatId ? [input.chatId] : [])])], createdAt: previous?.createdAt ?? this.now() };
    });
    this.changed();
  }
  async sourceChanged(pluginId: string, sourceVersion?: number, assertCurrent?: () => void): Promise<number> {
    this.assertOpen(); assertCurrent?.(); this.activation.cancelCandidate(pluginId, new PluginSourceSupersededError());
    const version = await this.store.mutate(state => {
      assertCurrent?.();
      const record = this.record(state.plugins, pluginId);
      const next = sourceVersion ?? record.sourceVersion + 1;
      if (!Number.isSafeInteger(next) || next <= record.sourceVersion) throw new Error("Source version must advance");
      record.sourceVersion = next; if (!["draining", "cleanup-failed"].includes(record.status)) { record.status = record.installation.enabled ? "building" : "disabled"; delete record.error; } return next;
    });
    this.changed(); return version;
  }
  async buildWarnings(pluginId: string, warnings: string[]): Promise<void> {
    await this.store.mutate(state => { this.record(state.plugins, pluginId).warnings = [...new Set(warnings)].slice(0, 32).map(value => value.slice(0, 2048)); });
    this.changed();
  }
  async buildFailed(pluginId: string, cause: unknown): Promise<void> { await this.fail(pluginId, cause); }
  async runtimeFailed(pluginId: string, revisionId: string, activationId: string, reason: unknown): Promise<void> {
    const owner = { revisionId, activationId }, current = () => this.activation.ownsActivation(pluginId, owner);
    if (!current()) return;
    this.activation.cancelCandidate(pluginId); this.registry.unregister(pluginId);
    await this.serialize(pluginId, async () => {
      if (!current()) return;
      try {
        for (const participant of this.disableParticipants) { await participant(pluginId); if (!current()) return; }
        if (!current()) return;
        await this.activation.stop(pluginId, owner);
      } catch (cause) { await this.fail(pluginId, new AggregateError([reason, cause], errorMessage(reason) + "; process cleanup remains incomplete"), "cleanup-failed", owner); return; }
      await this.fail(pluginId, reason, "failed", owner);
    });
  }
  activateCandidate(revision: UnifiedPluginRevision, options: PluginActivationOptions = {}): Promise<UnifiedPluginCatalogItem> {
    this.assertOpen();
    return this.serialize(revision.pluginId, async () => { await this.activation.activate(revision, options); return this.require(revision.pluginId); });
  }
  async sourceUnchanged(pluginId: string, options: PluginOperationOptions = {}): Promise<void> {
    this.assertOpen(); options.signal?.throwIfAborted(); options.assertCurrent?.();
    const before = this.store.read(state => this.record(state.plugins, pluginId));
    const assertCurrent = () => {
      options.signal?.throwIfAborted(); options.assertCurrent?.();
      const current = this.store.read(state => this.record(state.plugins, pluginId));
      if (current.sourceVersion !== before.sourceVersion || current.activeRevision !== before.activeRevision ||
        (current.directory.sourceDirectory ?? current.directory.packageDirectory) !== (before.directory.sourceDirectory ?? before.directory.packageDirectory))
        throw new Error("Plugin source binding or selected runtime changed during recovery");
    };
    await this.serialize(pluginId, async () => {
      assertCurrent(); const current = this.require(pluginId), active = this.activation.isActive(pluginId);
      if (!current.installation.enabled || ["preparing", "draining", "cleanup-failed"].includes(current.status)) return;
      if (!active) {
        const revision = this.activeRevision(pluginId);
        if (revision) { await this.activation.activate(revision, { ...options, startup: true, assertCurrent }); return; }
      }
      if (active ? current.status === "ready" && !current.error : current.status !== "building") return;
      await this.store.mutate(state => {
        assertCurrent(); const record = this.record(state.plugins, pluginId);
        if (!record.installation.enabled || ["preparing", "draining", "cleanup-failed"].includes(record.status)) return;
        if (this.activation.isActive(pluginId)) { record.status = "ready"; delete record.error; }
        else if (record.status === "building") record.status = "installed";
      });
      this.changed();
    });
  }
  sourceBuild(pluginId: string): PluginSourceBuild | null { return this.store.read(state => this.record(state.plugins, pluginId).sourceBuild ?? null); }
  revisions(pluginId: string): UnifiedPluginRevision[] {
    return this.store.read(state => [...this.record(state.plugins, pluginId).revisions].sort((a, b) => b.createdAt - a.createdAt));
  }
  activeRevision(pluginId: string): UnifiedPluginRevision | null {
    return this.store.read(state => {
      const record = state.plugins.find(value => value.manifest.id === pluginId);
      return record?.revisions.find(value => value.revisionId === record.activeRevision) ?? null;
    });
  }
  activationId(pluginId: string, revisionId?: string): string | undefined {
    return this.isActive(pluginId, revisionId) ? this.activation.activationId(pluginId, revisionId) : undefined;
  }
  isActive(pluginId: string, revisionId?: string): boolean {
    const ready = (id: string, ancestors: Set<string>, revision?: string): boolean => {
      if (ancestors.has(id)) return false;
      const record = this.store.read(state => state.plugins.find(value => value.manifest.id === id));
      if (!record?.installation.enabled || !this.registry.has(id) || this.options.featureReady?.(id) === false) return false;
      const adapter = this.hostAdapters.get(id)?.state();
      if (!(adapter ? adapter.enabled && adapter.ready : this.activation.isActive(id, revision))) return false;
      const next = new Set(ancestors); next.add(id);
      return record.manifest.dependencies.every(dependency => {
        const target = this.store.read(state => state.plugins.find(value => value.manifest.id === dependency.pluginId));
        return Boolean(target && (!dependency.version || dependency.version === target.manifest.version) &&
          !dependency.contributions?.some(contributionId => !target.manifest.contributions.some(value => value.id === contributionId)) && ready(dependency.pluginId, next));
      });
    };
    return ready(pluginId, new Set(), revisionId);
  }
  registerHostAdapter(pluginId: string, adapter: UnifiedPluginHostAdapter): () => void {
    if (this.hostAdapters.has(pluginId)) throw new Error("Host plugin adapter is already registered");
    this.hostAdapters.set(pluginId, adapter);
    return () => { if (this.hostAdapters.get(pluginId) === adapter) { this.hostAdapters.delete(pluginId); this.registry.unregister(pluginId); } };
  }
  async refreshHostAdapter(pluginId: string): Promise<void> {
    const adapter = this.hostAdapters.get(pluginId); if (!adapter) throw new Error("Host plugin adapter is not registered");
    const state = adapter.state();
    await this.store.mutate(file => {
      const record = this.record(file.plugins, pluginId); record.installation.enabled = state.enabled;
      record.status = state.status ?? (!state.enabled ? "disabled" : state.ready ? "ready" : state.error ? "failed" : "unavailable");
      if (state.error) record.error = state.error; else delete record.error;
    });
    if (state.enabled && state.ready) this.registry.register(this.require(pluginId).manifest, { replace: true });
    else this.registry.unregister(pluginId);
    this.changed();
  }
  async setEnabled(input: { pluginId: string; enabled: boolean; hostImpact?: { revision: number; digest: string } }): Promise<UnifiedPluginCatalogItem> {
    this.assertOpen();
    const adapter = this.hostAdapters.get(input.pluginId);
    if (adapter) {
      try { await adapter.setEnabled(input.enabled, input.hostImpact); }
      catch (cause) { await this.refreshHostAdapter(input.pluginId); throw cause; }
      await this.refreshHostAdapter(input.pluginId); return this.require(input.pluginId);
    }
    const enabledBefore = this.require(input.pluginId).installation.enabled;
    if (!input.enabled) {
      this.activation.cancelCandidate(input.pluginId);
      if (this.require(input.pluginId).manifest.essential) throw new Error("This plugin is required by Bottega and cannot be disabled");
      await this.store.mutate(state => {
        const record = this.record(state.plugins, input.pluginId); record.installation.enabled = false; record.status = "draining";
      });
      this.changed();
    }
    return this.serialize(input.pluginId, async () => {
      const before = this.require(input.pluginId);
      if (!input.enabled) {
        try { if (enabledBefore) await this.options.applyEnablement?.(input); for (const participant of this.disableParticipants) await participant(input.pluginId); await this.activation.stop(input.pluginId, { all: true }); }
        catch (cause) { await this.fail(input.pluginId, cause, "cleanup-failed"); throw cause; }
        await this.store.mutate(state => { this.record(state.plugins, input.pluginId).status = "disabled"; });
      } else {
        await this.store.mutate(state => {
          const record = this.record(state.plugins, input.pluginId); record.installation.enabled = true; record.status = "installed";
        });
        if (before.activeRevision) {
          const revision = this.revisions(input.pluginId).find(value => value.revisionId === before.activeRevision);
          if (revision && canActivateWidget(revision, this.options.developmentWidgetDistribution, before.installation.origin))
            await this.activation.activate(revision, { startup: true });
        }
        if (!enabledBefore) await this.options.applyEnablement?.(input);
      }
      this.changed(); return this.require(input.pluginId);
    });
  }
  async restore(input: UnifiedPluginRestoreInput, options: PluginOperationOptions = {}): Promise<UnifiedPluginCatalogItem> {
    this.assertOpen();
    const assertCurrent = () => { options.signal?.throwIfAborted(); options.assertCurrent?.(); };
    assertCurrent();
    const value = unifiedPluginRestoreInputSchema.parse(input);
    return this.serialize(value.pluginId, async () => {
      assertCurrent();
      const revision = this.revisions(value.pluginId).find(item => item.revisionId === value.revisionId);
      if (!revision) throw new Error("Plugin revision is not available");
      if (!canActivateWidget(revision, this.options.developmentWidgetDistribution, this.require(value.pluginId).installation.origin))
        throw new Error("This Widget revision is retired");
      if (value.sourceOnly) {
        if (!this.options.restoreSource) throw new Error("Source restoration is unavailable");
        await this.options.restoreSource(revision, { ...options, assertCurrent }); assertCurrent();
        await this.sourceChanged(value.pluginId, undefined, assertCurrent);
      } else await this.activation.activate(revision, { ...options, restore: true });
      this.changed(); return this.require(value.pluginId);
    });
  }
  async remove(input: { pluginId: string; deleteData?: boolean; hostImpact?: { revision: number; digest: string } }): Promise<void> {
    if (isOfficialWidgetId(input.pluginId) && !(this.options.developmentWidgetDistribution && isDistributedWidgetId(input.pluginId)))
      throw new Error("Bundled Widgets can be disabled in the Widget catalog");
    await this.setEnabled({ pluginId: input.pluginId, enabled: false, hostImpact: input.hostImpact });
    await this.serialize(input.pluginId, async () => {
      const dependents = this.store.read(state => state.plugins.filter(record => record.manifest.dependencies.some(value => value.pluginId === input.pluginId)));
      if (dependents.length) throw new Error("Other plugins depend on this plugin: " + dependents.map(value => value.manifest.name).join(", "));
      await this.hostAdapters.get(input.pluginId)?.remove?.(input.hostImpact);
      if (input.deleteData) {
        if (!this.options.deleteData) throw new Error("Plugin data removal is unavailable");
        await this.options.deleteData(input.pluginId);
      }
      await this.store.mutate(state => {
        state.plugins = state.plugins.filter(value => value.manifest.id !== input.pluginId);
        if (this.options.developmentWidgetDistribution && isDistributedWidgetId(input.pluginId) &&
          !state.removedOfficialWidgets.includes(input.pluginId)) state.removedOfficialWidgets.push(input.pluginId);
      });
      this.hostAdapters.delete(input.pluginId); this.registry.unregister(input.pluginId);
      this.changed();
    });
  }
  async noteAvailablePackage(input: { manifest: UnifiedPluginManifest; revisionId: string; packageDirectory: string }, assertCurrent?: () => void) {
    if (isOfficialWidgetId(input.manifest.id)) return;
    const existing = this.get(input.manifest.id);
    if (!existing) {
      const manifest = unifiedPluginManifestSchema.parse({ ...input.manifest, source: { ...input.manifest.source, kind: "external", editable: false } });
      await this.store.mutate(state => { assertCurrent?.(); const now = this.now(); state.plugins.push({ manifest,
        installation: { pluginId: manifest.id, installedAt: now, enabled: false, origin: "external" },
        directory: { pluginId: manifest.id, packageDirectory: input.packageDirectory, registeredAt: now, missing: true },
        status: "unavailable", instanceCount: 0, warnings: [], revisions: [], activation: null, sourceVersion: 0, availableRevision: input.revisionId }); });
    } else if (existing.availableRevision !== input.revisionId) {
      await this.store.mutate(state => { assertCurrent?.(); const record = this.record(state.plugins, input.manifest.id); record.availableRevision = input.revisionId; record.installation.availableRevision = input.revisionId; });
    } else return;
    this.changed();
  }
  wasOfficialWidgetRemoved(pluginId: OfficialWidgetId) {
    return isDistributedWidgetId(pluginId) && this.store.read(state => state.removedOfficialWidgets.includes(pluginId));
  }
  installOfficialWidget(revision: UnifiedPluginRevision, options: OfficialWidgetOperation) {
    this.assertOpen();
    const { pluginId } = revision;
    if (!isOfficialWidgetId(pluginId) || !canActivateWidget(revision, this.options.developmentWidgetDistribution, "official"))
      throw new Error("Official Widget receipt is unavailable");
    return this.serialize(pluginId, async () => {
      const assertCurrent = () => { this.assertOpen(); options.signal?.throwIfAborted(); options.assertCurrent?.(); };
      assertCurrent();
      const existing = this.get(pluginId);
      if (existing && existing.installation.origin !== "official") throw new Error("Official Widget identity conflict");
      const current = this.activeRevision(pluginId)?.officialWidget;
      if (options.migration && (this.wasOfficialWidgetRemoved(pluginId) || current && "archiveSha256" in current)) return existing;
      const prior = options.priorInstallation;
      if (prior && (prior.installedAt !== (existing?.installation.installedAt ?? null) ||
          prior.removed !== this.wasOfficialWidgetRemoved(pluginId))) throw new Error("Widget installation changed during review");
      if (existing?.acceptedRevision === revision.revisionId && (!existing.installation.enabled || this.isActive(pluginId, revision.revisionId))) return existing;
      const sourceVersion = await this.store.mutate(state => {
        assertCurrent();
        const record = state.plugins.find(value => value.manifest.id === pluginId);
        if (record) return ++record.sourceVersion;
        const now = this.now();
        state.plugins.push({
          manifest: revision.manifest, installation: { pluginId, installedAt: now, origin: "official", enabled: !("bundleDigest" in revision.officialWidget! && state.removedOfficialWidgets.some(id => id === pluginId)) },
          directory: { pluginId, packageDirectory: revision.rootDirectory, registeredAt: now, missing: false },
          status: "installed", warnings: [], instanceCount: 0, revisions: [], activation: null, sourceVersion: 1,
        });
        return 1;
      });
      const candidate = { ...revision, sourceVersion };
      const previouslyRetained = Boolean(existing && this.revisions(pluginId).some(value => value.revisionId === revision.revisionId));
      try {
        if (this.require(pluginId).installation.enabled) {
          await this.activation.activate(candidate, { ...options, assertCurrent });
        } else {
          const signal = options.signal ?? new AbortController().signal;
          const ready = await this.options.prepareUi?.({ revision: candidate, manifest: candidate.manifest, activationId: "", signal });
          if (ready?.length !== 1 || !ready[0]?.ready) throw new Error("Official Widget interface is unavailable");
          await this.store.mutate(state => {
            assertCurrent();
            const record = this.record(state.plugins, pluginId);
            if (record.installation.enabled || record.sourceVersion !== sourceVersion) throw new Error("Widget installation changed");
            const previous = record.revisions.find(value => value.revisionId === candidate.revisionId);
            if (previous && (previous.packageDigest !== candidate.packageDigest || previous.rootDirectory !== candidate.rootDirectory))
              throw new Error("Immutable plugin revision changed");
            if (!previous) record.revisions.push(candidate);
            record.directory.packageDirectory = candidate.rootDirectory;
            record.manifest = candidate.manifest;
            record.activeRevision = record.acceptedRevision = record.installation.acceptedRevision = candidate.revisionId;
            record.activation = null;
            record.status = "disabled";
            delete record.error;
            state.removedOfficialWidgets = state.removedOfficialWidgets.filter(id => id !== pluginId);
          });
        }
      } catch (error) {
        await this.store.mutate(state => {
          const record = state.plugins.find(value => value.manifest.id === pluginId);
          if (!record || record.activeRevision === candidate.revisionId || record.status === "cleanup-failed") return;
          if (!existing) state.plugins = state.plugins.filter(value => value !== record);
          else if (!previouslyRetained) record.revisions = record.revisions.filter(value => value.revisionId !== candidate.revisionId);
        });
        this.changed();
        throw error;
      }
      this.changed();
      return this.require(pluginId);
    });
  }
  async acceptInactivePackage(revision: UnifiedPluginRevision, assertCurrent?: () => void) {
    await this.serialize(revision.pluginId, async () => {
      await this.store.mutate(state => {
        assertCurrent?.();
        const record = this.record(state.plugins, revision.pluginId);
        if (record.installation.enabled) throw new Error("Plugin must remain disabled during inactive package acceptance");
        const previous = record.revisions.find(value => value.revisionId === revision.revisionId);
        if (previous && (previous.packageDigest !== revision.packageDigest || previous.rootDirectory !== revision.rootDirectory)) throw new Error("Immutable plugin revision changed");
        if (!previous) record.revisions.push(revision);
        record.activeRevision = revision.revisionId; record.acceptedRevision = revision.revisionId; record.installation.acceptedRevision = revision.revisionId;
        record.activation = null; record.status = "disabled";
      });
      this.changed();
    });
    return this.require(revision.pluginId);
  }
  async setInstanceCount(pluginId: string, count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid plugin instance count");
    await this.store.mutate(state => { this.record(state.plugins, pluginId).instanceCount = count; }); this.changed();
  }
  async markHealthy() { await this.store.markHealthy(); }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; clearTimeout(this.healthyTimer);
    for (const record of this.store.read(state => state.plugins)) this.activation.cancelCandidate(record.manifest.id);
    this.closing = (async () => {
      const errors: unknown[] = [];
      await Promise.allSettled([...this.queues.values()]);
      for (const record of this.store.read(state => state.plugins)) {
        try { await this.activation.stop(record.manifest.id, { all: true }); }
        catch (cause) { errors.push(cause); await this.fail(record.manifest.id, cause, "cleanup-failed"); }
      }
      if (!errors.length) await this.store.markClean();
      await this.store.close(); this.listeners.clear();
      if (errors.length) throw new AggregateError(errors, "Plugin shutdown cleanup is incomplete");
    })();
    return this.closing;
  }
  private async directory(path: string, native = false): Promise<string> {
    if (native) await (await import("../process/source-root")).assertPluginSourceRoot(path, this.options.sourcePathScope);
    const canonical = await realpath(path), info = await lstat(canonical);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Plugin directory is not available");
    return canonical;
  }
  private summaryView(record: UnifiedPluginStoredRecord): UnifiedPluginCatalogSummary {
    const { manifest, installation, directory, sourceProject, status, activeRevision, availableRevision, acceptedRevision, instanceCount, error } = record;
    const source = manifest.source;
    return unifiedPluginCatalogSummarySchema.parse({
      manifest: { id: manifest.id, name: manifest.name, version: manifest.version.slice(0, 128), description: manifest.description?.slice(0, 1024),
        essential: manifest.essential, source: { kind: source.kind, format: source.format, editable: source.editable,
          canCopy: source.format === "bottega" && (source.kind !== "official" || source.editable) && !manifest.contributions.some(value => "hostViewId" in value && value.hostViewId),
          installIdentity: source.installIdentity, externalVersion: source.externalVersion },
        dependencies: manifest.dependencies.map(value => ({ pluginId: value.pluginId })),
        contributionKinds: (["page", "widget", "composer", "tool", "service", "mode"] as const).filter(kind => manifest.contributions.some(value => value.kind === kind)),
        contributionCount: manifest.contributions.length },
      installation, directory: { missing: directory.missing }, ...(sourceProject ? { sourceProject: { projectId: sourceProject.projectId } } : {}),
      status, runtimeReady: this.isActive(manifest.id), activeRevision, availableRevision, acceptedRevision, instanceCount, error,
    });
  }
  private view(record: UnifiedPluginStoredRecord): UnifiedPluginCatalogItem {
    const { revisions: _revisions, activation: _activation, sourceVersion: _sourceVersion, sourceBuild: _sourceBuild, ...view } = record;
    const authoringWaiters=this.options.authoringWaiters?.(record.manifest.id);
    return unifiedPluginCatalogItemSchema.parse({ ...view, runtimeReady: this.isActive(record.manifest.id), activationId: this.activationId(record.manifest.id),...(authoringWaiters?.length?{authoringWaiters}:{} ) });
  }
  private require(pluginId: string) {
    const record = this.get(pluginId); if (!record) throw new Error("Plugin is not installed: " + pluginId); return record;
  }
  private record(records: UnifiedPluginStoredRecord[], pluginId: string) {
    const record = records.find(value => value.manifest.id === pluginId);
    if (!record) throw new Error("Plugin is not installed: " + pluginId); return record;
  }
  private async fail(pluginId: string, cause: unknown, status?: UnifiedPluginCatalogItem["status"], owner?: PluginActivationIdentity) {
    const changed = await this.store.mutate(state => {
      const record = this.record(state.plugins, pluginId);
      if (owner && (record.activeRevision !== owner.revisionId || record.activation?.activationId !== owner.activationId)) return false;
      record.status = status ?? (this.activation.isActive(pluginId) ? "ready" : "failed"); record.error = errorMessage(cause);
      return true;
    });
    if (changed) this.changed();
  }
  private changed() {
    const event = this.store.read(state => ({ revision: state.revision }));
    for (const listener of this.listeners) { try { listener(event); } catch (error) { this.options.reportError?.(error); } }
  }
  private assertOpen() { if (this.closed) throw new Error("Plugin platform is closing"); }
  private serialize<T>(pluginId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pluginId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(pluginId, next);
    void next.finally(() => { if (this.queues.get(pluginId) === next) this.queues.delete(pluginId); }).catch(() => undefined);
    return next;
  }
}
export async function openUnifiedPluginPlatform(options: UnifiedPluginPlatformOptions): Promise<UnifiedPluginPlatform> {
  const platform = new UnifiedPluginPlatform(options); await platform.initialize(); return platform;
}
