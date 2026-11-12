/**
 * [INPUT]: Depends on unified bounded plugin catalog summaries with selected full Widget details, accepted revisions/live activation identities, city configuration and forecast validation, the Dock layout CAS store, bounded summaries/native details and isolated Surface leases.
 * [OUTPUT]: Manages plugin Widget definitions and instances, package readiness, native Weather summaries and scoped isolated cards.
 * [POS]: Unified Dock plugin owner; runtime code, configuration and business data have separate identities and lifetimes.
 */
import { pluginWidgetDetailSchema, type PluginWidgetDetail } from '../../../../../shared/system-dock/widgets/plugin/detail';
import { WEATHER_PLUGIN_ID, weatherConfigurationSchema, weatherFaceSchema } from '../../../../../shared/system-dock/widgets/weather';
import { weatherDefinitionCopy } from '../../../../../shared/system-dock/widgets/weather/labels';
import { describeWeather } from '../../../../../shared/system-dock/widgets/weather/copy';
import { readyOfficialWidget } from "../../../plugins/platform/official-widgets/identity";
import { isOfficialWidgetId, nativeWidgetType, officialDefinitionId, officialWidgetIds, OFFICIAL_WIDGETS, type OfficialWidgetId } from "../../../../../shared/system-dock/widgets/catalog/official";
import { entryLabel } from "../../projection";
import { officialDefault, validateOfficial, type OfficialWidgetDirectory } from "../../store/custom/official";
import { weatherOwner } from "../../../plugins/official/weather/runtime";
import { DockCardSlots, DOCK_WIDGET_FRAMES, type WidgetCardRole } from "./cards/slots";
import { readOfficialWidget } from "./cards/data";
import type { DockUsage } from "../usage";
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
import { nativeDockWidget, toPluginDockWidget, type DockWidget } from "../../../../../shared/system-dock/layout";
import type { CustomWidgetFace, CustomWidgetDetail } from "../../../../../shared/system-dock/widgets/runtime";
import { pluginDockWidgetSchema, pluginWidgetFormInputSchema, savePluginWidgetSchema, removePluginWidgetSchema, pluginDockSurfaceSchema,
  type PluginWidgetForm, type PluginDockWidget } from "../../../../../shared/system-dock/widgets/plugin";
import type { WidgetManagementSnapshot } from "../../../../../shared/system-dock/widgets/authoring";
import type { WidgetItem } from "../custom/ports";
type Integration = { platform: Pick<UnifiedPluginPlatform, "get" | "list" | "activeRevision" | "activationId" | "isActive" | "setInstanceCount" | "onChanged">;
  gateway: Pick<UnifiedPluginSurfaceGateway, "open" | "call" | "authorize" | "release">;
  invoke?(input: { pluginId: string; revision: string; activationId: string; method: string; input: unknown; signal: AbortSignal }): Promise<unknown> };
type Ports = { userData: string; config: DockConfigStore; integration(): Integration | null; changed(): void; masked(): boolean; locale?(): Parameters<typeof entryLabel>[0];
  usage?(): DockUsage; officialDirectory?(): OfficialWidgetDirectory; bundled?(id: OfficialWidgetId): boolean };
