/**
 * [INPUT]: Depends on the shared layout/IPC/metrics models and caller-supplied resolution, running, entry and Widget facts.
 * [OUTPUT]: Provides pure projections: pinned and temporary running bar items (bundle-identity de-duplication, regular-only running area, unpinned-but-running items move to the temporary area), metric items for fitting, and privacy-safe labels.
 * [POS]: system-dock projection kernel; DockService owns facts, this file only shapes them for renderers (INV-06/08/12).
 */

import { translate } from "../../../shared/i18n/runtime";
import type { DockBarItem, TrashState, WidgetFace } from "../../../shared/system-dock/ipc";
import { orderedItems, type DockItem, type DockLayout } from "../../../shared/system-dock/layout";
import type { MetricItem } from "../../../shared/system-dock/metrics";
import type { RunningApp } from "./native/protocol";

export type NativeResolution = { path: string; bundleIdentifier: string | null; name: string } | null;
export type BottegaAppFact = { label: string; state: "ready" | "unavailable" | "missing"; running: boolean };
export type ProjectionFacts = {
  resolution(item: DockItem): NativeResolution | undefined;
  bottega(appId: string | null): BottegaAppFact;
  running: readonly RunningApp[];
  isRunning(target: { bundleIdentifier: string | null; path: string | null }): boolean;
  iconKey(path: string | null): string | null;
  finderPath: string | null;
  downloadsPath: string;
  trash: TrashState;
  widgetFace(item: Extract<DockItem, { kind: "widget" }>): WidgetFace;
  label(key: "finder" | "downloads" | "trash" | "limits" | "activity"): string;
  showRunning: boolean;
};
export function projectPinned(layout: DockLayout, facts: ProjectionFacts): DockBarItem[] {
  return orderedItems(layout).map((item): DockBarItem => {
    if (item.kind === "system") {
      if (item.entry === "system.finder") return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("finder"),
        iconKey: facts.iconKey(facts.finderPath), running: facts.isRunning({ bundleIdentifier: "com.apple.finder", path: facts.finderPath }), status: "ok" };
      if (item.entry === "system.downloads") return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("downloads"),
        iconKey: facts.iconKey(facts.downloadsPath), running: false, status: "ok" };
      return { id: item.id, kind: "system", entry: item.entry, pinned: true, label: facts.label("trash"), iconKey: null, running: false, status: "ok", trash: facts.trash };
    }
    if (item.kind === "widget") return { id: item.id, kind: "widget", pinned: true, running: false, status: "ok", iconKey: null,
      label: facts.label(item.widget.type === "builtin.ai-limits" ? "limits" : "activity"), widget: facts.widgetFace(item) };
    if (item.kind === "bottega-app") {
      const fact = facts.bottega(item.appId);
      return { id: item.id, kind: "bottega-app", pinned: true, label: fact.label || item.label || "", iconKey: null, running: fact.running,
        status: fact.state === "ready" ? "ok" : fact.state === "missing" ? "missing" : "unavailable" };
    }
    const resolved = facts.resolution(item);
    // Unresolved-yet is not missing: the placeholder stays repairable and keeps its position (INV-07).
    return { id: item.id, kind: "native-app", pinned: true, label: resolved?.name ?? item.label ?? item.bundleIdentifier ?? "", iconKey: facts.iconKey(resolved?.path ?? null),
      running: resolved ? facts.isRunning(resolved) : false, status: resolved === null ? "missing" : "ok" };
  });
}
/** Temporary area: running regular apps not already pinned, first-seen order, never persisted (INV-07/08). */
export function projectRunning(layout: DockLayout, facts: ProjectionFacts): DockBarItem[] {
  if (!facts.showRunning) return [];
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
  return facts.running.filter((app) => !(app.bundleIdentifier && pinnedIdentities.has(`b:${app.bundleIdentifier}`)) && !(app.path && pinnedIdentities.has(`p:${app.path}`)))
    .map((app) => ({ id: `running-${app.pid}`, kind: "native-app", pinned: false, label: app.name, iconKey: facts.iconKey(app.path), running: true, status: "ok" }));
}
/** Literal keys so the catalog gate can see every reader. */
export function entryLabel(locale: import("@ai-chat/ui/lib/locale").AppLocale, key: "finder" | "downloads" | "trash" | "limits" | "activity"): string {
  switch (key) {
    case "finder": return translate(locale, "systemDock.entry.finder");
    case "downloads": return translate(locale, "systemDock.entry.downloads");
    case "trash": return translate(locale, "systemDock.entry.trash");
    case "limits": return translate(locale, "systemDock.entry.limits");
    case "activity": return translate(locale, "systemDock.entry.activity");
  }
}
/** Empty means nothing to show at all: no pins and no running Apps in the area this mode displays (INV-07). */
export function isDockEmpty(layout: DockLayout, facts: ProjectionFacts): boolean {
  return !layout.items.length && !projectRunning(layout, facts).length;
}
export function metricItems(items: readonly DockBarItem[]): MetricItem[] {
  return items.map((item) => ({ kind: item.kind, widgetType: item.widget?.type }));
}
/** Privacy mask hides values and file names in every projection, including accessible names (INV-06). */
export function maskFace(face: WidgetFace): WidgetFace {
  if (face.type === "builtin.ai-limits") return { ...face, sources: face.sources.map((source) => ({ ...source, remaining: null, resetsAt: null })) };
  return { ...face, tokens: null, costUsd: null, unpricedTokens: 0 };
}
