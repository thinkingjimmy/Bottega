/**
 * [INPUT]: Shared Dock projections, official Widget identities, local paths and main-owned Dock facts.
 * [OUTPUT]: Builds Dock projection facts and produces privacy-safe pinned and running items, labels and metric inputs.
 * [POS]: system-dock projection kernel; DockService owns facts, this file only shapes them for renderers (INV-06/08/12).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { translate } from "../../../shared/i18n/runtime";
import type { DockBarItem, TrashState, WidgetFace } from "../../../shared/system-dock/ipc";
import { orderedItems, type DockItem, type DockLayout } from "../../../shared/system-dock/layout";
import { metricItem, type MetricItem } from "../../../shared/system-dock/metrics";
import { isOfficialWidgetId, OFFICIAL_WIDGETS } from "../../../shared/system-dock/widgets/catalog/official";
import { weatherDefinitionCopy } from "../../../shared/system-dock/widgets/weather/labels";
import type { RunningApp } from "./native/protocol";
import type { DockService } from "./service";
import { taskFace } from "./widgets/tasks";

export type NativeResolution = { path: string; bundleIdentifier: string | null; name: string } | null;
export type BottegaAppFact = { appIcon?: string | null; label: string; state: "ready" | "unavailable" | "missing"; running: boolean };
type DockEntryLabel = "finder" | "downloads" | "trash" | "limits" | "activity" | "tasks" | "weather";
export type ProjectionFacts = {
  resolution(item: DockItem): NativeResolution | undefined;
  bottega(appId: string | null): BottegaAppFact;
  running: readonly RunningApp[];
  host?: RunningApp;
  isRunning(target: { bundleIdentifier: string | null; path: string | null }): boolean;
  iconKey(path: string | null): string | null;
  finderPath: string | null;
  downloadsPath: string;
  trash: TrashState;
  widgetFace(item: Extract<DockItem, { kind: "widget" }>): WidgetFace;
  label(key: DockEntryLabel): string;
  showRunning: boolean;
};
export function dockProjectionFacts(service: DockService): ProjectionFacts {
  const state = service.ports.local.get();
  const locale = service.ports.locale();
  const mode = service.actualMode() ?? state.preferredMode;
  return {
    resolution: (item: DockItem) => service.resolution.has(item.id) ? service.resolution.get(item.id)! : undefined,
    bottega: (appId: string | null) => service.ports.apps.fact(appId),
    running: service.apps?.runningRegular() ?? [],
    host: service.ports.host ? { ...(service.apps?.hostApp() ?? { pid: process.pid, bundleIdentifier: service.ports.ownBundleId, path: null,
      activationPolicy: "regular" as const, finishedLaunching: true, active: false, hidden: false }), name: "Bottega" } : undefined,
    isRunning: (target: { bundleIdentifier: string | null; path: string | null }) => service.apps?.isRunning(target) ?? false,
    iconKey: (path: string | null) => service.apps?.iconKey(path) ?? null,
    finderPath: "/System/Library/CoreServices/Finder.app",
    downloadsPath: join(homedir(), "Downloads"),
    trash: service.trash?.face() ?? "unknown",
    widgetFace: (item: Extract<DockItem, { kind: "widget" }>) => {
      const native = service.nativeWidget(item.widget);
      const face: WidgetFace = native?.type === "builtin.tasks" ? taskFace(service.ports.tasks)
        : native?.type === "builtin.ai-limits" ? service.usage.limitsFace(native)
        : native?.type === "builtin.ai-activity" ? service.usage.activityFace(native)
        : service.ports.custom?.face(item, state.edge) ?? { type: "custom", size: "size" in item.widget ? item.widget.size : "small",
          state: "definition-missing", summary: null, description: null, readings: {} };
      return state.privacyMask ? maskFace(face) : face;
    },
    label: key => entryLabel(locale, key),
    showRunning: state.showRunningByMode[mode],
  };
}

function isHost(facts: ProjectionFacts, target: { bundleIdentifier: string | null; path: string | null }): boolean {
  return Boolean(facts.host && ((target.bundleIdentifier && target.bundleIdentifier === facts.host.bundleIdentifier)
    || (target.path && target.path === facts.host.path)));
}
export function projectPinned(layout: DockLayout, facts: ProjectionFacts, privacyMask = false): DockBarItem[] {
  return orderedItems(layout).map((item): DockBarItem => {
    if (item.kind === "system") {
      if (item.entry === "system.finder") return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("finder"),
        iconKey: facts.iconKey(facts.finderPath), running: facts.isRunning({ bundleIdentifier: "com.apple.finder", path: facts.finderPath }), status: "ok" };
      if (item.entry === "system.downloads") return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("downloads"),
        iconKey: facts.iconKey(facts.downloadsPath), running: false, status: "ok" };
      return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("trash"), iconKey: null, running: false, status: "ok", trash: facts.trash };
    }
    if (item.kind === "widget") {
      const widget = item.widget;
      const official = widget.type === "plugin" && isOfficialWidgetId(widget.pluginId) &&
        widget.contributionId === OFFICIAL_WIDGETS[widget.pluginId].contributionId ? OFFICIAL_WIDGETS[widget.pluginId] : null;
      const fallback = facts.label(official?.label ?? (widget.type === "builtin.tasks" ? "tasks" : widget.type === "builtin.ai-limits" ? "limits" : "activity"));
      const masked = privacyMask && (official?.label === "weather" || official?.label === "activity" || widget.type === "builtin.ai-activity");
      return { id: item.id, kind: "widget", pinned: true, running: false, status: "ok", iconKey: null,
        label: masked ? fallback : item.label ?? fallback, widget: facts.widgetFace(item) };
    }
    if (item.kind === "bottega-app") {
      const fact = facts.bottega(item.appId);
      return { id: item.id, kind: "bottega-app", pinned: true, label: fact.label || item.label || "", iconKey: null, appIcon: fact.appIcon, running: fact.running,
        status: fact.state === "ready" ? "ok" : fact.state === "missing" ? "missing" : "unavailable" };
    }
    const resolved = facts.resolution(item);
    const host = isHost(facts, { bundleIdentifier: item.bundleIdentifier ?? resolved?.bundleIdentifier ?? null, path: resolved?.path ?? null });
    // Unresolved-yet is not missing: the placeholder stays repairable and keeps its position (INV-07).
    return { id: item.id, kind: "native-app", pinned: true, ...(host ? { host: true } : {}), label: host ? facts.host!.name : resolved?.name ?? item.label ?? item.bundleIdentifier ?? "", iconKey: host ? null : facts.iconKey(resolved?.path ?? null),
      running: host || (resolved ? facts.isRunning(resolved) : false), status: !host && resolved === null ? "missing" : "ok" };
  });
}
/** Temporary area: running regular apps not already pinned, first-seen order, never persisted (INV-07/08). */
export function projectRunning(layout: DockLayout, facts: ProjectionFacts): DockBarItem[] {
  if (!facts.showRunning && !facts.host) return [];
  const pinnedIdentities = new Set<string>();
  for (const item of layout.items) {
    if (item.kind === "native-app") {
      const resolved = facts.resolution(item);
      if (item.bundleIdentifier) pinnedIdentities.add(`b:${item.bundleIdentifier}`);
      if (resolved?.bundleIdentifier) pinnedIdentities.add(`b:${resolved.bundleIdentifier}`);
      if (resolved?.path) pinnedIdentities.add(`p:${resolved.path}`);
    }
    if (item.kind === "system" && item.entry === "system.finder") pinnedIdentities.add("b:com.apple.finder");
  }
  const running = [...(facts.host ? [facts.host] : []), ...(facts.showRunning ? facts.running.filter((app) => app.pid !== facts.host?.pid) : [])];
  return running.filter((app) => !(app.bundleIdentifier && pinnedIdentities.has(`b:${app.bundleIdentifier}`)) && !(app.path && pinnedIdentities.has(`p:${app.path}`)))
    .map((app): DockBarItem => {
      const host = app.pid === facts.host?.pid;
      return { id: `running-${app.pid}`, kind: "native-app", pinned: false, ...(host ? { host: true } : {}),
        label: host ? facts.host!.name : app.name, iconKey: host ? null : facts.iconKey(app.path), running: true, status: "ok" };
    });
}
/** Literal keys so the catalog gate can see every reader. */
export function entryLabel(locale: import("@ai-chat/ui/lib/locale").AppLocale, key: DockEntryLabel): string {
  switch (key) {
    case "finder": return translate(locale, "systemDock.entry.finder");
    case "downloads": return translate(locale, "systemDock.entry.downloads");
    case "trash": return translate(locale, "systemDock.entry.trash");
    case "limits": return translate(locale, "systemDock.entry.limits");
    case "activity": return translate(locale, "systemDock.entry.activity");
    case "tasks": return translate(locale, "systemDock.entry.tasks");
    case "weather": return weatherDefinitionCopy(locale).name;
  }
}
/** Empty means nothing to show at all: no pins and no running Apps in the area this mode displays (INV-07). */
export function isDockEmpty(layout: DockLayout, facts: ProjectionFacts): boolean {
  return !facts.host && !layout.items.length && !projectRunning(layout, facts).length;
}
export function metricItems(items: readonly DockBarItem[]): MetricItem[] {
  return items.map(metricItem);
}
/** Privacy mask hides values and file names in every projection, including accessible names (INV-06). */
export function maskFace(face: WidgetFace): WidgetFace {
  if(face.type==='custom')return{...face,summary:null,weather:undefined,activity:undefined,description:null,readings:{},...(face.plugin?{plugin:{...face.plugin,customCard:false,configuration:{}}}:{})};
  if (face.type === "builtin.tasks") return { ...face, running: null, waiting: null, result: null };
  if (face.type === "builtin.ai-limits") return { ...face, sources: face.sources.map((source) => ({ ...source, remaining: null, resetsAt: null })) };
  return { ...face, tokens: null, costUsd: null, unpricedTokens: 0 };
}
