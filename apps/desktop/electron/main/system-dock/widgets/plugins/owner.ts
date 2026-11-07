/**
 * [INPUT]: Depends on unified bounded plugin catalog summaries with selected full Widget details, accepted revisions/live activation identities, weather location validation and the Dock layout CAS store, bounded summaries/native details and isolated Surface leases.
 * [OUTPUT]: Provides independent plugin Widget forms/instances, lazy durable copy retargeting, automatic revision projection, visible-only summary demand, upstream-first shutdown guards, activation-bound last-good summary/card refreshes and trusted card calls.
 * [POS]: Unified Dock plugin owner; runtime code, configuration and business data have separate identities and lifetimes.
 */
import { pluginWidgetDetailSchema, type PluginWidgetDetail } from '../../../../../shared/system-dock/widgets/plugin/detail';
import { WEATHER_PLUGIN_ID, weatherConfigurationSchema } from '../../../../../shared/system-dock/widgets/weather';
import { weatherDefinitionCopy } from '../../../../../shared/system-dock/widgets/weather/labels';
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginDockCopyTargets, PluginWidgetCopyInput } from "./copy-targets";
import { z } from "zod";
import { dockSummaryNodeSchema, DOCK_SUMMARY_LIMITS, summaryDimensions } from "@bottega/contracts/plugins/dock/summary";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import type { UnifiedPluginSurfaceGateway } from "../../../plugins/platform/gateway";
import type { DockConfigStore } from "../../store/config-store";
import type { DockSurface } from "../usage";
import type { DockWidget } from "../../../../../shared/system-dock/layout";
import type { CustomWidgetFace, CustomWidgetDetail } from "../../../../../shared/system-dock/widgets/runtime";
import { pluginDockWidgetSchema, pluginWidgetFormInputSchema, savePluginWidgetSchema, removePluginWidgetSchema, pluginDockSurfaceSchema,
  type PluginWidgetForm, type PluginDockWidget } from "../../../../../shared/system-dock/widgets/plugin";
import type { WidgetManagementSnapshot } from "../../../../../shared/system-dock/widgets/authoring";
import type { WidgetItem } from "../custom/ports";
type Integration = { platform: Pick<UnifiedPluginPlatform, "get" | "list" | "activeRevision" | "activationId" | "isActive" | "setInstanceCount" | "onChanged">;
  gateway: Pick<UnifiedPluginSurfaceGateway, "open" | "call" | "release">;
  invoke?(input: { pluginId: string; revision: string; activationId: string; method: string; input: unknown; signal: AbortSignal }): Promise<unknown> };
