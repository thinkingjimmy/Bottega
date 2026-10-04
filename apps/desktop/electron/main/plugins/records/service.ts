/**
 * [INPUT]: Installed package authority, shared isolated gateway, public Base ports and plugin settings.
 * [OUTPUT]: Verified package UI intents, record catalog and window/record/generation-bound calls.
 * [POS]: Host-package adapter for the Sketch Surface transport; no session, native bridge or filesystem authority reaches UI.
 */
import { recordCallSchema, recordOpenSchema, recordTargetSchema, type RecordCall, type RecordOpen, type RecordTarget } from "@bottega/contracts/plugins/records/contract";
import { appSurfaceTreeDigest } from "@ai-chat/cloud-protocol/surfaces/manifest";
import type { RemotePluginCatalog } from "@ai-chat/cloud-protocol/surfaces/plugin/catalog";
import type { ExtensionRegistryStore } from "../../extensions/registry/registry-store";
import type { ExtensionInstaller } from "../../extensions/install/installer";
import { admitCatalogEntries } from "../surface-integration/catalog";
import type { HostPackageRuntime } from "../../extensions/host/runtime";
import { readRecordAssets } from "./assets";
import type { BasePublicRuntime } from "../../bases/public/composition";
import type { PortCaller } from "../../bases/public/ports";
import type { PluginSurfaceGateway } from "../surface-runtime/gateway";
import type { PluginCatalog } from "../catalog";
import type { SurfaceIntent } from "../../cloud/sync/surfaces/source";

const sourceFormat = { id: "bottega.record", version: 1, readableVersions: [1] };
const pluginId = (identity: string) => `host:${identity.replace(/^sha256:/, "")}`;
const installId = (id: string) => { if (!/^host:[a-f0-9]{64}$/.test(id)) throw new Error("plugin-not-found"); return `sha256:${id.slice(5)}`; };

export class RecordPluginService {
  private entries: RemotePluginCatalog = [];
  private readonly leases = new Map<string, { input: RecordOpen; windowId: number; expiresAt: number }>();
  constructor(private readonly deps: { registry: ExtensionRegistryStore; packages: HostPackageRuntime; bases: BasePublicRuntime;
    gateway: PluginSurfaceGateway; catalog: PluginCatalog; installer: ExtensionInstaller; authored(): RemotePluginCatalog }) {
    deps.installer.configurePackageUiAdmission(async (identity, manifest) => {
      if (!manifest.recordUi) return;
      await this.refresh();
      const id = pluginId(identity);
      admitCatalogEntries([...deps.authored(), ...this.entries.filter(entry => entry.id !== id), {
        id, name: manifest.displayName, enabled: false, error: null, generationId: "0".repeat(40),
        composer: { id: manifest.packageId, title: manifest.displayName, icon: "puzzle" }, sourceFormat, records: manifest.recordUi,
      }]);
    });
  }

