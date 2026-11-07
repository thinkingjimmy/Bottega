/**
 * [INPUT]: Durable platform store, contribution registry and injected process/Surface lifecycle ports.
 * [OUTPUT]: Strict source/authority CAS, exact owner identity and revocation, accepted-source receipts, guarded original-feature recovery and cancellation/compensation.
 * [POS]: Unified plugin version switch owner; business data and instance configuration are never restored.
 */
import { randomUUID } from "node:crypto";
import { unifiedPluginRevisionSchema, type PluginReadiness, type PluginServiceContext, type UnifiedPluginActivationRecord, type UnifiedPluginRevision, type UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import type { ActivePluginRuntime, PreparedPluginRuntime, UnifiedPluginPlatformOptions, PluginActivationOptions, PluginRevocationScope, PluginActivationIdentity } from "./model";
import { PluginSourceSupersededError } from "./model";
import { pluginSourceBuildSchema, type UnifiedPluginStore, type UnifiedPluginStoredRecord } from "./store";
import type { PluginContributionRegistry } from "./registry";

const message = (cause: unknown) => String(cause instanceof Error ? cause.message : cause).slice(0, 2048);
const emptyRuntime = (): PreparedPluginRuntime => ({
  readiness: [], activate: async () => {}, drain: async () => {}, dispose: async () => {},
});
export class UnifiedPluginActivation {
  private readonly active = new Map<string, ActivePluginRuntime>();
  private readonly pending = new Map<string, AbortController>();
  constructor(
    private store: UnifiedPluginStore,
    private registry: PluginContributionRegistry,
    private options: UnifiedPluginPlatformOptions,
    private changed: () => void,
    private now: () => number,
    private hostReady: (pluginId: string) => boolean = () => false,
  ) {}
  cancelCandidate(pluginId: string, reason?: Error) { this.pending.get(pluginId)?.abort(reason); }
  isActive(pluginId: string, revisionId?: string): boolean {
    const running = this.active.get(pluginId);
    return Boolean(running && !running.controller.signal.aborted && (!revisionId || running.context.revision === revisionId));
  }
  activationId(pluginId: string, revisionId?: string): string | undefined {
    return this.isActive(pluginId, revisionId) ? this.active.get(pluginId)!.context.activationId : undefined;
  }
  ownsActivation(pluginId: string, owner: PluginActivationIdentity): boolean {
    const context = this.active.get(pluginId)?.context;
    return context?.revision === owner.revisionId && context.activationId === owner.activationId;
  }
  async activate(input: UnifiedPluginRevision, options: PluginActivationOptions = {}): Promise<void> {
    options.signal?.throwIfAborted(); options.assertCurrent?.();
    const revision = unifiedPluginRevisionSchema.parse(input);
    const pluginId = revision.pluginId;
    const before = this.record(pluginId);
    const sourceBuild = options.builtSource ? pluginSourceBuildSchema.parse({ ...options.builtSource, revisionId: revision.revisionId }) : undefined;
    if (sourceBuild && (options.restore || options.startup)) throw new Error("Runtime restoration cannot replace the source build receipt");
    if (sourceBuild && sourceBuild.sourceDirectory !== (before.directory.sourceDirectory ?? before.directory.packageDirectory)) throw new Error("Plugin source binding changed before build activation");
    if (!before.installation.enabled && !options.restore) throw new Error("Plugin is disabled");
    if (!revision.valid || revision.incompatibleReason) throw new Error(revision.incompatibleReason ?? "Plugin revision is invalid");
    if (!options.restore && !options.startup && revision.sourceVersion !== before.sourceVersion) throw new Error("Stale plugin build cannot activate");
    if (options.restore && revision.dataContract !== (before.revisions.find(value => value.revisionId === before.activeRevision)?.dataContract ?? revision.dataContract))
      throw new Error("This revision uses an incompatible data contract; restore its source to repair it");
    if ((revision.manifest.source.format === "host-package" || revision.manifest.contributions.some(value => "hostAppId" in value && value.hostAppId || "hostViewId" in value && value.hostViewId || "hostPackageId" in value && value.hostPackageId)) && !this.hostReady(pluginId))
      throw new Error("Hosted contributions require a main-owned adapter registration");
    this.validateDependencies(revision, new Set());
    this.registry.validateCandidate(this.canonicalManifest(revision));
    const previous = before.activeRevision;
    const previousActivation = before.activation;
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const activationId = randomUUID();
    const context: PluginServiceContext = { pluginId, revision: revision.revisionId, activationId, signal: controller.signal };
    const assertCurrent = () => {
      if (controller.signal.aborted) throw new Error("Plugin activation was cancelled"); options.assertCurrent?.();
    };
    this.pending.set(pluginId, controller);
    let candidate: ActivePluginRuntime | undefined;
    let committed = false;
    let previousDrained = false;
    let previousEnablement: boolean | undefined;
    try {
      await this.store.mutate(state => {
        controller.signal.throwIfAborted(); options.assertCurrent?.();
        const record = this.find(state.plugins, pluginId);
        record.status = "preparing"; delete record.error;
      });
      this.changed();
      const prepared = await this.prepare(revision, context);
      candidate = { runtime: prepared, context, controller };
      this.assertCandidate(pluginId, before, controller, options);
      // Closing old admission precedes drain and the CAS; no new owner can consume alongside the previous owner.
      await this.closeAdmission(pluginId, previous && previousActivation ? { revisionId: previous, activationId: previousActivation.activationId } : undefined);
      if (this.active.has(pluginId)) { await this.drain(pluginId); previousDrained = true; }
      this.assertCandidate(pluginId, before, controller, options);
      const activation = this.activation(revision, activationId, previous ?? null, previousActivation?.sequence ?? 0, prepared.readiness);
      if (options.startup && previousActivation && previous === revision.revisionId)
        activation.activatedAt = previousActivation.activatedAt;
      await this.store.mutate(state => {
        controller.signal.throwIfAborted(); options.assertCurrent?.();
        const record = this.find(state.plugins, pluginId);
        if (sourceBuild && sourceBuild.sourceDirectory !== (record.directory.sourceDirectory ?? record.directory.packageDirectory)) throw new Error("Plugin source binding changed at build commit");
        if ((record.activation?.sequence ?? 0) !== (previousActivation?.sequence ?? 0) ||
          record.activeRevision !== previous || record.installation.enabled !== before.installation.enabled ||
          (!options.restore && !options.startup && record.sourceVersion !== revision.sourceVersion))
          throw new Error("Stale plugin activation compare-and-swap");
        const existing = record.revisions.find(value => value.revisionId === revision.revisionId);
        if (existing && (existing.packageDigest !== revision.packageDigest || existing.rootDirectory !== revision.rootDirectory))
          throw new Error("Immutable plugin revision identity was reused with different contents");
        if (!existing) record.revisions.push(revision);
        if (options.restore) record.installation.enabled = true;
        record.activation = activation; record.activeRevision = revision.revisionId;
        record.acceptedRevision = revision.revisionId; record.installation.acceptedRevision = revision.revisionId;
        record.manifest = this.canonicalManifest(revision);
        if (sourceBuild) record.sourceBuild = sourceBuild;
      });
      committed = true;
      assertCurrent();
      if (options.restore) {
        await this.options.applyEnablement?.({ pluginId, enabled: true, capturePrevious: enabled => {
          assertCurrent(); previousEnablement = enabled;
        } });
        assertCurrent();
        if (this.options.featureReady?.(pluginId) === false) throw new Error("Plugin feature owner is not ready: " + pluginId);
      }
      await prepared.activate(context);
      assertCurrent();
      this.active.set(pluginId, candidate);
      this.registry.register(this.canonicalManifest(revision), { replace: true });
      await this.store.mutate(state => {
        controller.signal.throwIfAborted(); options.assertCurrent?.();
        const record = this.find(state.plugins, pluginId);
        record.status = "ready"; delete record.error;
        if (state.safeMode?.pluginId === pluginId) delete state.safeMode;
      });
      candidate = undefined;
      this.changed();
    } catch (cause) {
      const cleanupErrors: unknown[] = [];
      if (candidate) {
        controller.abort();
        try { if (committed) await candidate.runtime.drain(context); } catch (error) { cleanupErrors.push(error); }
        try { await candidate.runtime.dispose(context); } catch (error) { cleanupErrors.push(error); }
        if (this.active.get(pluginId) === candidate && !cleanupErrors.length) this.active.delete(pluginId);
      }
      if (previousEnablement !== undefined) {
        try { await this.options.applyEnablement?.({ pluginId, enabled: previousEnablement && this.record(pluginId).installation.enabled }); }
        catch (error) { cleanupErrors.push(error); }
      }
      if (committed || previousDrained) {
        try { await this.restorePrevious(before); } catch (error) { cleanupErrors.push(error); }
      }
      await this.store.mutate(state => {
        const record = this.find(state.plugins, pluginId);
        if (cause instanceof PluginSourceSupersededError && !cleanupErrors.length) {
          record.status = record.installation.enabled ? "building" : "disabled"; delete record.error;
        } else {
          record.status = cleanupErrors.length ? "cleanup-failed" : this.isActive(pluginId) && this.options.featureReady?.(pluginId) !== false ? "ready" : "failed";
          record.error = message(cause) + (cleanupErrors.length ? "; Cleanup: " + cleanupErrors.map(message).join("; ") : "");
        }
      });
      this.changed();
      if (cleanupErrors.length) throw new AggregateError([cause, ...cleanupErrors], message(cause) + "; plugin cleanup remains incomplete");
      throw cause;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (this.pending.get(pluginId) === controller) this.pending.delete(pluginId);
    }
  }
  async stop(pluginId: string, scope: PluginRevocationScope): Promise<void> {
    if (!("all" in scope) && !this.ownsActivation(pluginId, scope)) return;
    this.cancelCandidate(pluginId);
    await this.closeAdmission(pluginId, scope);
    if ("all" in scope || this.ownsActivation(pluginId, scope)) await this.drain(pluginId);
  }
  private async closeAdmission(pluginId: string, scope?: PluginRevocationScope) {
    this.registry.unregister(pluginId);
    if (scope) await this.options.revokeContributions?.({ pluginId, ...scope });
  }
  private async drain(pluginId: string) {
    const running = this.active.get(pluginId);
    if (!running) return;
    try {
      await running.runtime.drain(running.context);
      running.controller.abort();
      await running.runtime.dispose(running.context);
      this.active.delete(pluginId);
    } catch (cause) {
      running.controller.abort();
      throw cause;
    }
  }
  private async prepare(revision: UnifiedPluginRevision, context: PluginServiceContext): Promise<PreparedPluginRuntime> {
    const input = { revision, manifest: this.canonicalManifest(revision), activationId: context.activationId, signal: context.signal };
    const executable = revision.manifest.contributions.some(value => value.kind === "service" || value.kind === "tool");
    if (executable && !this.options.prepareRuntime) throw new Error("Plugin process runtime is unavailable");
    const runtime = this.options.prepareRuntime ? await this.options.prepareRuntime(input) : emptyRuntime();
    try {
      const ui = revision.manifest.contributions.filter(value => value.kind === "page" || value.kind === "widget" || value.kind === "composer");
      if (ui.length && !this.options.prepareUi) throw new Error("Plugin interface readiness owner is unavailable");
      const readiness = [...runtime.readiness, ...await this.options.prepareUi?.(input) ?? [],
        ...revision.manifest.contributions.filter(value => value.kind === "mode").map(value => ({
          contributionId: value.id, kind: value.kind, ready: true,
        } as PluginReadiness))];
      for (const contribution of revision.manifest.contributions) {
        const results = readiness.filter(value => value.contributionId === contribution.id && value.kind === contribution.kind);
        if (results.length !== 1 || !results[0]?.ready) throw new Error(results[0]?.error ?? "Plugin contribution is not ready: " + contribution.id);
      }
      if (readiness.length !== revision.manifest.contributions.length) throw new Error("Plugin readiness contains undeclared or duplicate contributions");
      return { ...runtime, readiness };
    } catch (cause) {
      try { await runtime.dispose(context); }
      catch (cleanup) { throw new AggregateError([cause, cleanup], "Plugin preparation cleanup failed"); }
      throw cause;
    }
  }
  private assertCandidate(pluginId: string, before: UnifiedPluginStoredRecord, controller: AbortController, options: PluginActivationOptions) {
    options.assertCurrent?.();
    const current = this.record(pluginId);
    if (options.builtSource && options.builtSource.sourceDirectory !== (current.directory.sourceDirectory ?? current.directory.packageDirectory)) throw new Error("Plugin source binding changed during build activation");
    if (controller.signal.aborted || current.installation.enabled !== before.installation.enabled) throw new Error("Plugin activation was cancelled");
    if ((!options.restore && !options.startup && current.sourceVersion !== before.sourceVersion) ||
      current.activeRevision !== before.activeRevision || (current.activation?.sequence ?? 0) !== (before.activation?.sequence ?? 0))
      throw new Error("Stale plugin build cannot activate");
  }
  private activation(revision: UnifiedPluginRevision, activationId: string, previousRevision: string | null, sequence: number, readiness: PluginReadiness[]): UnifiedPluginActivationRecord {
    return { pluginId: revision.pluginId, activationId, revisionId: revision.revisionId, previousRevision,
      sourceVersion: revision.sourceVersion, activatedAt: this.now(), sequence: sequence + 1, readiness };
  }
  private async restorePrevious(before: UnifiedPluginStoredRecord) {
    const current = this.record(before.manifest.id);
    await this.closeAdmission(before.manifest.id, current.activeRevision && current.activation ? { revisionId: current.activeRevision, activationId: current.activation.activationId } : undefined);
    if (this.active.has(before.manifest.id)) await this.drain(before.manifest.id);
    const revision = before.revisions.find(value => value.revisionId === before.activeRevision);
    // Compensation restores code selection without undoing an explicit disable or enabling a previously disabled owner.
    await this.store.mutate(state => {
      const record = this.find(state.plugins, before.manifest.id);
      record.installation.enabled = record.installation.enabled && before.installation.enabled;
      record.activation = before.activation; record.activeRevision = before.activeRevision;
      record.manifest = before.manifest; record.acceptedRevision = before.acceptedRevision;
      record.installation.acceptedRevision = before.installation.acceptedRevision;
      if (before.sourceBuild) record.sourceBuild = before.sourceBuild; else delete record.sourceBuild;
    });
    if (!revision || !this.record(before.manifest.id).installation.enabled) return;
    const controller = new AbortController(), activationId = randomUUID();
    const context: PluginServiceContext = { pluginId: before.manifest.id, revision: revision.revisionId, activationId, signal: controller.signal };
    const runtime = await this.prepare(revision, context);
    try {
      await this.store.mutate(state => {
        const record = this.find(state.plugins, before.manifest.id);
        record.activation = this.activation(revision, activationId, record.activeRevision ?? null, record.activation?.sequence ?? 0, runtime.readiness);
        record.activeRevision = revision.revisionId; record.acceptedRevision = revision.revisionId;
        record.installation.acceptedRevision = revision.revisionId; record.manifest = this.canonicalManifest(revision);
      });
      await runtime.activate(context);
      this.active.set(before.manifest.id, { runtime, context, controller });
      this.registry.register(this.canonicalManifest(revision), { replace: true });
    } catch (cause) { controller.abort(); await runtime.dispose(context); throw cause; }
  }
  private validateDependencies(revision: Pick<UnifiedPluginRevision, "pluginId" | "manifest">, ancestors: Set<string>) {
    if (ancestors.has(revision.pluginId)) throw new Error("Plugin dependency cycle: " + revision.pluginId);
    const next = new Set(ancestors); next.add(revision.pluginId);
    for (const dependency of revision.manifest.dependencies) {
      const record = this.record(dependency.pluginId);
      if (!record.installation.enabled || !(this.hostReady(dependency.pluginId) || this.isActive(dependency.pluginId))) throw new Error("Plugin dependency is not ready: " + dependency.pluginId);
      const active = record.revisions.find(value => value.revisionId === record.activeRevision);
      const manifest = active?.manifest ?? (this.hostReady(dependency.pluginId) ? record.manifest : null);
      if (!manifest) throw new Error("Plugin dependency revision is missing: " + dependency.pluginId);
      if (dependency.version && dependency.version !== manifest.version) throw new Error("Plugin dependency version differs: " + dependency.pluginId);
      if (dependency.contributions?.some(id => !manifest.contributions.some(value => value.id === id))) throw new Error("Plugin dependency contribution is missing: " + dependency.pluginId);
      this.validateDependencies({ pluginId: dependency.pluginId, manifest }, next);
    }
  }
  private canonicalManifest(revision: UnifiedPluginRevision): UnifiedPluginManifest {
    const record = this.record(revision.pluginId), source = revision.manifest.source;
    return { ...revision.manifest, essential: record.installation.origin === "official" && record.manifest.essential, source: { ...source, kind: record.installation.origin,
      editable: record.installation.origin === "external" ? false : source.editable } };
  }
  private record(pluginId: string) { return this.store.read(state => this.find(state.plugins, pluginId)); }
  private find(records: UnifiedPluginStoredRecord[], pluginId: string): UnifiedPluginStoredRecord {
    const record = records.find(value => value.manifest.id === pluginId);
    if (!record) throw new Error("Plugin is not installed: " + pluginId);
    return record;
  }
}