type Ports = { userData: string; config: DockConfigStore; integration(): Integration | null; changed(): void; masked(): boolean; locale?(): string };
type Summary = { detail?: PluginWidgetDetail; key: string; face: CustomWidgetFace; at: number; updatedAt: number | null; flight?: Promise<void>; controller: AbortController };
export class PluginDockWidgets {
  private readonly visible = new Map<DockSurface, Set<string>>();
  private readonly summaries = new Map<string, Summary>();
  private readonly leases = new Map<string, { itemId: string; windowId: number; key: string }>();
  private readonly release: () => void;
  private readonly counted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private copies?: Promise<PluginDockCopyTargets>;
  private copyOwner?: PluginDockCopyTargets;
  async initialize() { if (existsSync(this.copyFile())) { await this.copyTargets(); await this.reconcileCopyTargets(); } }
  private copyFile() { return join(this.ports.userData, "plugin-dock-copy-targets.json"); }
  private copyTargets() {
    if (this.closed) throw new Error("Plugin Widget copy owner is closed");
    return this.copies ??= import("./copy-targets").then(async ({ PluginDockCopyTargets }) => {
      const owner = new PluginDockCopyTargets({ filePath: this.copyFile(), config: this.ports.config, platform: () => this.integration().platform, changed: () => { this.reconcile(); this.ports.changed(); } });
      await owner.initialize(); this.copyOwner = owner; return owner;
    });
  }
  async queueCopyTarget(input: PluginWidgetCopyInput) { const owner = await this.copyTargets(); const receipt = await owner.queue(input); await owner.reconcile(); this.reconcile(); return { ...receipt, ...owner.status(input.instanceId), status: owner.status(input.instanceId)?.status ?? "applied" as const }; }
  async reconcileCopyTargets() { if (this.closed) return; const owner = await this.copies; await owner?.reconcile(); }
  constructor(private readonly ports: Ports) { this.release = ports.integration()?.platform.onChanged(() => { try { this.reconcile(); } catch { /* Dock configuration may still be opening. */ } }) ?? (() => {}); }
  private integration() { const value = this.ports.integration(); if (!value) throw new Error("Unified plugins are unavailable"); return value; }
  private item(id: string) { return this.ports.config.layout().items.find((item): item is WidgetItem & { widget: PluginDockWidget } => item.id === id && item.kind === "widget" && item.widget.type === "plugin"); }
  private definition(pluginId: string, contributionId: string) {
    const integration = this.integration(), record = integration.platform.get(pluginId);
    const contribution = record?.manifest.contributions.find(value => value.kind === "widget" && value.id === contributionId);
    if (!record || !contribution || contribution.kind !== "widget") throw new Error("Plugin Widget is not declared");
    const revision = integration.platform.activeRevision(pluginId);
    return { contribution, record, revision, activationId: integration.platform.activationId(pluginId, revision?.revisionId), ready: Boolean(revision && record.installation.enabled && integration.platform.isActive(pluginId, revision.revisionId)) };
  }
  form(raw: unknown): PluginWidgetForm {
    const input = pluginWidgetFormInputSchema.parse(raw), { contribution } = this.definition(input.pluginId, input.contributionId);
    const item = input.itemId ? this.item(input.itemId) : null;
    if (input.itemId && (!item || item.widget.pluginId !== input.pluginId || item.widget.contributionId !== input.contributionId)) throw new Error("Plugin Widget instance changed");
    const schema = contribution.settingsSchema ?? { type: "object", additionalProperties: true };
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, { default?: unknown }> : {};
    const defaults = Object.fromEntries(Object.entries(properties).filter(([, value]) => value.default !== undefined).map(([key, value]) => [key, value.default]));
    return { ...input, itemId: item?.id ?? null, name: item?.label ?? (input.pluginId === WEATHER_PLUGIN_ID ? weatherDefinitionCopy(this.ports.locale?.() ?? "en").name : contribution.name), settingsSchema: schema,
      configuration: structuredClone(item?.widget.configuration ?? defaults), size: item?.widget.size ?? "small",
      layoutRevision: this.ports.config.snapshot().localRevision, customCard: Boolean(contribution.customCard) };
  }
  async save(raw: unknown) {
    const input = savePluginWidgetSchema.parse(raw), definition = this.definition(input.pluginId, input.contributionId);
    if (!definition.ready) throw new Error("Plugin Widget is not ready");
    if (input.pluginId === WEATHER_PLUGIN_ID) weatherConfigurationSchema.parse(input.configuration);
    const parsed = z.fromJSONSchema((definition.contribution.settingsSchema ?? { type: "object", additionalProperties: true }) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(input.configuration);
    if (!parsed.success) throw new Error(`Invalid Widget configuration schema: ${parsed.error.message}`);
    const current = input.itemId ? this.item(input.itemId) : null;
    if (input.itemId && (!current || current.widget.pluginId !== input.pluginId || current.widget.contributionId !== input.contributionId)) throw new Error("Plugin Widget instance changed");
    const itemId = current?.id ?? randomUUID().replaceAll("-", "");
    const widget = pluginDockWidgetSchema.parse({ type: "plugin", configVersion: 1, pluginId: input.pluginId, contributionId: input.contributionId,
      instanceId: itemId, size: input.size, configuration: parsed.data });
    const record = await this.ports.config.edit(layout => {
      const item = { id: itemId, kind: "widget" as const, label: input.name ?? current?.label ?? definition.contribution.name, widget };
      return { ...layout, initialized: true, items: current ? layout.items.map(value => value.id === itemId ? item : value) : [...layout.items, item], order: current ? layout.order : [...layout.order, itemId] };
    }, input.expectedLayoutRevision);
    this.reconcile(); this.ports.changed();
    return { itemId, layoutRevision: record.localRevision };
  }
  async remove(raw: unknown) {
    const input = removePluginWidgetSchema.parse(raw);
    if (!this.item(input.itemId)) throw new Error("Plugin Widget instance is unavailable");
    const record = await this.ports.config.edit(layout => ({ ...layout, items: layout.items.filter(item => item.id !== input.itemId), order: layout.order.filter(id => id !== input.itemId) }), input.expectedLayoutRevision);
    this.reconcile(); this.ports.changed(); return { itemId: input.itemId, layoutRevision: record.localRevision };
  }
  private customizable(pluginId:string){const source=this.integration().platform.get(pluginId)?.manifest.source;return Boolean(source&&(source.kind!=='official'||source.editable));}
  snapshot(): Pick<WidgetManagementSnapshot, "definitions" | "instances"> {
    const instances = this.ports.config.layout().items.flatMap(item => item.kind === "widget" && item.widget.type === "plugin" ? [{ id: item.id,
      definitionId: `${item.widget.pluginId}.${item.widget.contributionId}`, pluginId: item.widget.pluginId, contributionId: item.widget.contributionId, customizable:this.customizable(item.widget.pluginId), name: item.label ?? "", ...(this.copyOwner?.status(item.id) ? { copyTarget: this.copyOwner.status(item.id) } : {}),
      installation: (() => { try { return this.definition(item.widget.pluginId, item.widget.contributionId).ready; } catch { return false; } })() ? "ready" as const : "needs-setup" as const }] : []);
    const definitions: WidgetManagementSnapshot["definitions"][number][] = [];
    let cursor: string | undefined;
    do {
      const page = this.integration().platform.list({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const summary of page.items) {
        if (!summary.manifest.contributionKinds.includes("widget")) continue;
        const item = this.integration().platform.get(summary.manifest.id);
        if (!item) continue;
        for (const contribution of item.manifest.contributions) if (contribution.kind === "widget") definitions.push({
        id: `${item.manifest.id}.${contribution.id}`, pluginId: item.manifest.id, contributionId: contribution.id, name: item.manifest.id === WEATHER_PLUGIN_ID ? weatherDefinitionCopy(this.ports.locale?.() ?? "en").name : contribution.name,
        description: item.manifest.id===WEATHER_PLUGIN_ID?weatherDefinitionCopy(this.ports.locale?.()??"en").description:contribution.description ?? item.manifest.description ?? "", customizable:this.customizable(item.manifest.id), chatId: "", settingsSchema: contribution.settingsSchema, customCard: contribution.customCard,
        activeGenerationId: item.installation.enabled ? item.activeRevision ?? null : null, candidateGenerationId: null, instanceCount: instances.filter(instance => instance.pluginId === item.manifest.id && instance.contributionId === contribution.id).length, error: item.error ?? null,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return { definitions, instances };
  }
  face(item: WidgetItem, edge: "bottom" | "left" | "right"): CustomWidgetFace {
    if (item.widget.type !== "plugin") throw new Error("Not a plugin Widget");
    const widget = item.widget;
    let definition: ReturnType<PluginDockWidgets["definition"]>;
    try { definition = this.definition(widget.pluginId, widget.contributionId); } catch { return { type: "custom", size: widget.size, state: "definition-missing", summary: null, description: null, readings: {} }; }
    const entry = this.summaries.get(item.id), cached = entry?.key === this.key(widget) ? entry : undefined;
    return { ...(cached?.face ?? { type: "custom" as const, size: widget.size, state: definition.ready ? "ready" as const : "paused" as const,
      summary: { type: "label" as const, text: { kind: "literal" as const, value: definition.contribution.name.slice(0, 80) } }, description: definition.contribution.name, readings: {} }),
      ...(!definition.ready ? { state: "paused" as const, summary: null, description: null, refreshing: false, summaryError: undefined } : {}),
      plugin: { pluginId: widget.pluginId, contributionId: widget.contributionId, instanceId: widget.instanceId, customCard: Boolean(definition.contribution.customCard && definition.ready && !this.ports.masked()),
        configuration: structuredClone(widget.configuration), revision: definition.revision?.revisionId ?? "", activationId: definition.activationId, ...summaryDimensions(widget.size, edge) } };
  }
  detail(item: WidgetItem, edge: "bottom" | "left" | "right"): CustomWidgetDetail {
    const cached=this.summaries.get(item.id),face=this.face(item,edge),detail=cached?.key===this.key(item.widget as PluginDockWidget)?cached.detail:undefined;
    return {itemId:item.id,name:item.label??"",face,data:detail&&face.state==='ready'?[{...detail,reading:{...detail.reading,...(face.summaryError?{state:'stale' as const}:{})}}]:[],updatedAt:cached?.updatedAt??null,surface:null,actions:[]};
  }
  setVisible(surface: DockSurface, widgets: readonly { itemId: string; widget: DockWidget }[]) { if (this.closed) return; this.visible.set(surface, new Set(widgets.filter(value => value.widget.type === "plugin").map(value => value.itemId))); this.reconcile(); }
  async refresh(itemId: string) { await this.refreshSummary(itemId, true); }
  reconcile() {
    if (this.closed) return;
    const integration = this.ports.integration();
    if (!integration) {
      for (const entry of this.summaries.values()) entry.controller.abort();
      this.summaries.clear(); this.visible.clear();
      for (const [id, lease] of this.leases) this.releaseSurface(id, lease.windowId);
      if (this.timer) clearTimeout(this.timer); this.timer = null;
      return;
    }
    void this.reconcileCopyTargets().catch(cause => console.warn("[plugin-dock] copy retarget failed", cause));
    const shown = new Set([...this.visible.values()].flatMap(value => [...value]));
    for (const [id, entry] of this.summaries) { const item = this.item(id); if (!item || !shown.has(id) || entry.key !== this.key(item.widget) || !integration.platform.isActive(item.widget.pluginId)) { entry.controller.abort(); this.summaries.delete(id); } }
    for (const [leaseId, lease] of this.leases) { const item = this.item(lease.itemId); if (!item || !shown.has(item.id) || this.ports.masked() || lease.key !== this.key(item.widget)) this.releaseSurface(leaseId, lease.windowId); }
    for (const id of shown) void this.refreshSummary(id).catch(() => undefined);
    const counts = new Map<string, number>(); for (const item of this.ports.config.layout().items) if (item.kind === "widget" && item.widget.type === "plugin") counts.set(item.widget.pluginId, (counts.get(item.widget.pluginId) ?? 0) + 1);
    for (const pluginId of counts.keys()) this.counted.add(pluginId);
    for (const pluginId of this.counted) { const count = counts.get(pluginId) ?? 0; if (integration.platform.get(pluginId)?.instanceCount !== count) void integration.platform.setInstanceCount(pluginId, count).catch(() => undefined); }
    if (this.timer) clearTimeout(this.timer);
    this.timer = shown.size ? setTimeout(() => { this.timer = null; this.reconcile(); }, 15_000) : null;
  }
  private key(widget: PluginDockWidget) { const platform = this.ports.integration()?.platform, revision = platform?.activeRevision(widget.pluginId); return JSON.stringify([revision?.revisionId, platform?.activationId(widget.pluginId, revision?.revisionId), widget.contributionId, widget.configuration, widget.size]); }
  private async refreshSummary(itemId: string, force = false) {
    if (this.closed || this.ports.masked() || ![...this.visible.values()].some(items => items.has(itemId))) return;
    const item = this.item(itemId); if (!item) return;
    const definition = this.definition(item.widget.pluginId, item.widget.contributionId), summary = definition.contribution.summary;
    if (!definition.ready || !definition.revision || !definition.activationId || !summary || !this.integration().invoke) return;
    const key = this.key(item.widget), prior = this.summaries.get(itemId);
    if (prior?.flight || !force && prior?.key === key && Date.now() - prior.at < (summary.refreshMs ?? 60_000)) return;
    const retained = prior?.key === key && prior.face.state === "ready" && prior.face.summary ? prior : undefined;
    const controller = new AbortController(), entry: Summary = { detail: retained?.detail, key, at: Date.now(), updatedAt: retained?.updatedAt ?? null, controller,
      face: retained ? { ...retained.face, refreshing: true } : { type: "custom", size: item.widget.size, state: "loading", summary: null, description: null, readings: {}, refreshing: true } };
    this.summaries.set(itemId, entry);
    entry.flight = (async () => {
      try {
        const value = await this.integration().invoke!({ pluginId: item.widget.pluginId, revision: definition.revision!.revisionId, activationId: definition.activationId!, method: summary.method,
          input: { instanceId: item.widget.instanceId, configuration: structuredClone(item.widget.configuration), force }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(summary.timeoutMs ?? 5_000)]) });
        if (Buffer.byteLength(JSON.stringify(value)) > DOCK_SUMMARY_LIMITS.bytes) throw new Error("Plugin Widget summary exceeds budget");
        const raw = value && typeof value === "object" && "summary" in value ? (value as { summary: unknown }).summary : value;
        const parsed = dockSummaryNodeSchema.parse(raw);
        const detail=value&&typeof value==='object'&&'detail'in value?pluginWidgetDetailSchema.parse(value.detail):undefined;
        if (!controller.signal.aborted && this.summaries.get(itemId) === entry) { entry.detail=detail; entry.updatedAt = Date.now(); entry.face = { ...entry.face, state: "ready", summary: parsed, description: null, refreshing: false, summaryError: undefined, summaryErrorCode: undefined }; }
      } catch (cause) { if (!controller.signal.aborted) {
        const code=/WEATHER_(?:LOCATION_[A-Z]+|RATE_LIMITED|NETWORK_FAILED|RESPONSE_INVALID)/.exec(cause instanceof Error ? cause.message : '')?.[0];
        const keep=retained&&code!=='WEATHER_LOCATION_CHANGED';
        if(!keep){entry.detail=undefined;entry.updatedAt=null;}
        entry.face={...entry.face,state:keep?'ready':'failed',summary:keep?entry.face.summary:null,refreshing:false,summaryError:keep?true:undefined,summaryErrorCode:code};
      } }
      finally { entry.flight = undefined; if (!this.closed && !controller.signal.aborted) this.ports.changed(); }
    })();
    await entry.flight;
  }
  async surface(raw: unknown, windowId: number, role: "bar" | "panel") {
    const input = pluginDockSurfaceSchema.parse(raw);
    if (input.kind === "release") {
      const lease = this.leases.get(input.leaseId);
      if (lease && lease.windowId === windowId && lease.itemId === input.itemId) this.releaseSurface(input.leaseId, windowId);
      return null;
    }
    const item = this.item(input.itemId);
    if (!item || !this.visible.get(role === "bar" ? "dock-bar" : "dock-panel")?.has(item.id) || this.ports.masked()) throw new Error("Plugin Widget is not visible in this Dock window");
    const definition = this.definition(item.widget.pluginId, item.widget.contributionId);
    if (!definition.ready || !definition.contribution.customCard) throw new Error("Plugin Widget card is unavailable");
    if (input.kind === "open") {
      for (const [id, lease] of this.leases) if (lease.itemId === item.id && lease.windowId === windowId) this.releaseSurface(id, windowId);
      if (this.leases.size >= 8) throw new Error("Plugin Widget card capacity reached");
      const key = this.key(item.widget);
      const view = await this.integration().gateway.open({ pluginId: item.widget.pluginId, contributionId: item.widget.contributionId, instanceId: item.widget.instanceId }, windowId);
      const latest = this.item(item.id);
      if (!latest || this.key(latest.widget) !== key || !this.visible.get(role === "bar" ? "dock-bar" : "dock-panel")?.has(item.id)) { this.integration().gateway.release(view.id, windowId); throw new Error("Plugin Widget changed while opening"); }
      this.leases.set(view.id, { itemId: item.id, windowId, key: this.key(item.widget) }); return view;
    }
    const lease = this.leases.get(input.leaseId);
    if (!lease || lease.itemId !== item.id || lease.windowId !== windowId || lease.key !== this.key(item.widget)) throw new Error("Plugin Widget card lease is stale");
    const payload = input.input && typeof input.input === "object" && !Array.isArray(input.input) ? input.input : { input: input.input };
    return this.integration().gateway.call({ leaseId: input.leaseId, method: input.method, input: { ...payload, instanceId: item.widget.instanceId, configuration: structuredClone(item.widget.configuration) } }, windowId);
  }
  private releaseSurface(id: string, windowId: number) { try { this.ports.integration()?.gateway.release(id, windowId); } finally { this.leases.delete(id); } }
  async close() { if (this.closed) return; this.closed = true; this.release(); if (this.timer) clearTimeout(this.timer); for (const entry of this.summaries.values()) entry.controller.abort(); for (const [id, lease] of this.leases) this.releaseSurface(id, lease.windowId); this.summaries.clear(); this.visible.clear(); await (await this.copies)?.close(); }
}