  async refresh() {
    const entries: RemotePluginCatalog = [];
    for (const owner of this.deps.registry.hostPackages()) {
      if (owner.scope.kind !== "global") continue;
      const manifest = await this.deps.packages.manifest(owner.installIdentity);
      if (!manifest?.recordUi || !owner.activeGenerationRef) continue;
      const enabled = Boolean(await this.deps.packages.resolve(owner.installIdentity)) && !this.deps.packages.isRevoked(owner.installIdentity);
      entries.push({ id: pluginId(owner.installIdentity), name: manifest.displayName, enabled, error: null,
        generationId: owner.activeGenerationRef.packageGenerationId, composer: { id: manifest.packageId, title: manifest.displayName, icon: "puzzle" },
        sourceFormat, records: manifest.recordUi });
    }
    this.entries = entries;
  }
  catalog() { return structuredClone(this.entries); }
  list() { return this.entries.flatMap(entry => entry.generationId && entry.records ? [{ id: entry.id, name: entry.name,
    generationId: entry.generationId, enabled: entry.enabled, records: entry.records }] : []); }
  private async active(id: string, generationId?: string) {
    const identity = installId(id), current = await this.deps.packages.resolve(identity);
    if (!current?.manifest.recordUi || generationId && current.generationId !== generationId) throw new Error("plugin-generation-changed");
    const trust = await this.deps.packages.trustVerdict(identity);
    if (!trust || trust.status === "refused") throw new Error("plugin-unavailable");
    await this.deps.packages.negotiate(identity);
    return current;
  }
  async intent(id: string): Promise<SurfaceIntent> {
    let current;
    try { current = await this.active(id); } catch { return { kind: "none" }; }
    const entry = current.manifest.entries.ui!;
    if (!entry.endsWith("/index.html") && entry !== "index.html") throw new Error("plugin-ui-entry-invalid");
    const files = await readRecordAssets(current.packageRoot, entry, current.contentDigest);
    await this.active(id, current.generationId);
    return { kind: "compiled", generationId: current.generationId, artifactDigest: appSurfaceTreeDigest(files), files,
      sdkSlice: { data: false, preferences: false, workspace: false }, grantedCapabilities: [], hostActions: [],
      plugin: { operations: current.manifest.recordUi!.operations, sourceFormat } };
  }
  private caller(target: RecordTarget, key: string, write = false): PortCaller {
    return { kind: "record-slot", key, base: target.base, rowId: target.rowId, write };
  }
  async results(raw: RecordTarget, result?: { resultRef: string; offset: number }) {
    const target = recordTargetSchema.parse(raw), caller = this.caller(target, "record-reader");
    return result ? this.deps.bases.ports.result(caller, { base: target.base, ...result, length: 4096 })
      : this.deps.bases.ports.results(caller, target);
  }
  async open(raw: RecordOpen, windowId: number) {
    const input = recordOpenSchema.parse(raw);
    await this.check(input);
    const intent = await this.intent(input.pluginId);
    if (intent.kind !== "compiled" || intent.generationId !== input.generationId || !intent.plugin) throw new Error("plugin-generation-changed");
    const identity = installId(input.pluginId);
    const valid = () => this.deps.registry.hostPackages().some(owner => owner.installIdentity === identity && owner.administrativeState === "active"
      && owner.activeGenerationRef?.packageGenerationId === input.generationId) && !this.deps.packages.isRevoked(identity);
    const lease = this.deps.gateway.issuePublished({ pluginId: input.pluginId, generationId: intent.generationId, artifactDigest: intent.artifactDigest,
      files: await Promise.all(intent.files.map(async file => ({ ...file, bytes: await file.read() }))), sourceFormat,
      operations: intent.plugin.operations, isValid: valid, validate: async () => { await this.check(input); } }, windowId);
    for (const [id, held] of this.leases) if (held.expiresAt <= Date.now()) this.leases.delete(id);
    while (this.leases.size >= 64) this.leases.delete(this.leases.keys().next().value!);
    this.leases.set(lease.id, { input, windowId, expiresAt: lease.expiresAt });
    return lease;
  }
  private async check(input: RecordOpen) {
    const current = await this.active(input.pluginId, input.generationId);
    if (!current.manifest.recordUi!.actions.some(action => action.id === input.actionId)) throw new Error("plugin-action-denied");
    await this.deps.bases.ports.results(this.caller(input, input.pluginId), input);
    return current;
  }
  async callLease(leaseId: string, windowId: number, raw: RecordCall) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.windowId !== windowId) throw new Error("plugin-lease-unavailable");
    await this.deps.gateway.validate(leaseId, windowId);
    return this.call(lease.input, raw);
  }
  async call(raw: RecordOpen, request: RecordCall) {
    const input = recordOpenSchema.parse(raw), call = recordCallSchema.parse(request), current = await this.check(input);
    if (!current.manifest.recordUi!.operations.includes(call.operation)) throw new Error("plugin-operation-denied");
    const caller = this.caller(input, `${input.pluginId}:${input.generationId}`, call.operation === "base.results.report");
    switch (call.operation) {
      case "plugin.settings.read": {
        const settings = await this.deps.catalog.settings(installId(input.pluginId));
        return settings;
      }
      case "base.record.read": {
        const value = await this.deps.bases.ports.read(caller, { base: input.base, rowIds: [input.rowId] });
        return { revision: value.revision, rows: value.rows.map(row => ({ rowId: row.rowId, fields: row.fields })) };
      }
      case "base.results.list": return this.deps.bases.ports.results(caller, input);
      case "base.results.read": return this.deps.bases.ports.result(caller, { base: input.base, ...call.payload, length: 4096 });
      case "base.results.report": return this.deps.bases.ports.report(caller, { ...input, ...call.payload, guard: "record-slot-no-field-write" });
    }
  }
}