type Summary = { detail?: PluginWidgetDetail; key: string; face: CustomWidgetFace; at: number; updatedAt: number | null; flight?: Promise<void>; controller: AbortController };
function needsSetup(widget: PluginDockWidget) {
  if (widget.pluginId === WEATHER_PLUGIN_ID) return !weatherConfigurationSchema.safeParse(widget.configuration).success;
  return Boolean(nativeWidgetType(widget.pluginId, widget.contributionId) && !nativeDockWidget(widget));
}
export class PluginDockWidgets {
  private readonly visible = new Map<DockSurface, Set<string>>();
  private readonly summaries = new Map<string, Summary>();
  private readonly leases = new Map<string, { itemId: string; windowId: number; key: string }>();
  private readonly slots = new DockCardSlots();
  private readonly nativeWindows = new Map<DockSurface, number>();
  private readonly opening = new Set<string>();
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
  constructor(private readonly ports: Ports) { this.release = ports.integration()?.platform.onChanged(() => { try { this.reconcile(); this.ports.changed(); } catch { /* Dock configuration may still be opening. */ } }) ?? (() => {}); }
  private integration() { const value = this.ports.integration(); if (!value) throw new Error("Unified plugins are unavailable"); return value; }
  private widget(item: WidgetItem): PluginDockWidget | null {
    return item.widget.type === "plugin" ? item.widget : null;
  }
  private item(id: string) {
    const item = this.ports.config.layout().items.find(value => value.id === id);
    if (item?.kind !== "widget") return null;
    const widget = this.widget(item);
    return widget ? { ...item, widget } : null;
  }
  private official(pluginId: string): OfficialWidgetId | undefined {
    return isOfficialWidgetId(pluginId) ? pluginId : undefined;
  }
  ready(pluginId: string, contributionId: string) {
    try { return this.definition(pluginId, contributionId).ready; }
    catch { return false; }
  }
  private name(id: OfficialWidgetId) {
    return entryLabel(this.ports.locale?.() ?? "en", OFFICIAL_WIDGETS[id].label);
  }
  private definition(pluginId: string, contributionId: string) {
    const integration = this.integration(), record = integration.platform.get(pluginId);
    const contribution = record?.manifest.contributions.find(value => value.kind === "widget" && value.id === contributionId);
    if (!record || !contribution || contribution.kind !== "widget") throw new Error("Plugin Widget is not declared");
    const revision = integration.platform.activeRevision(pluginId);
    return { contribution, record, revision, activationId: integration.platform.activationId(pluginId, revision?.revisionId), ready: this.official(pluginId) ? readyOfficialWidget(integration.platform, this.official(pluginId)!)
      : Boolean(revision && record.installation.enabled && integration.platform.isActive(pluginId, revision.revisionId)) };
  }
  form(raw: unknown): PluginWidgetForm {
    const input = pluginWidgetFormInputSchema.parse(raw), { contribution, ready } = this.definition(input.pluginId, input.contributionId);
    if (this.official(input.pluginId) && !ready && !input.itemId) throw new Error("Official Widget is unavailable");
    const item = input.itemId ? this.item(input.itemId) : null;
    if (input.itemId && (!item || item.widget.pluginId !== input.pluginId || item.widget.contributionId !== input.contributionId)) throw new Error("Plugin Widget instance changed");
    const schema = contribution.settingsSchema ?? { type: "object", additionalProperties: true };
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, { default?: unknown }> : {};
    const defaults = Object.fromEntries(Object.entries(properties).filter(([, value]) => value.default !== undefined).map(([key, value]) => [key, value.default]));
    const native = nativeWidgetType(input.pluginId, input.contributionId);
    const directory = native ? this.ports.officialDirectory?.() : undefined;
    const official = this.official(input.pluginId);
    const initial = native && directory ? toPluginDockWidget("preview", officialDefault(native, directory)).configuration : defaults;
    return { ...input, itemId: item?.id ?? null, name: item?.label ?? (official ? this.name(official) : contribution.name), settingsSchema: schema,
      configuration: structuredClone(item?.widget.configuration ?? initial), size: item?.widget.size ?? "small",
      layoutRevision: this.ports.config.snapshot().localRevision, customCard: Boolean(contribution.customCard) };
  }
  async save(raw: unknown) {
    const input = savePluginWidgetSchema.parse(raw), definition = this.definition(input.pluginId, input.contributionId);
    if (!definition.ready) throw new Error("Plugin Widget is not ready");
    if (input.withoutCity && (input.pluginId !== WEATHER_PLUGIN_ID || input.itemId || Object.keys(input.configuration).length))
      throw new Error("Only a new Weather Widget can defer city selection");
    const cityName = input.pluginId === WEATHER_PLUGIN_ID && !input.withoutCity
      ? weatherConfigurationSchema.parse(input.configuration).location.city.name
      : undefined;
    const schema = definition.contribution.settingsSchema ?? { type: "object", additionalProperties: true };
    const parsed = input.withoutCity ? z.strictObject({}).safeParse(input.configuration)
      : z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(input.configuration);
    if (!parsed.success) throw new Error(`Invalid Widget configuration schema: ${parsed.error.message}`);
    const current = input.itemId ? this.item(input.itemId) : null;
    if (input.itemId && (!current || current.widget.pluginId !== input.pluginId || current.widget.contributionId !== input.contributionId)) throw new Error("Plugin Widget instance changed");
    const itemId = current?.id ?? randomUUID().replaceAll("-", "");
    const widget = pluginDockWidgetSchema.parse({ type: "plugin", configVersion: 1, pluginId: input.pluginId, contributionId: input.contributionId,
      instanceId: itemId, size: input.size, configuration: parsed.data });
    const record = await this.ports.config.edit(layout => {
      if (!this.definition(input.pluginId, input.contributionId).ready) throw new Error("Plugin Widget is not ready");
      if (nativeWidgetType(input.pluginId, input.contributionId)) {
        const native = nativeDockWidget(widget), directory = this.ports.officialDirectory?.();
        if (!native || !directory) throw new Error("Official Widget configuration is unavailable");
        validateOfficial(native, directory, current ? nativeDockWidget(current.widget) ?? undefined : undefined);
      }
      const official = this.official(input.pluginId);
      const item = { id: itemId, kind: "widget" as const, label: cityName ?? input.name ?? current?.label ?? (official ? this.name(official) : definition.contribution.name), widget };
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
  private customizable(pluginId:string){const source=this.ports.integration()?.platform.get(pluginId)?.manifest.source;return Boolean(source&&(source.kind!=='official'||source.editable));}
  private packageStatus(id: OfficialWidgetId, ready: boolean) {
    if (ready) return "ready";
    const platform = this.ports.integration()?.platform;
    const record = platform?.get(id), revision = platform?.activeRevision(id);
    const receipt = revision?.officialWidget;
    if (record?.installation.enabled === false && revision && (this.ports.bundled?.(id) || receipt && "archiveSha256" in receipt)) return "disabled";
    return "needs-install";
  }
  snapshot(): Pick<WidgetManagementSnapshot, "definitions" | "instances"> {
    const integration = this.ports.integration();
    if (!integration) return { definitions: [], instances: [] };
    const instances: WidgetManagementSnapshot["instances"][number][] = [];
    for (const item of this.ports.config.layout().items) {
      if (item.kind !== "widget") continue;
      const widget = this.widget(item);
      if (!widget) continue;
      const official = this.official(widget.pluginId);
      const ready = this.ready(widget.pluginId, widget.contributionId);
      const status = official && !ready ? this.packageStatus(official, ready)
        : ready && !needsSetup(widget) ? "ready" : "needs-setup";
      const name = official && (this.ports.masked() && [WEATHER_PLUGIN_ID, "bottega-ai-usage"].includes(official) || !item.label)
        ? this.name(official) : item.label ?? "";
      instances.push({ id: item.id, definitionId: widget.pluginId + "." + widget.contributionId,
        pluginId: widget.pluginId, contributionId: widget.contributionId,
        ...(official ? { officialWidget: official } : {}), customizable: this.customizable(widget.pluginId), name,
        ...(this.copyOwner?.status(item.id) ? { copyTarget: this.copyOwner.status(item.id) } : {}), installation: status });
    }
    const definitions: WidgetManagementSnapshot["definitions"][number][] = [];
    let cursor: string | undefined;
    do {
      const page = integration.platform.list({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const summary of page.items) {
        if (!summary.manifest.contributionKinds.includes("widget")) continue;
        const item = integration.platform.get(summary.manifest.id);
        if (!item) continue;
        const official = this.official(item.manifest.id);
        if (official && !this.ports.bundled?.(official) && !integration.platform.activeRevision(official)?.officialWidget) continue;
        for (const contribution of item.manifest.contributions) {
          if (contribution.kind !== "widget") continue;
          const pluginId = item.manifest.id, contributionId = contribution.id;
          const ready = this.ready(pluginId, contributionId);
          definitions.push({
            id: pluginId + "." + contributionId, pluginId, contributionId,
            name: official ? this.name(official) : contribution.name,
            description: pluginId === WEATHER_PLUGIN_ID ? weatherDefinitionCopy(this.ports.locale?.() ?? "en").description
              : official ? "" : contribution.description ?? item.manifest.description ?? "",
            customizable: this.customizable(pluginId), chatId: "", settingsSchema: contribution.settingsSchema, customCard: contribution.customCard,
            activeGenerationId: ready ? item.activeRevision ?? null : null,
            ...(official ? { officialWidget: official, installation: this.packageStatus(official, ready) } : {}),
            candidateGenerationId: null, instanceCount: instances.filter(value => value.pluginId === pluginId && value.contributionId === contributionId).length,
            error: item.error ?? null,
          });
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    for (const id of officialWidgetIds) {
      if (!this.ports.bundled?.(id) || definitions.some(value => value.pluginId === id)) continue;
      definitions.push({ id: officialDefinitionId(id), pluginId: id, contributionId: OFFICIAL_WIDGETS[id].contributionId,
        officialWidget: id, name: this.name(id), description: "", chatId: "", customizable: false,
        activeGenerationId: null, candidateGenerationId: null, installation: "needs-install", error: null,
        instanceCount: instances.filter(instance => instance.pluginId === id).length });
    }
    return { definitions, instances };
  }
  face(item: WidgetItem, edge: "bottom" | "left" | "right"): CustomWidgetFace {
    const widget = this.widget(item);
    if (!widget) throw new Error("Not a plugin Widget");
    const official = this.official(widget.pluginId), masked = this.ports.masked();
    const empty = (state: CustomWidgetFace["state"]): CustomWidgetFace => ({
      type: "custom", size: widget.size, state, summary: null, description: null, readings: {}, officialWidget: official,
    });
    let definition: ReturnType<PluginDockWidgets["definition"]>;
    try { definition = this.definition(widget.pluginId, widget.contributionId); } catch { return empty(official ? "needs-install" : "definition-missing"); }
    if (!definition.ready) return empty(official && this.packageStatus(official, false) === "needs-install" ? "needs-install" : "paused");
    if (needsSetup(widget)) return empty("needs-setup");
    const entry = this.summaries.get(item.id), cached = entry?.key === this.key(widget) && !masked ? entry : undefined;
    const native = nativeDockWidget(widget);
    const usage = native?.type === "builtin.ai-activity" && !masked ? this.ports.usage?.().activityDetail(item.id, native) : undefined;
    const idle = empty("ready");
    const face = cached?.face ?? (!official ? { ...idle, summary: { type: "label" as const, text: { kind: "literal" as const, value: definition.contribution.name.slice(0, 80) } },
      description: definition.contribution.name } : idle);
    return { ...face, officialWidget: official, activity: usage?.face,
      plugin: { pluginId: widget.pluginId, contributionId: widget.contributionId, instanceId: widget.instanceId,
        customCard: Boolean(definition.contribution.customCard && !masked),
        configuration: masked ? {} : structuredClone(widget.configuration), revision: definition.revision?.revisionId ?? "",
        activationId: definition.activationId, dataRevision: usage ? usage.updatedAt ?? usage.face.state : cached?.updatedAt ?? face.state, ...summaryDimensions(widget.size, edge) } };
  }
  detail(item: WidgetItem, edge: "bottom" | "left" | "right"): CustomWidgetDetail {
    const cached = this.summaries.get(item.id), face = this.face(item, edge), widget = this.widget(item);
    const detail = widget && !this.ports.masked() && cached?.key === this.key(widget) ? cached?.detail : undefined;
    return {itemId:item.id,name:item.label??"",face,data:detail&&face.state==='ready'?[{...detail,reading:{...detail.reading,...(face.summaryError?{state:'stale' as const}:{})}}]:[],
      updatedAt:this.ports.masked() ? null : cached?.updatedAt??null,surface:null,actions:[]};
  }
  setVisible(surface: DockSurface, widgets: readonly { itemId: string; widget: DockWidget }[], windowId?: number) {
    if (this.closed) return;
    const ids = widgets.filter(value => value.widget.type === "plugin").map(value => value.itemId);
    this.visible.set(surface, new Set(ids));
    if (surface !== "dock-catalog") {
      const role = surface === "dock-bar" ? "bar" : "panel", previous = this.nativeWindows.get(surface);
      if (previous !== undefined && previous !== windowId) this.slots.set(role, previous, []);
      if (windowId !== undefined) {
        this.slots.set(role, windowId, ids);
        this.nativeWindows.set(surface, windowId);
      } else this.nativeWindows.delete(surface);
    }
    this.reconcile();
  }
  setCatalogWindow(windowId: number, itemIds: readonly string[]) {
    this.slots.set("catalog", windowId, itemIds);
    this.reconcile();
  }
  cardResources() { return { frames: this.leases.size, pending: this.opening.size }; }
  liveCards(windowId: number | undefined) { return windowId === undefined ? [] : this.slots.forWindow(windowId); }
  async refresh(itemId: string) { await this.refreshSummary(itemId, true); }
  reconcile() {
    if (this.closed) return;
    const integration = this.ports.integration();
    if (!integration) {
      for (const entry of this.summaries.values()) entry.controller.abort();
      this.summaries.clear(); this.visible.clear(); this.slots.close();
      for (const [id, lease] of this.leases) this.releaseSurface(id, lease.windowId);
      if (this.timer) clearTimeout(this.timer); this.timer = null;
      return;
    }
    void this.reconcileCopyTargets().catch(cause => console.warn("[plugin-dock] copy retarget failed", cause));
    const capacityChanged = this.slots.plan(id => {
      if (this.ports.masked()) return false;
      const item = this.item(id);
      if (!item || needsSetup(item.widget)) return false;
      try {
        const definition = this.definition(item.widget.pluginId, item.widget.contributionId);
        return definition.ready && Boolean(definition.contribution.customCard);
      } catch { return false; }
    });
    const shown = new Set([...this.visible.values()].flatMap(value => [...value]));
    for (const [id, entry] of this.summaries) { const item = this.item(id); if (this.ports.masked() || !item || !shown.has(id) || entry.key !== this.key(item.widget) || !integration.platform.isActive(item.widget.pluginId)) { entry.controller.abort(); this.summaries.delete(id); } }
    for (const [leaseId, lease] of this.leases) { const item = this.item(lease.itemId); if (!item || !shown.has(item.id) || !this.slots.allows(lease.windowId, lease.itemId) || this.ports.masked() || lease.key !== this.key(item.widget)) this.releaseSurface(leaseId, lease.windowId); }
    for (const id of shown) void this.refreshSummary(id).catch(() => undefined);
    const counts = new Map<string, number>();
    for (const item of this.ports.config.layout().items) {
      const widget = item.kind === "widget" && this.widget(item);
      if (widget) counts.set(widget.pluginId, (counts.get(widget.pluginId) ?? 0) + 1);
    }
    for (const pluginId of counts.keys()) this.counted.add(pluginId);
    for (const pluginId of this.counted) { const count = counts.get(pluginId) ?? 0; if (integration.platform.get(pluginId)?.instanceCount !== count) void integration.platform.setInstanceCount(pluginId, count).catch(() => undefined); }
    if (this.timer) clearTimeout(this.timer);
    this.timer = shown.size ? setTimeout(() => { this.timer = null; this.reconcile(); }, 15_000) : null;
    if (capacityChanged) this.ports.changed();
  }
  private key(widget: PluginDockWidget) { const platform = this.ports.integration()?.platform, revision = platform?.activeRevision(widget.pluginId); return JSON.stringify([revision?.revisionId, platform?.activationId(widget.pluginId, revision?.revisionId), widget.contributionId, widget.configuration, widget.size]); }
  private async refreshSummary(itemId: string, force = false) {
    if (this.closed || this.ports.masked() || ![...this.visible.values()].some(items => items.has(itemId))) return;
    const item = this.item(itemId); if (!item || needsSetup(item.widget)) return;
    const definition = this.definition(item.widget.pluginId, item.widget.contributionId), summary = definition.contribution.summary;
    const hostWeather = this.official(item.widget.pluginId) === WEATHER_PLUGIN_ID;
    if (!definition.ready || !definition.revision || !definition.activationId || (!hostWeather && (!summary || !this.integration().invoke))) return;
    const key = this.key(item.widget), prior = this.summaries.get(itemId);
    if (prior?.flight || !force && prior?.key === key && Date.now() - prior.at < (hostWeather ? 900_000 : summary?.refreshMs ?? 60_000)) return;
    const retained = prior?.key === key && prior.face.state === "ready" && prior.face.summary ? prior : undefined;
    const controller = new AbortController(), entry: Summary = { detail: retained?.detail, key, at: Date.now(), updatedAt: retained?.updatedAt ?? null, controller,
      face: retained ? { ...retained.face, refreshing: true } : { type: "custom", size: item.widget.size, state: "loading", summary: null, description: null, readings: {}, refreshing: true } };
    this.summaries.set(itemId, entry);
    entry.flight = (async () => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(hostWeather ? 10_000 : summary?.timeoutMs ?? 5_000)]);
        const value = hostWeather
          ? await weatherOwner().read({ configuration: item.widget.configuration, force }, signal)
          : await this.integration().invoke!({ pluginId: item.widget.pluginId, revision: definition.revision!.revisionId, activationId: definition.activationId!, method: summary!.method,
          input: { instanceId: item.widget.instanceId, configuration: structuredClone(item.widget.configuration), force }, signal });
        if (Buffer.byteLength(JSON.stringify(value)) > DOCK_SUMMARY_LIMITS.bytes) throw new Error("Plugin Widget summary exceeds budget");
        const raw = value && typeof value === "object" && "summary" in value ? (value as { summary: unknown }).summary : value;
        const parsed = dockSummaryNodeSchema.parse(raw);
        const detail=value&&typeof value==='object'&&'detail'in value?pluginWidgetDetailSchema.parse(value.detail):undefined;
        const weather = item.widget.pluginId === WEATHER_PLUGIN_ID && value && typeof value === 'object' && 'weather' in value
          ? weatherFaceSchema.parse(value.weather) : undefined;
        const description = weather ? describeWeather(weather, item.widget.size, this.ports.locale?.() ?? 'en') : null;
        if (!controller.signal.aborted && this.summaries.get(itemId) === entry) { entry.detail=detail; entry.updatedAt = Date.now(); entry.face = { ...entry.face, state: "ready", summary: parsed, weather, description, refreshing: false, summaryError: undefined, summaryErrorCode: undefined }; }
      } catch (cause) { if (!controller.signal.aborted) {
        const code=/WEATHER_(?:RATE_LIMITED|NETWORK_FAILED|RESPONSE_INVALID)/.exec(cause instanceof Error ? cause.message : '')?.[0];
        entry.face={...entry.face,state:retained?'ready':'failed',refreshing:false,summaryError:retained?true:undefined,summaryErrorCode:code};
      } }
      finally { entry.flight = undefined; if (!this.closed && !controller.signal.aborted) this.ports.changed(); }
    })();
    await entry.flight;
  }
  releaseWindow(windowId: number) {
    this.slots.set("catalog", windowId, []);
    for (const [id, lease] of this.leases) if (lease.windowId === windowId) this.releaseSurface(id, windowId);
    if (!this.closed) this.reconcile();
  }
  async surface(raw: unknown, windowId: number, role: WidgetCardRole) {
    const input = pluginDockSurfaceSchema.parse(raw);
    if (input.kind === "release") {
      const lease = this.leases.get(input.leaseId);
      if (lease && lease.windowId === windowId && lease.itemId === input.itemId) this.releaseSurface(input.leaseId, windowId);
      return null;
    }
    const item = this.item(input.itemId);
    const surface = role === "bar" ? "dock-bar" : role === "panel" ? "dock-panel" : "dock-catalog";
    const assertVisible = () => {
      if (this.closed || this.ports.masked() || !this.visible.get(surface)?.has(input.itemId) || !this.slots.allows(windowId, input.itemId))
        throw new Error("Plugin Widget is not visible in this Dock window");
    };
    assertVisible();
    if (!item || needsSetup(item.widget)) throw new Error("Plugin Widget configuration is unavailable");
    const definition = this.definition(item.widget.pluginId, item.widget.contributionId);
    if (!definition.ready || !definition.contribution.customCard) throw new Error("Plugin Widget card is unavailable");
    const key = this.key(item.widget);
    const assertCurrent = () => {
      assertVisible();
      const current = this.item(item.id);
      if (!current || this.key(current.widget) !== key) throw new Error("Plugin Widget card lease is stale");
    };
    if (input.kind === "open") {
      const reservation = `${windowId}/${item.id}`;
      if (this.opening.has(reservation) || this.opening.size + this.leases.size >= DOCK_WIDGET_FRAMES)
        throw new Error("Plugin Widget card capacity reached");
      this.opening.add(reservation);
      const gateway = this.integration().gateway;
      try {
        for (const [id, lease] of this.leases) if (lease.itemId === item.id && lease.windowId === windowId) this.releaseSurface(id, windowId);
        const view = await gateway.open({ pluginId: item.widget.pluginId, contributionId: item.widget.contributionId, instanceId: item.widget.instanceId }, windowId);
        try { assertCurrent(); }
        catch (error) { gateway.release(view.id, windowId); throw error; }
        this.leases.set(view.id, { itemId: item.id, windowId, key });
        return view;
      } finally { this.opening.delete(reservation); }
    }
    const lease = this.leases.get(input.leaseId);
    const assertLease = () => {
      assertCurrent();
      if (!lease || this.leases.get(input.leaseId) !== lease || lease.itemId !== item.id || lease.windowId !== windowId || lease.key !== key)
        throw new Error("Plugin Widget card lease is stale");
    };
    assertLease();
    if (this.official(item.widget.pluginId)) {
      if (input.method !== "readData" || input.input !== undefined) throw new Error("Official Widget cards only accept readData without arguments");
      const gateway = this.integration().gateway;
      const authority = await gateway.authorize(input.leaseId, windowId);
      assertLease();
      const data = await readOfficialWidget(this.ports.usage!(), item.id, item.widget, role === "panel" ? "detail" : "card", authority.controller.signal);
      await gateway.authorize(input.leaseId, windowId);
      assertLease();
      return data;
    }
    const payload = input.input && typeof input.input === "object" && !Array.isArray(input.input) ? input.input : { input: input.input };
    return this.integration().gateway.call({ leaseId: input.leaseId, method: input.method, input: { ...payload, instanceId: item.widget.instanceId, configuration: structuredClone(item.widget.configuration) } }, windowId);
  }
  private releaseSurface(id: string, windowId: number) { try { this.ports.integration()?.gateway.release(id, windowId); } finally { this.leases.delete(id); } }
  async close() { if (this.closed) return; this.closed = true; this.release(); if (this.timer) clearTimeout(this.timer); for (const entry of this.summaries.values()) entry.controller.abort(); for (const [id, lease] of this.leases) this.releaseSurface(id, lease.windowId); this.summaries.clear(); this.visible.clear(); this.slots.close(); await (await this.copies)?.close(); }
}
